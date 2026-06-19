// electron/services/AdbService.ts - adb 命令封装
// 见 plan.md 6.4 AdbService
// 替代原 adbdevice.bat / boot_completed.bat 等(见 plan.md 2.6.1)

import { SubprocessPool } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import fs from 'node:fs';

const logger = Logger.instance.child('AdbService');

class AdbServiceClass {
  private adbPath = paths.binFile('adb.exe');

  /** adb devices */
  async devices(): Promise<string[]> {
    const result = await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['devices'],
      encoding: 'utf-8',
      timeout: 5000,
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
    const out = await this.shell(`getprop ${prop}`, { timeout: 5000 });
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
        timeout: 120000,
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

  private async installData(apkPath: string): Promise<{ success: boolean; pkg?: string }> {
    // 简化实现,M3 完善
    return this.installDirect(apkPath);
  }

  private async install3rd(apkPath: string): Promise<{ success: boolean; pkg?: string }> {
    // 简化实现,M3 完善
    return this.installDirect(apkPath);
  }

  private async installCreate(apkPath: string): Promise<{ success: boolean; pkg?: string }> {
    // 简化实现,M3 完善
    return this.installDirect(apkPath);
  }

  /** 卸载应用 */
  async uninstall(pkg: string): Promise<boolean> {
    try {
      const result = await SubprocessPool.spawn({
        cmd: this.adbPath,
        args: ['uninstall', pkg],
        encoding: 'gbk',
        timeout: 30000,
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
      timeout: 300000,
      cwd: paths.bin,
    });
  }

  /** pull 文件 */
  async pull(remote: string, local: string): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['pull', remote, local],
      encoding: 'gbk',
      timeout: 300000,
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
      timeout: 10000,
      cwd: paths.bin,
    });
  }

  /** 等待开机完成 */
  // 原 boot_completed.bat:轮询 getprop sys.boot_completed == 1
  async waitForBoot(timeout = 120000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const out = await this.shell('getprop sys.boot_completed', { timeout: 5000 });
        if (out.trim() === '1') {
          // 进一步确认系统就绪
          try {
            await this.shell('pm list packages', { timeout: 10000 });
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
        timeout: 10000,
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
      const out = await this.shell('id -u', { timeout: 5000, root: true });
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
      timeout: 30000,
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
      timeout: 10000,
      cwd: paths.bin,
    });
  }

  /** input tap */
  // 原 automagisk.bat:input tap 304 26 等
  async inputTap(x: number, y: number): Promise<void> {
    await this.shell(`input tap ${x} ${y}`, { timeout: 5000 });
  }

  /** input swipe */
  async inputSwipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void> {
    await this.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`, { timeout: 5000 });
  }

  /** setprop */
  async setProp(prop: string, value: string): Promise<void> {
    await this.shell(`setprop ${prop} ${value}`, { timeout: 5000 });
  }

  /** cmd package compile */
  // 原 ROOT-SDK27.bat:cmd package compile -m everything-profile -f com.xtc.i3launcher
  async cmdPackageCompile(pkg: string, mode = 'everything-profile'): Promise<void> {
    await this.shell(`cmd package compile -m ${mode} -f ${pkg}`, { timeout: 60000 });
  }

  /** 打开充电可用 */
  // 原 opencharge.bat:adb shell "su -c setprop persist.sys.charge.usable true"
  async openCharge(): Promise<void> {
    await this.shell('setprop persist.sys.charge.usable true', { timeout: 5000, root: true });
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
        timeout: 10000,
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
      timeout: 5000,
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
      timeout: 5000,
      cwd: paths.bin,
      silent: true,
    });
    // 再切 TCP/IP 模式(原:adb tcpip 5555)
    await SubprocessPool.spawn({
      cmd: this.adbPath,
      args: ['tcpip', '5555'],
      encoding: 'utf-8',
      timeout: 10000,
      cwd: paths.bin,
    });
  }
}

export const AdbService = new AdbServiceClass();
