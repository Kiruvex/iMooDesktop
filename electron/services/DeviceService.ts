// electron/services/DeviceService.ts - 设备检测/等待/状态机
// 见 plan.md 6.3 DeviceService
// 替代原 device_check.exe(见 plan.md 2.6.2 废弃清单)
// 实现方式:node-usb (usb@3.0.0) USB 插拔事件驱动 + 10 秒兜底轮询
//   - USB 事件:即时响应设备插拔(800ms debounce 等设备稳定)
//   - 10 秒兜底:捕获非物理插拔的状态变化(如 ADB unauthorized → device)
//   - detectOnce 不变:adb → fastboot → 9008 三路确认

import { BrowserWindow } from 'electron';
import { TIMEOUT } from '../lib/timeouts';
import { DeviceInfo, DeviceType } from '../../shared/types';
import { checkIsV3 } from '../../shared/isv3';
import { Logger } from './Logger';
import { SubprocessPool } from './SubprocessPool';
import { paths } from '../core/paths';
import fs from 'node:fs';

// 动态 require usb(native addon,不能被 Vite 静态分析)
// 用 require 而非 import,避免 Rollup 尝试解析 .node 二进制
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { webusb } = require('usb') as { webusb: typeof import('usb')['webusb'] };

/** innermodel → 型号名/平台 映射(从 src/lib/models.ts 同步,供 DeviceService 用) */
const MODEL_MAP: Record<string, { model: string; platform: 'otherpash' | 'v3pash' | 'z10' }> = {
  I12: { model: 'Z2', platform: 'otherpash' },
  IB: { model: 'Z3', platform: 'otherpash' },
  I13C: { model: 'Z5A', platform: 'otherpash' },
  I13: { model: 'Z5/Z5Q', platform: 'otherpash' },
  I19: { model: 'Z5Pro', platform: 'otherpash' },
  I18: { model: 'Z6', platform: 'otherpash' },
  I20: { model: 'Z6巅峰版', platform: 'v3pash' },
  I25: { model: 'Z7', platform: 'v3pash' },
  I25C: { model: 'Z7A', platform: 'v3pash' },
  I25D: { model: 'Z7S', platform: 'v3pash' },
  I32: { model: 'Z8', platform: 'v3pash' },
  ND07: { model: 'Z8A', platform: 'v3pash' },
  ND01: { model: 'Z9', platform: 'v3pash' },
  ND03: { model: 'Z10', platform: 'z10' },
  ND08: { model: 'Z11', platform: 'z10' },
};

const logger = Logger.instance.child('DeviceService');

class DeviceServiceClass {
  private static _instance: DeviceServiceClass;
  private currentInfo: DeviceInfo | null = null;
  private listeners = new Set<(info: DeviceInfo | null) => void>();
  private running = false;
  /** 兜底轮询定时器(10 秒) */
  private fallbackTimer: NodeJS.Timeout | null = null;
  /** USB 事件 debounce 定时器 */
  private debounceTimer: NodeJS.Timeout | null = null;
  /** 防止 detectOnce 重入 */
  private detecting = false;
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

