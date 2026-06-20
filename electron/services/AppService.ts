// electron/services/AppService.ts - 应用管理(安装/卸载/Z10 解除安装限制/QQ+微信开机自启)
// 见 plan.md 6.x AppService(M5)
// 对应原 z10openinst.bat / qqwxautestart.bat
//
// 逻辑保真(命令参数逐字一致):
//   - z10openinst.bat:
//       adb push switch.db /sdcard/
//       adb root | find "restarting" → 失败则提示"可能没有降级或者不在 QMMI"
//       timeout /T 3 /NOBREAK
//       adb shell setprop persist.sys.xtc.adb_port 1
//       adb shell setprop persist.sys.adb.install 1
//       adb shell cp -R /sdcard/switch.db /data/data/com.xtc.i3launcher/databases/switch.db
//       adb shell setprop ctl.restart zygote(软重启)
//       adb install -r -t -d .\apks\z10apk.Apk
//       adb install -r -t -d .\apks\z10apk1.Apk
//   - qqwxautestart.bat:
//       adb shell content call --uri content://com.xtc.launcher.self.start
//         --method METHOD_SELF_START --extra EXTRA_ENABLE:b:true --arg <pkg>
//       默认包名: com.tencent.qqlite, com.tencent.qqwatch, com.tencent.wechatkids
//
// APK 文件名保留原样(见 plan.md 2.5.4):z10apk.Apk / z10apk1.Apk 不改

import { AdbService } from './AdbService';
import { TIMEOUT } from '../lib/timeouts';
import { SubprocessPool, SpawnError } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import path from 'node:path';

const logger = Logger.instance.child('AppService');

/** 默认自启包名(对应原 qqwxautestart.bat 写死的 3 个包) */
export const DEFAULT_AUTOSTART_PACKAGES = [
  'com.tencent.qqlite',
  'com.tencent.qqwatch',
  'com.tencent.wechatkids',
];

export interface Z10UnlockStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
}

export interface Z10UnlockResult {
  success: boolean;
  steps: Z10UnlockStep[];
  error?: string;
}

export interface AutoStartResult {
  success: boolean;
  results: { pkg: string; success: boolean; error?: string }[];
}

