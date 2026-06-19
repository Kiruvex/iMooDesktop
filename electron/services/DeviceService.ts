// electron/services/DeviceService.ts - 设备检测/等待/状态机
// 见 plan.md 6.3 DeviceService
// 替代原 device_check.exe(见 plan.md 2.6.2 废弃清单)
// 实现细节优化:原用 lsusb,允许改用 node-usb(见 plan.md 核心约束"可以优化"表)
//   —— M1 阶段暂用 adb/fastboot/lsusb.exe 三路检测,不引入 node-usb(避免依赖)
//   —— 后续 M3 可改用 node-usb + 注册表方案

import { BrowserWindow } from 'electron';
import { DeviceInfo, DeviceType } from '../../shared/types';
import { Logger } from './Logger';
import { SubprocessPool } from './SubprocessPool';
import { paths } from '../core/paths';
import fs from 'node:fs';

const logger = Logger.instance.child('DeviceService');

class DeviceServiceClass {
  private static _instance: DeviceServiceClass;
  private currentInfo: DeviceInfo | null = null;
  private listeners = new Set<(info: DeviceInfo | null) => void>();
  private polling = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastNotify = '';

  static get instance(): DeviceServiceClass {
    if (!this._instance) {
      this._instance = new DeviceServiceClass();
    }
    return this._instance;
  }

  private constructor() {}

  /** 当前设备状态(立即返回,不轮询) */
  current(): DeviceInfo | null {
    return this.currentInfo;
  }

