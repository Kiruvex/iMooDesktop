// electron/services/OtaService.ts - 离线 OTA 升级
// 对应原 ota.bat
//
// 逻辑保真(命令参数逐字一致):
//   ota.bat :root 标签:
//     adb root | find "restarting" 1>nul 2>nul || ECHO 当前不是 QMMI 状态下! (失败提示)
//     adb shell "rm -rf /data/ota*"
//     adb push %sel__file_path% /sdcard/xtc/ota_f_vota.zip
//     adb shell am start -n com.xtc.setting/.module.secretcode.view.activity.OfflineOtaActivity
//     start scrcpy-noconsole.vbs (引导用户点击"开始升级")
//
// 注:原 .bat 在 :root 之前有 :menu 询问是否已进 QMMI,选 n 则 call rebootpro qmmi
// 注:原 .bat 在 :root 之前检测 isv3=1 → 提示"V3 版本无法离线 OTA"
//     本服务把这些前置检测放在调用方(UI)处理,这里只做核心 OTA 流程

import { AdbService } from './AdbService';
import { TIMEOUT } from '../lib/timeouts';
import { ScrcpyService } from './ScrcpyService';
import { SubprocessPool } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import { checkIsV3 } from '../../shared/isv3';

const logger = Logger.instance.child('OtaService');

export interface OtaStartOptions {
  /** OTA zip 本地路径(用户选择) */
  zipPath: string;
}

export interface OtaProgressStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
}

export interface OtaStartResult {
  success: boolean;
  steps: OtaProgressStep[];
  /** 是否已启动 scrcpy 引导 */
  scrcpyStarted: boolean;
  error?: string;
}

class OtaServiceClass {
  /**
   * 启动离线 OTA 升级流程
   * 对应原 ota.bat :run + :root 标签
   */
  async start(opts: OtaStartOptions): Promise<OtaStartResult> {
    const steps: OtaProgressStep[] = [
      { name: '检查 ADB 设备', status: 'pending' },
      { name: '读取设备信息(innermodel/softversion)', status: 'pending' },
      { name: '检测 V3 协议(V3 版本无法离线 OTA)', status: 'pending' },
      { name: 'adb root(必须含 "restarting")', status: 'pending' },
      { name: 'adb shell rm -rf /data/ota*', status: 'pending' },
      { name: '推送 OTA zip 到 /sdcard/xtc/ota_f_vota.zip', status: 'pending' },
      { name: 'am start OfflineOtaActivity', status: 'pending' },
      { name: '启动 scrcpy 引导用户点击"开始升级"', status: 'pending' },
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

    // 步骤 1:检查 ADB 设备
    let innermodel = '';
    let softVersion = '';
    let ok = await runStep(0, async () => {
      const devices = await AdbService.devices();
      if (devices.length === 0) {
        throw new Error('未检测到 ADB 设备');
      }
    });
    if (!ok) return { success: false, steps, scrcpyStarted: false, error: steps[0].message };

    // 步骤 2:读取设备信息(对应 ota.bat 中三个 getprop)
    ok = await runStep(1, async () => {
      innermodel = await AdbService.getprop('ro.product.innermodel');
      softVersion = await AdbService.getprop('ro.product.current.softversion');
      // 同时读 model 和 version 用于日志(对应 .bat 的 echo)
      const model = await AdbService.getprop('ro.product.model');
      logger.info(`设备 innermodel=${innermodel}, model=${model}, softversion=${softVersion}`);
    });
    if (!ok) return { success: false, steps, scrcpyStarted: false, error: steps[1].message };

    // 步骤 3:检测 V3(V3 版本无法离线 OTA,对应原 .bat 提示)
    ok = await runStep(2, async () => {
      const isV3 = checkIsV3(innermodel, softVersion);
      if (isV3) {
        throw new Error('你的手表可能是 V3 版本,无需离线 OTA,也无法离线 OTA');
      }
    });
    if (!ok) return { success: false, steps, scrcpyStarted: false, error: steps[2].message };

    // 步骤 4:adb root(对应:adb root | find "restarting" 1>nul 2>nul || 失败)
    // 失败说明不在 QMMI
    ok = await runStep(3, async () => {
      const result = await SubprocessPool.spawn({
        cmd: process.platform === 'win32' ? paths.binFile('adb.exe') : 'adb',
        args: ['root'],
        encoding: 'gbk',
        timeout: TIMEOUT.shell,
        cwd: paths.bin,
      });
      if (!result.stdout.includes('restarting') && !result.stdout.includes('already')) {
        throw new Error('当前不是 QMMI 状态下!');
      }
    });
    if (!ok) return { success: false, steps, scrcpyStarted: false, error: steps[3].message };

    // 步骤 5:adb shell "rm -rf /data/ota*"
    ok = await runStep(4, async () => {
      await AdbService.shell('rm -rf /data/ota*', { timeout: TIMEOUT.fileOp });
    });
    if (!ok) return { success: false, steps, scrcpyStarted: false, error: steps[4].message };

    // 步骤 6:adb push <zip> /sdcard/xtc/ota_f_vota.zip
    // 原:adb push %sel__file_path% /sdcard/xtc/ota_f_vota.zip
    ok = await runStep(5, async () => {
      // 先确保 /sdcard/xtc 目录存在
      await AdbService.shell('mkdir -p /sdcard/xtc', { timeout: TIMEOUT.device });
      await AdbService.push(opts.zipPath, '/sdcard/xtc/ota_f_vota.zip');
    });
    if (!ok) return { success: false, steps, scrcpyStarted: false, error: steps[5].message };

    // 步骤 7:am start -n com.xtc.setting/.module.secretcode.view.activity.OfflineOtaActivity
    ok = await runStep(6, async () => {
      await AdbService.amStart(
        'com.xtc.setting/.module.secretcode.view.activity.OfflineOtaActivity',
      );
    });
    if (!ok) return { success: false, steps, scrcpyStarted: false, error: steps[6].message };

    // 步骤 8:启动 scrcpy 引导用户点击"开始升级"
    // 原:start scrcpy-noconsole.vbs
    let scrcpyStarted = false;
    await runStep(7, async () => {
      const pid = await ScrcpyService.launch({
        stayAwake: true,
        showTouches: true,
        windowTitle: '请点击手表上的"开始升级"',
      });
      if (pid > 0) {
        scrcpyStarted = true;
        logger.info(`已启动 scrcpy (pid=${pid}) 引导用户点击"开始升级"`);
      } else {
        throw new Error('scrcpy 启动失败');
      }
    });

    // 即使 scrcpy 启动失败,OTA 推送流程已成功,只是用户需要自己看手表
    return {
      success: true,
      steps,
      scrcpyStarted,
    };
  }
}

export const OtaService = new OtaServiceClass();