class AppServiceClass {
  /**
   * 解除 Z10 [1.0.1] 安装限制
   * 对应原 z10openinst.bat:openinst 标签
   */
  async unlockZ10Install(): Promise<Z10UnlockResult> {
    const steps: Z10UnlockStep[] = [
      { name: '检查 ADB 设备', status: 'pending' },
      { name: '推送 switch.db 到 /sdcard/', status: 'pending' },
      { name: 'adb root(必须含 "restarting")', status: 'pending' },
      { name: '等待 3 秒', status: 'pending' },
      { name: 'setprop persist.sys.xtc.adb_port 1', status: 'pending' },
      { name: 'setprop persist.sys.adb.install 1', status: 'pending' },
      { name: 'cp switch.db 到桌面数据库', status: 'pending' },
      { name: 'setprop ctl.restart zygote(软重启)', status: 'pending' },
      { name: '安装 z10apk.Apk', status: 'pending' },
      { name: '安装 z10apk1.Apk', status: 'pending' },
    ];

    const runStep = async (i: number, fn: () => Promise<void>): Promise<boolean> => {
      steps[i].status = 'running';
      try {
        await fn();
        steps[i].status = 'success';
        return true;
      } catch (e) {
        steps[i].status = 'failed';
        steps[i].message = (e as Error).message;
        return false;
      }
    };

    // 步骤 1:检查 ADB 设备(对应:device_check.exe adb)
    let ok = await runStep(0, async () => {
      const devices = await AdbService.devices();
      if (devices.length === 0) {
        throw new Error('未检测到 ADB 设备');
      }
    });
    if (!ok) {
      return { success: false, steps, error: steps[0].message };
    }

    // 步骤 2:adb push switch.db /sdcard/
    // 原:adb push .\switch.db /sdcard/
    // switch.db 位于 resources/bin/switch.db(原 bin 目录)
    const switchDbPath = paths.binFile('switch.db');
    ok = await runStep(1, async () => {
      await AdbService.push(switchDbPath, '/sdcard/');
    });
    if (!ok) return { success: false, steps, error: steps[1].message };

    // 步骤 3:adb root(对应:adb root | find "restarting" 1>nul 2>nul || ECHO 失败)
    // 失败说明不在 QMMI 或没降级
    const rootOk = await runStep(2, async () => {
      const result = await SubprocessPool.spawn({
        cmd: paths.binFile('adb.exe'),
        args: ['root'],
        encoding: 'gbk',
        timeout: TIMEOUT.shell,
        cwd: paths.bin,
      });
      if (!result.stdout.includes('restarting') && !result.stdout.includes('already')) {
        throw new Error('获取 root 权限时出错,可能没有降级或者不在 QMMI');
      }
    });
    if (!rootOk) {
      return { success: false, steps, error: steps[2].message };
    }

    // 步骤 4:timeout /T 3 /NOBREAK(对应 sleep 3)
    await runStep(3, async () => {
      await new Promise((r) => setTimeout(r, 3000));
    });

    // 步骤 5:setprop persist.sys.xtc.adb_port 1
    ok = await runStep(4, async () => {
      await AdbService.setProp('persist.sys.xtc.adb_port', '1');
    });
    if (!ok) return { success: false, steps, error: steps[4].message };

    // 步骤 6:setprop persist.sys.adb.install 1
    ok = await runStep(5, async () => {
      await AdbService.setProp('persist.sys.adb.install', '1');
    });
    if (!ok) return { success: false, steps, error: steps[5].message };

    // 步骤 7:cp -R /sdcard/switch.db /data/data/com.xtc.i3launcher/databases/switch.db
    // 原:adb shell cp -R /sdcard/switch.db /data/data/com.xtc.i3launcher/databases/switch.db
    ok = await runStep(6, async () => {
      await AdbService.shell(
        'cp -R /sdcard/switch.db /data/data/com.xtc.i3launcher/databases/switch.db',
        { timeout: TIMEOUT.shell },
      );
    });
    if (!ok) return { success: false, steps, error: steps[6].message };

    // 步骤 8:setprop ctl.restart zygote(软重启)
    ok = await runStep(7, async () => {
      await AdbService.setProp('ctl.restart', 'zygote');
      // 软重启后 ADB 会断,等几秒让设备重新就绪
      await new Promise((r) => setTimeout(r, 8000));
    });
    if (!ok) return { success: false, steps, error: steps[7].message };

    // 步骤 9:adb install -r -t -d z10apk.Apk(APK 文件名保留原样,见 plan.md 2.5.4)
    ok = await runStep(8, async () => {
      const apkPath = path.join(paths.resources, 'apks', 'z10apk.Apk');
      const result = await this.installApk(apkPath);
      if (!result.success) {
        throw new Error(result.error ?? '安装失败');
      }
    });
    if (!ok) return { success: false, steps, error: steps[8].message };

    // 步骤 10:adb install -r -t -d z10apk1.Apk
    ok = await runStep(9, async () => {
      const apkPath = path.join(paths.resources, 'apks', 'z10apk1.Apk');
      const result = await this.installApk(apkPath);
      if (!result.success) {
        throw new Error(result.error ?? '安装失败');
      }
    });
    if (!ok) return { success: false, steps, error: steps[9].message };

    logger.info('Z10 安装限制解除完成');
    return { success: true, steps };
  }

  /**
   * 设置 QQ/微信开机自启
   * 对应原 qqwxautestart.bat
   * 默认包名:com.tencent.qqlite, com.tencent.qqwatch, com.tencent.wechatkids
   */
  async enableAutoStart(
    packages: string[] = DEFAULT_AUTOSTART_PACKAGES,
  ): Promise<AutoStartResult> {
    const results: { pkg: string; success: boolean; error?: string }[] = [];

    for (const pkg of packages) {
      try {
        // 原:adb shell content call --uri content://com.xtc.launcher.self.start
        //     --method METHOD_SELF_START --extra EXTRA_ENABLE:b:true --arg <pkg>
        await AdbService.shell(
          `content call --uri content://com.xtc.launcher.self.start ` +
            `--method METHOD_SELF_START --extra EXTRA_ENABLE:b:true --arg ${pkg}`,
          { timeout: TIMEOUT.shell },
        );
        results.push({ pkg, success: true });
      } catch (e) {
        results.push({ pkg, success: false, error: (e as Error).message });
      }
    }

    const success = results.every((r) => r.success);
    logger.info(`开机自启设置完成: ${results.filter((r) => r.success).length}/${results.length}`);
    return { success, results };
  }

  /**
   * 安装 APK(adb install -r -t -d)
   * 对应 z10openinst.bat 末尾的两次 install 命令
   */
  private async installApk(
    apkPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await SubprocessPool.spawn({
        cmd: paths.binFile('adb.exe'),
        args: ['install', '-r', '-t', '-d', apkPath],
        encoding: 'gbk',
        timeout: TIMEOUT.install,
        cwd: paths.bin,
        onStdout: (line) => logger.info(`install: ${line}`),
      });
      const success = result.stdout.includes('Success');
      if (!success) {
        return { success: false, error: result.stdout.trim() || '安装失败' };
      }
      return { success: true };
    } catch (e) {
      if (e instanceof SpawnError) {
        return { success: false, error: e.stdout.trim() || e.message };
      }
      return { success: false, error: (e as Error).message };
    }
  }
}

export const AppService = new AppServiceClass();