  /**
   * 等待任一类型设备(阻塞,带超时)
   * 对应原 device_check.exe [adb|fastboot|qcom_edl|...]
   */
  async waitFor(types: DeviceType[], timeout = 60000): Promise<DeviceInfo> {
    const start = Date.now();
    logger.info(`等待设备类型: ${types.join(', ')}(超时 ${timeout}ms)`);

    return new Promise<DeviceInfo>((resolve, reject) => {
      const check = (): void => {
        const info = this.currentInfo;
        if (info && types.includes(info.type)) {
          logger.info(`检测到设备: ${info.type} (${info.serial})`);
          resolve(info);
          return;
        }
        if (Date.now() - start > timeout) {
          reject(new Error(`等待设备超时(${timeout}ms)`));
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  /** 监听设备变化 */
  onChange(cb: (info: DeviceInfo | null) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** 启动轮询(2 秒一次,后台异步,不阻塞主线程) */
  start(): void {
    if (this.polling) return;
    this.polling = true;
    logger.info('设备监听已启动(2秒轮询)');

    const poll = async (): Promise<void> => {
      if (!this.polling) return;
      try {
        // detectOnce 内部的失败静默(不发 debug 日志),只在状态变化时 update 发 info
        const info = await this.detectOnce();
        this.update(info);
      } catch {
        // 静默,不发日志(避免刷屏)
      } finally {
        if (this.polling) {
          // 2 秒间隔,减少 subprocess 调用
          this.pollTimer = setTimeout(poll, 2000);
        }
      }
    };
    // setImmediate 让首次检测不阻塞当前 tick
    setImmediate(poll);
  }

  /** 停止轮询 */
  stop(): void {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('设备监听已停止');
  }

  /** 一次检测:adb → fastboot → 9008 */
  private async detectOnce(): Promise<DeviceInfo | null> {
    // 1. ADB 设备
    const adbInfo = await this.detectAdb();
    if (adbInfo) return adbInfo;

    // 2. Fastboot 设备
    const fastbootInfo = await this.detectFastboot();
    if (fastbootInfo) return fastbootInfo;

    // 3. 9008 EDL(通过 lsusb.exe)
    const edlInfo = await this.detectEdl();
    if (edlInfo) return edlInfo;

    return null;
  }

  /** 检测 ADB 设备 */
  // 原 device_check.exe adb:解析 adb devices 输出
  private async detectAdb(): Promise<DeviceInfo | null> {
    const adbPath = this.resolveTool('adb');
    if (!adbPath) return null;
    try {
      const result = await SubprocessPool.spawn({
        cmd: adbPath,
        args: ['devices'],
        encoding: 'utf-8',
        timeout: 5000,
        cwd: paths.bin,
        silent: true,
      });
      const lines = result.stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        // 格式:serial\tdevice/unauthorized/offline
        const m = line.match(/^(\S+)\s+(\S+)$/);
        if (!m) continue;
        const [, serial, state] = m;
        let type: DeviceType;
        if (serial.startsWith('emulator-')) {
          type = 'emulator';
        } else if (state === 'unauthorized') {
          type = 'unauthorized';
        } else if (state === 'offline') {
          type = 'offline';
        } else if (state === 'device') {
          type = 'adb';
        } else {
          continue;
        }
        // 加载设备属性
        const info: DeviceInfo = {
          type,
          serial,
          connectedAt: Date.now(),
        };
        if (type === 'adb') {
          await this.fillAdbProps(info, adbPath);
        }
        return info;
      }
    } catch {
      // 静默(设备未连接时每 2 秒失败一次,不刷日志)
    }
    return null;
  }

  /**
   * 解析工具路径
   * - Windows:用 resources/bin/<name>.exe
   * - Linux/macOS:优先用系统 PATH 中的同名工具(无 .exe),fallback 到 resources/bin/<name>.exe
   * - 若文件不存在,返回 null(设备检测跳过,不报错)
   */
  private resolveTool(name: string): string | null {
    const isWindows = process.platform === 'win32';
    const exeName = isWindows ? `${name}.exe` : name;
    const localPath = paths.binFile(exeName);
    // 优先用本地打包的(若存在)
    if (fs.existsSync(localPath)) {
      return localPath;
    }
    // Linux/macOS:fallback 到 PATH 中的系统工具
    if (!isWindows) {
      // 直接返回工具名,让系统在 PATH 中查找
      // 常见情况:Linux 装了 android-tools-adb(命令名是 adb)
      return name;
    }
    return null;
  }

  /** 填充 ADB 设备属性(innermodel/model/androidVersion/sdkVersion/softVersion) */
  // 原 root.bat:134-158 多次调用 adb shell getprop
  private async fillAdbProps(info: DeviceInfo, adbPath?: string): Promise<void> {
    const cmd = adbPath ?? this.resolveTool('adb');
    if (!cmd) return;
    const props = [
      'ro.product.innermodel',
      'ro.product.model',
      'ro.build.version.release',
      'ro.build.version.sdk',
      'ro.product.current.softversion',
    ];
    try {
      const result = await SubprocessPool.spawn({
        cmd,
        args: ['shell', 'getprop'].concat(props.map((p) => `[${p}]:`)),
        encoding: 'gbk',
        timeout: 5000,
        cwd: paths.bin,
        silent: true,
      });
      // getprop 输出格式:[key]: [value]
      const map: Record<string, string> = {};
      for (const line of result.stdout.split('\n')) {
        const m = line.match(/^\[([^\]]+)\]:\s*\[([^\]]*)\]/);
        if (m) {
          map[m[1]] = m[2];
        }
      }
      info.innermodel = map['ro.product.innermodel'];
      info.model = map['ro.product.model'];
      info.androidVersion = map['ro.build.version.release'];
      info.sdkVersion = map['ro.build.version.sdk'];
      info.softVersion = map['ro.product.current.softversion'];
    } catch {
      // 属性加载失败不影响主流程
    }
  }

  /** 检测 Fastboot 设备 */
  private async detectFastboot(): Promise<DeviceInfo | null> {
    const fastbootPath = this.resolveTool('fastboot');
    if (!fastbootPath) return null;
    try {
      const result = await SubprocessPool.spawn({
        cmd: fastbootPath,
        args: ['devices'],
        encoding: 'utf-8',
        timeout: 5000,
        cwd: paths.bin,
        silent: true,
      });
      const lines = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        // 格式:serial\tfastboot
        const m = line.match(/^(\S+)\s+fastboot/);
        if (m) {
          return {
            type: 'fastboot',
            serial: m[1],
            connectedAt: Date.now(),
          };
        }
      }
    } catch {
      // 静默
    }
    return null;
  }

  /** 检测 9008 EDL(通过 lsusb.exe) */
  // 原 edlport.bat:lsusb | find "Qualcomm HS-USB QDLoader 9008"
  private async detectEdl(): Promise<DeviceInfo | null> {
    const lsusbPath = this.resolveTool('lsusb');
    if (!lsusbPath) return null;
    try {
      const result = await SubprocessPool.spawn({
        cmd: lsusbPath,
        args: [],
        encoding: 'utf-8',
        timeout: 5000,
        cwd: paths.bin,
        silent: true,
      });
      for (const line of result.stdout.split('\n')) {
        if (line.includes('Qualcomm HS-USB QDLoader 9008')) {
          // 提取 COM 端口:格式 "Bus xxx Device xxx: ID 05c6:9008 ... (Qualcomm HS-USB QDLoader 9008) COM5"
          const portMatch = line.match(/COM(\d+)/i);
          const port = portMatch ? `COM${portMatch[1]}` : undefined;
          return {
            type: 'qcom_edl',
            serial: '9008',
            port,
            connectedAt: Date.now(),
          };
        }
      }
    } catch {
      // 静默
    }
    return null;
  }

  /** 更新当前设备状态并通知监听者 */
  private update(info: DeviceInfo | null): void {
    const key = info ? `${info.type}:${info.serial}:${info.port ?? ''}` : 'none';
    if (key === this.lastNotify) return; // 无变化
    this.lastNotify = key;
    this.currentInfo = info;
    logger.info(`设备状态变更: ${key}`);
    for (const cb of this.listeners) {
      try {
        cb(info);
      } catch (e) {
        logger.error(`监听器异常: ${(e as Error).message}`);
      }
    }
    // 推送到所有渲染进程
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('device:change', info);
      }
    }
  }
}

export const DeviceService = DeviceServiceClass;