  /**
   * 启动设备监听(USB 事件驱动 + 10 秒兜底轮询)
   * - USB connect/disconnect 事件 → 800ms debounce → detectOnce 确认
   * - 10 秒兜底轮询:捕获非物理插拔的状态变化(如 ADB 授权切换)
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('设备监听已启动(USB 事件 + 10秒兜底轮询)');

    // 注册 USB 插拔事件
    const onUsbChange = (): void => {
      this.scheduleDetect(800);
    };
    try {
      webusb.addEventListener('connect', onUsbChange);
      webusb.addEventListener('disconnect', onUsbChange);
    } catch (e) {
      logger.warn(`USB 事件注册失败,降级为纯轮询: ${(e as Error).message}`);
    }
    this._usbChangeHandler = onUsbChange;

    // 首次立即检测
    setImmediate(() => void this.detectAndUpdate());

    // 10 秒兜底轮询(捕获状态切换,如 unauthorized → device)
    this.fallbackTimer = setInterval(() => {
      void this.detectAndUpdate();
    }, 10000);
  }

  private _usbChangeHandler: ((ev: unknown) => void) | null = null;

  /** 停止监听 */
  stop(): void {
    this.running = false;
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this._usbChangeHandler) {
      try {
        webusb.removeEventListener('connect', this._usbChangeHandler);
        webusb.removeEventListener('disconnect', this._usbChangeHandler);
      } catch {
        // ignore
      }
      this._usbChangeHandler = null;
    }
    logger.info('设备监听已停止');
  }

  /** debounce 调度 detectAndUpdate(避免 USB 事件连发) */
  private scheduleDetect(delay: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.detectAndUpdate();
    }, delay);
  }

  /** 执行一次检测并更新状态(防重入) */
  private async detectAndUpdate(): Promise<void> {
    if (this.detecting) return;
    this.detecting = true;
    try {
      const info = await this.detectOnce();
      this.update(info);
    } catch {
      // 静默
    } finally {
      this.detecting = false;
    }
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
        timeout: TIMEOUT.device,
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

  /** 填充 ADB 设备属性 */
  // 原 root.bat:134-158 多次调用 adb shell getprop
  // 增强:读取更多属性 + 填充 isV3/innermodelName/platform + 电量/存储
  private async fillAdbProps(info: DeviceInfo, adbPath?: string): Promise<void> {
    const cmd = adbPath ?? this.resolveTool('adb');
    if (!cmd) return;
    const props = [
      'ro.product.innermodel',
      'ro.product.model',
      'ro.build.version.release',
      'ro.build.version.sdk',
      'ro.product.current.softversion',
      'ro.product.cpu.abi',
      'ro.sf.lcd_density',
      'ro.build.id',
      'ro.build.date',
    ];
    try {
      const result = await SubprocessPool.spawn({
        cmd,
        args: ['shell', 'getprop'].concat(props.map((p) => `[${p}]:`)),
        encoding: 'gbk',
        timeout: TIMEOUT.device,
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
      info.cpuAbi = map['ro.product.cpu.abi'] || undefined;
      info.density = map['ro.sf.lcd_density'] || undefined;
      info.buildId = map['ro.build.id'] || undefined;
      info.buildDate = map['ro.build.date'] || undefined;

      // 填充 isV3(用 checkIsV3 阈值表)
      if (info.innermodel && info.softVersion) {
        info.isV3 = checkIsV3(info.innermodel, info.softVersion);
      }

      // 填充 innermodelName + platform(用 MODEL_MAP 映射表)
      if (info.innermodel) {
        const modelInfo = MODEL_MAP[info.innermodel];
        if (modelInfo) {
          info.innermodelName = modelInfo.model;
          info.platform = modelInfo.platform;
        }
      }
    } catch {
      // 属性加载失败不影响主流程
    }

    // 读取电量和存储(单独的 shell 命令,失败不影响主流程)
    await this.fillBatteryAndStorage(info, cmd);
  }

  /** 读取电量和存储容量(ADB 模式) */
  private async fillBatteryAndStorage(info: DeviceInfo, cmd: string): Promise<void> {
    try {
      // 电量:dumpsys battery | grep level
      const batteryResult = await SubprocessPool.spawn({
        cmd,
        args: ['shell', 'dumpsys', 'battery'],
        encoding: 'utf-8',
        timeout: TIMEOUT.device,
        cwd: paths.bin,
        silent: true,
      });
      const levelMatch = batteryResult.stdout.match(/level:\s*(\d+)/i);
      if (levelMatch) {
        info.batteryLevel = parseInt(levelMatch[1], 10);
      }
    } catch {
      // ignore
    }

    try {
      // 存储:df /sdcard
      const dfResult = await SubprocessPool.spawn({
        cmd,
        args: ['shell', 'df', '/sdcard'],
        encoding: 'utf-8',
        timeout: TIMEOUT.device,
        cwd: paths.bin,
        silent: true,
      });
      // df 输出:/sdcard 12345678 6789012 4567890 60% /storage/emulated
      // 或:Filesystem 1K-blocks Used Available Use% Mounted on
      const lines = dfResult.stdout.split('\n').filter((l) => l.trim());
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1].split(/\s+/);
        if (parts.length >= 4) {
          const totalKb = parseInt(parts[1], 10);
          const availKb = parseInt(parts[3], 10);
          if (!isNaN(totalKb)) info.storageTotal = totalKb * 1024;
          if (!isNaN(availKb)) info.storageAvailable = availKb * 1024;
        }
      }
    } catch {
      // ignore
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
        timeout: TIMEOUT.device,
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
        timeout: TIMEOUT.device,
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
