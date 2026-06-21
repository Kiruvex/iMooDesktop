// electron/services/AdbService.ts - adb 命令封装
// 见 plan.md 6.4 AdbService
// 替代原 adbdevice.bat / boot_completed.bat 等(见 plan.md 2.6.1)

import { SubprocessPool } from './SubprocessPool';
import { TIMEOUT } from '../lib/timeouts';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('AdbService');

class AdbServiceClass {
  // Windows: resources/bin/adb.exe,Linux/macOS: 系统 PATH 的 adb
  private adbPath = process.platform === 'win32' ? paths.binFile('adb.exe') : 'adb';

  /** adb devices */
  async devices(): Promise<string[]> {
    const result = await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['devices'],
      encoding: 'utf-8',
      timeout: TIMEOUT.device,
      cwd: paths.bin,
    });
    return result.stdout
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.includes('\tdevice'));
  }

  /**
   * 执行 adb shell 命令
   * @param cmd shell 命令
   * @param opts.timeout 超时(默认 30000ms)
   * @param opts.root 是否用 root 执行(su -c)
   */
  async shell(cmd: string, opts: { timeout?: number; root?: boolean } = {}): Promise<string> {
    const args = ['shell'];
    if (opts.root) {
      // 原 adbdevice.bat root:adb root 失败则尝试 su -c
      args.push(`su -c '${cmd.replace(/'/g, "'\\''")}'`);
    } else {
      args.push(cmd);
    }
    const result = await SubprocessPool.spawn({
      cmd: this.adbPath,
      args,
      encoding: 'gbk',
      timeout: opts.timeout ?? 30000,
      cwd: paths.bin,
    });
    return result.stdout;
  }

  /** 获取单个 prop 值 */
  // 原 root.bat:134:adb shell getprop ro.product.innermodel
  async getprop(prop: string): Promise<string> {
    const out = await this.shell(`getprop ${prop}`, { timeout: TIMEOUT.device });
    return out.trim();
  }

  /** 安装 APK */
  // 原 instapp.bat:
  //   install:adb install -r -t -d
  //   data:push /data/app/<random>/base.apk + chown system:system
  //   create:pm install-create + install-write + install-commit
  //   3install:push + am start VIEW intent
  async install(
    apkPath: string,
    method: 'install' | 'data' | '3install' | 'create' = 'install',
  ): Promise<{ success: boolean; pkg?: string }> {
    switch (method) {
      case 'install':
        return this.installDirect(apkPath);
      case 'data':
        return this.installData(apkPath);
      case '3install':
        return this.install3rd(apkPath);
      case 'create':
        return this.installCreate(apkPath);
    }
  }

  // adb install -r -t -d
  private async installDirect(apkPath: string): Promise<{ success: boolean; pkg?: string }> {
    try {
      const result = await SubprocessPool.spawn({
        cmd: this.adbPath,
        args: ['install', '-r', '-t', '-d', apkPath],
        encoding: 'gbk',
        timeout: TIMEOUT.install,
        cwd: paths.bin,
        onStdout: (line) => logger.info(`install: ${line}`),
      });
      const success = result.stdout.includes('Success');
      return { success };
    } catch (e) {
      logger.error(`安装失败: ${(e as Error).message}`);
      return { success: false };
    }
  }

  /**
   * data 安装方式:push 到 /data/app/ + pm install
   * 对应原 instapp.bat 的 data 分支
   * 适用:adb install 失败时的备选(权限问题),需要 shell 可写 /data/app
   */
  private async installData(apkPath: string): Promise<{ success: boolean; pkg?: string }> {
    try {
      const remotePath = `/data/app/tmp_${Date.now()}.apk`;
      logger.info(`data 安装: push ${apkPath} → ${remotePath}`);
      await this.push(apkPath, remotePath);
      // pm install -r 走 package manager(不需要 adb install 的权限检查)
      const out = await this.shell(`pm install -r '${remotePath}'`, { timeout: TIMEOUT.install });
      // 清理临时文件
      try { await this.shell(`rm -f '${remotePath}'`, { timeout: TIMEOUT.device }); } catch { /* ignore */ }
      const success = out.includes('Success');
      if (!success) {
        logger.error(`data 安装失败: ${out.trim()}`);
      }
      return { success };
    } catch (e) {
      logger.error(`data 安装异常: ${(e as Error).message}`);
      return { success: false };
    }
  }

  /**
   * 3install 安装方式:push + am start VIEW intent(触发设备端安装器)
   * 对应原 instapp.bat 的 3install 分支
   * 适用:让用户在设备上手动确认安装(第三方安装器)
   * 注意:异步安装,无法立即确认结果,返回 success=true 只表示 intent 发送成功
   */
  private async install3rd(apkPath: string): Promise<{ success: boolean; pkg?: string }> {
    try {
      const fileName = path.basename(apkPath).replace(/[^a-zA-Z0-9._-]/g, '_');
      const remotePath = `/sdcard/${fileName}`;
      logger.info(`3install: push ${apkPath} → ${remotePath}`);
      await this.push(apkPath, remotePath);
      // am start -a android.intent.action.VIEW -d file:///sdcard/xxx.apk -t application/vnd.android.package-archive
      const out = await this.shell(
        `am start -a android.intent.action.VIEW -d "file://${remotePath}" -t application/vnd.android.package-archive`,
        { timeout: TIMEOUT.shell },
      );
      // am start 成功会输出 "Starting: Intent..." 或 "Error"
      const success = !out.toLowerCase().includes('error');
      if (!success) {
        logger.error(`3install 启动安装器失败: ${out.trim()}`);
      }
      return { success };
    } catch (e) {
      logger.error(`3install 异常: ${(e as Error).message}`);
      return { success: false };
    }
  }

  /**
   * create 安装方式:pm install-create + install-write + install-commit(分片安装)
   * 对应原 instapp.bat 的 create 分支
   * 适用:大 APK 分片安装,或需要精细控制安装流程
   */
  private async installCreate(apkPath: string): Promise<{ success: boolean; pkg?: string }> {
    try {
      // 1. 创建 install session
      const createOut = await this.shell('pm install-create -r -t', { timeout: TIMEOUT.shell });
      // 输出形如:Success: created install session [12345]
      const m = createOut.match(/\[(\d+)\]/);
      if (!m) {
        logger.error(`install-create 失败: ${createOut.trim()}`);
        return { success: false };
      }
      const sessionId = m[1];
      logger.info(`create 安装: session ${sessionId}`);

      // 2. 写入 APK
      const size = fs.statSync(apkPath).size;
      const fileName = path.basename(apkPath);
      // pm install-write -S <size> <sessionId> <splitName> <localPath>
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const writeOut = await this.shell(
        `pm install-write -S ${size} ${sessionId} ${safeFileName} '${apkPath.replace(/'/g, "'\\''")}'`,
        { timeout: TIMEOUT.transfer },
      );
      if (!writeOut.includes('Success')) {
        logger.error(`install-write 失败: ${writeOut.trim()}`);
        try { await this.shell(`pm install-abandon ${sessionId}`, { timeout: TIMEOUT.device }); } catch { /* ignore */ }
        return { success: false };
      }

      // 3. 提交安装
      const commitOut = await this.shell(`pm install-commit ${sessionId}`, { timeout: TIMEOUT.install });
      const success = commitOut.includes('Success');
      if (!success) {
        logger.error(`install-commit 失败: ${commitOut.trim()}`);
        try { await this.shell(`pm install-abandon ${sessionId}`, { timeout: TIMEOUT.device }); } catch { /* ignore */ }
      }
      return { success };
    } catch (e) {
      logger.error(`create 安装异常: ${(e as Error).message}`);
      return { success: false };
    }
  }

  /** 卸载应用 */
  async uninstall(pkg: string): Promise<boolean> {
    try {
      const result = await SubprocessPool.spawn({
        cmd: this.adbPath,
        args: ['uninstall', pkg],
        encoding: 'gbk',
        timeout: TIMEOUT.shellLong,
        cwd: paths.bin,
      });
      return result.stdout.includes('Success');
    } catch (e) {
      logger.error(`卸载失败: ${(e as Error).message}`);
      return false;
    }
  }

  /** push 文件 */
  async push(local: string, remote: string): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['push', local, remote],
      encoding: 'gbk',
      timeout: TIMEOUT.transfer,
      cwd: paths.bin,
    });
  }

  /** pull 文件 */
  async pull(remote: string, local: string): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['pull', remote, local],
      encoding: 'gbk',
      timeout: TIMEOUT.transfer,
      cwd: paths.bin,
    });
  }

  /** 重启设备 */
  // 原 rebootpro.bat:1 system / 2 bootloader / 3 recovery / 4 edl / sideload
  async reboot(target: 'system' | 'bootloader' | 'recovery' | 'edl' | 'sideload'): Promise<void> {
    const arg = target === 'system' ? 'reboot' : `reboot ${target}`;
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: arg.split(' '),
      encoding: 'utf-8',
      timeout: TIMEOUT.shell,
      cwd: paths.bin,
    });
  }

  /** 等待开机完成 */
  // 原 boot_completed.bat:轮询 getprop sys.boot_completed == 1
  async waitForBoot(timeout = 120000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const out = await this.shell('getprop sys.boot_completed', { timeout: TIMEOUT.device });
        if (out.trim() === '1') {
          // 进一步确认系统就绪
          try {
            await this.shell('pm list packages', { timeout: TIMEOUT.shell });
            return;
          } catch {
            // 系统未就绪,继续等
          }
        }
      } catch {
        // 设备可能正在重启
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`等待开机超时(${timeout}ms)`);
  }

  /** 尝试获取 root 权限 */
  // 原 adbdevice.bat root:先 adb root,失败则 su -c
  async root(): Promise<{ granted: boolean; method: 'adb-root' | 'su' | 'none' }> {
    try {
      const result = await SubprocessPool.spawn({
        cmd: this.adbPath,
        args: ['root'],
        encoding: 'gbk',
        timeout: TIMEOUT.shell,
        cwd: paths.bin,
      });
      if (result.stdout.includes('restarting') || result.stdout.includes('already')) {
        // 等待 adb 重启
        await new Promise((r) => setTimeout(r, 2000));
        return { granted: true, method: 'adb-root' };
      }
    } catch {
      // ignore
    }
    // 尝试 su
    try {
      const out = await this.shell('id -u', { timeout: TIMEOUT.device, root: true });
      if (out.trim() === '0') {
        return { granted: true, method: 'su' };
      }
    } catch {
      // ignore
    }
    return { granted: false, method: 'none' };
  }

  /** 列出已安装应用 */
  // 原 unapp.bat:1 全部 / 2 第三方
  async listPackages(thirdParty = false): Promise<string[]> {
    const args = ['shell', 'pm', 'list', 'packages'];
    if (thirdParty) args.push('-3');
    const result = await SubprocessPool.spawn({
      cmd: this.adbPath,
      args,
      encoding: 'gbk',
      timeout: TIMEOUT.shellLong,
      cwd: paths.bin,
    });
    return result.stdout
      .split('\n')
      .map((l) => l.replace('package:', '').trim())
      .filter(Boolean);
  }

  /** am start */
  async amStart(activity: string, extras?: Record<string, string>): Promise<void> {
    const args = ['shell', 'am', 'start', '-n', activity];
    if (extras) {
      for (const [k, v] of Object.entries(extras)) {
        args.push('--es', k, v);
      }
    }
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args,
      encoding: 'gbk',
      timeout: TIMEOUT.shell,
      cwd: paths.bin,
    });
  }

  /** input tap */
  // 原 automagisk.bat:input tap 304 26 等
  async inputTap(x: number, y: number): Promise<void> {
    await this.shell(`input tap ${x} ${y}`, { timeout: TIMEOUT.device });
  }

  /** input swipe */
  async inputSwipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void> {
    await this.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`, { timeout: TIMEOUT.device });
  }

  /** setprop */
  async setProp(prop: string, value: string): Promise<void> {
    // prop 和 value 转义防止注入
    const safeProp = prop.replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeValue = value.replace(/'/g, "'\\''");
    await this.shell(`setprop ${safeProp} '${safeValue}'`, { timeout: TIMEOUT.device });
  }

  /** cmd package compile */
  // 原 ROOT-SDK27.bat:cmd package compile -m everything-profile -f com.xtc.i3launcher
  async cmdPackageCompile(pkg: string, mode = 'everything-profile'): Promise<void> {
    // pkg 是包名(如 com.xtc.i3launcher),转义防止注入
    const safePkg = pkg.replace(/[^a-zA-Z0-9._-]/g, '_');
    await this.shell(`cmd package compile -m ${mode} -f ${safePkg}`, { timeout: TIMEOUT.flash });
  }

  /** 打开充电可用 */
  // 原 opencharge.bat:adb shell "su -c setprop persist.sys.charge.usable true"
  async openCharge(): Promise<void> {
    await this.shell('setprop persist.sys.charge.usable true', { timeout: TIMEOUT.device, root: true });
  }

  /** 读取设备 build 属性(按 build.txt 列表) */
  // 原 listbuild.bat:for each prop in build.txt, adb shell getprop
  async readBuildProps(): Promise<{ key: string; label: string; value: string }[]> {
    // 读 build.txt(89 个 prop 定义,格式:key=label)
    const buildTxtPath = paths.dataFile('build.txt');
    let content = '';
    try {
      content = fs.readFileSync(buildTxtPath, 'utf-8');
    } catch {
      // 文件不存在,返回空
      return [];
    }
    const results: { key: string; label: string; value: string }[] = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=]+)=(.+)$/);
      if (!m) continue;
      const [, key, label] = m;
      try {
        const value = (await this.getprop(key.trim())).trim();
        if (value) {
          results.push({ key: key.trim(), label: label.trim(), value });
        }
      } catch {
        // skip
      }
    }
    return results;
  }

  /** 无线 ADB:连接设备 */
  // 原 wifiadb.bat:adb connect <ip:port>
  async wifiConnect(ip: string, port: number = 5555): Promise<boolean> {
    try {
      const result = await SubprocessPool.spawn({
        cmd: this.adbPath,
        args: ['connect', `${ip}:${port}`],
        encoding: 'utf-8',
        timeout: TIMEOUT.shell,
        cwd: paths.bin,
      });
      return result.stdout.includes('connected');
    } catch {
      return false;
    }
  }

  /** 无线 ADB:断开 */
  async wifiDisconnect(ip: string, port: number = 5555): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['disconnect', `${ip}:${port}`],
      encoding: 'utf-8',
      timeout: TIMEOUT.device,
      cwd: paths.bin,
    });
  }

  /** 无线 ADB:切换到无线模式(adb tcpip 5555) */
  // 原 wifiadb.bat :usbtowifi:adb usb → adb tcpip 5555
  async wifiEnable(): Promise<void> {
    // 先切 USB 模式(原:adb usb)
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['usb'],
      encoding: 'utf-8',
      timeout: TIMEOUT.device,
      cwd: paths.bin,
      silent: true,
    });
    // 再切 TCP/IP 模式(原:adb tcpip 5555)
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['tcpip', '5555'],
      encoding: 'utf-8',
      timeout: TIMEOUT.shell,
      cwd: paths.bin,
    });
  }
}

export const AdbService = new AdbServiceClass();
