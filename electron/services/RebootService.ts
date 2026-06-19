// electron/services/RebootService.ts - 高级重启(9 种模式)
// 见 plan.md 6.8 RebootService
// 对应原 rebootpro.bat 逐行实现(逻辑保真)
// 9 种模式:
//   1. system       - 重启至系统
//   2. bootloader   - 重启至 Bootloader/Fastboot
//   3. recovery     - 重启至 Recovery
//   4. edl          - 重启至 9008
//   5. twrp-temp    - 临时启动 TWRP
//   6. qmmi         - misc 进入 qmmi(写 misc.img = ffbm-02)
//   7. ffbm         - misc 进入 ffbm(写 ffbm.img = ffbm-01)
//   8. wipe-data    - misc 进入 Recovery 并清除 data(写 wipe.img = boot-recovery)
//   9. fastbootd    - misc 进入 fastbootd(写 fastbootd.img,仅 Z10/Z11)

import { AdbService } from './AdbService';
import { FastbootService } from './FastbootService';
import { EdlService } from './EdlService';
import { DeviceService } from './DeviceService';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('RebootService');

export type RebootMode =
  | 'system'
  | 'bootloader'
  | 'recovery'
  | 'edl'
  | 'twrp-temp'
  | 'qmmi'
  | 'ffbm'
  | 'wipe-data'
  | 'fastbootd';

export interface RebootOptions {
  mode: RebootMode;
  /** twrp-temp / qmmi / ffbm / wipe-data / fastbootd 需要 innermodel */
  innermodel?: string;
  /** qmmi / ffbm / wipe-data / fastbootd 需要 platform(z10/otherpash/v3pash) */
  platform?: 'otherpash' | 'v3pash' | 'z10';
}

class RebootServiceClass {
  /**
   * 执行重启
   * 对应 rebootpro.bat 的 9 种模式分发
   */
  async reboot(opts: RebootOptions): Promise<void> {
    logger.info(`执行重启: mode=${opts.mode}, innermodel=${opts.innermodel ?? '-'}, platform=${opts.platform ?? '-'}`);
    switch (opts.mode) {
      case 'system':
        return this.rebootSystem();
      case 'bootloader':
        return this.rebootBootloader();
      case 'recovery':
        return this.rebootRecovery(opts.innermodel);
      case 'edl':
        return this.rebootEdl(opts.innermodel);
      case 'twrp-temp':
        return this.rebootTwrpTemp(opts.innermodel!);
      case 'qmmi':
      case 'ffbm':
      case 'wipe-data':
      case 'fastbootd':
        return this.flashMisc(opts.mode, opts.platform!, opts.innermodel!);
    }
  }

  // ========== 模式 1:重启至系统 ==========
  // 对应 rebootpro.bat:35-44 :rebootP-reboot
  private async rebootSystem(): Promise<void> {
    const device = DeviceService.instance.current();
    if (!device) {
      throw new Error('未检测到设备');
    }
    if (device.type === 'adb') {
      // 原:adb reboot
      await AdbService.reboot('system');
    } else if (device.type === 'fastboot') {
      // 原:fastboot reboot
      await FastbootService.reboot('system');
    } else if (device.type === 'qcom_edl') {
      // 原 rebootpro.bat:46-68 :rebootP-reboot-edl
      // 选 loader + QSaharaServer + qfh_loader reboot.xml
      await this.edlReboot();
    } else {
      throw new Error(`当前设备状态不支持重启至系统: ${device.type}`);
    }
    logger.info('已发送重启至系统指令');
  }

  // ========== 模式 2:重启至 Bootloader/Fastboot ==========
  // 对应 rebootpro.bat:72-80 :rebootP-bl
  private async rebootBootloader(): Promise<void> {
    const device = DeviceService.instance.current();
    if (!device) {
      throw new Error('未检测到设备');
    }
    if (device.type === 'adb') {
      // 原:adb reboot bootloader
      await AdbService.reboot('bootloader');
    } else if (device.type === 'fastboot') {
      // 原:fastboot reboot bootloader
      await FastbootService.reboot('bootloader');
    } else {
      throw new Error(`当前设备状态不支持重启至 Bootloader: ${device.type}`);
    }
    logger.info('已发送重启至 Bootloader 指令');
  }

  // ========== 模式 3:重启至 Recovery ==========
  // 对应 rebootpro.bat:84-92 :rebootP-re
  // ADB 模式:adb reboot recovery
  // Fastboot 模式(rebootpro.bat:94-130 :rebootP-re-bl):boot TWRP → 等 ADB → adb reboot recovery
  private async rebootRecovery(innermodel?: string): Promise<void> {
    const device = DeviceService.instance.current();
    if (!device) {
      throw new Error('未检测到设备');
    }
    if (device.type === 'adb') {
      await AdbService.reboot('recovery');
    } else if (device.type === 'fastboot') {
      // 需要 innermodel 选 TWRP 镜像
      if (!innermodel) {
        throw new Error('Fastboot 设备重启至 Recovery 需要选择型号');
      }
      // boot TWRP → 等 ADB → adb reboot recovery
      await this.bootTwrpAndWaitAdb(innermodel);
      await AdbService.reboot('recovery');
    } else {
      throw new Error(`当前设备状态不支持重启至 Recovery: ${device.type}`);
    }
    logger.info('已发送重启至 Recovery 指令');
  }

  // ========== 模式 4:重启至 9008 EDL ==========
  // 对应 rebootpro.bat:135-143 :rebootP-edl
  // ADB 模式:adb reboot edl
  // Fastboot 模式(rebootpro.bat:145-181 :rebootP-edl-bl):boot TWRP → 等 ADB → adb reboot edl
  private async rebootEdl(innermodel?: string): Promise<void> {
    const device = DeviceService.instance.current();
    if (!device) {
      throw new Error('未检测到设备');
    }
    if (device.type === 'adb') {
      await AdbService.reboot('edl');
    } else if (device.type === 'fastboot') {
      if (!innermodel) {
        throw new Error('Fastboot 设备重启至 9008 需要选择型号');
      }
      // boot TWRP → 等 ADB → adb reboot edl
      await this.bootTwrpAndWaitAdb(innermodel);
      await AdbService.reboot('edl');
    } else {
      throw new Error(`当前设备状态不支持重启至 9008: ${device.type}`);
    }
    logger.info('已发送重启至 9008 指令');
  }

  /** boot TWRP 并等待 ADB(供 recovery/edl 从 fastboot 模式重启用) */
  // 对应 rebootpro.bat:94-130 / 145-181 的公共流程
  private async bootTwrpAndWaitAdb(innermodel: string): Promise<void> {
    const twrpDir = paths.edlFile('twrp');
    if (!fs.existsSync(twrpDir)) {
      throw new Error('TWRP 镜像未下载,请先在"资源下载"页下载 TWRP');
    }
    const twrpImg = path.join(twrpDir, `${innermodel}.img`);
    if (!fs.existsSync(twrpImg)) {
      throw new Error(`TWRP 镜像不存在: ${innermodel}.img`);
    }
    const workDir = paths.edlWork;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    const dstImg = path.join(workDir, 'recovery.img');
    fs.copyFileSync(twrpImg, dstImg);

    // fastboot boot TWRP
    await FastbootService.boot(dstImg);
    logger.info('已临时启动 TWRP,等待 ADB...');

    // 等待 ADB 设备
    await DeviceService.instance.waitFor(['adb'], 30000);

    // 清理
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  // ========== 模式 5:临时启动 TWRP ==========
  // 对应 rebootpro.bat:185-228 :rebootP-twrp
  private async rebootTwrpTemp(innermodel: string): Promise<void> {
    if (!innermodel) {
      throw new Error('临时启动 TWRP 需要选择型号');
    }
    const device = DeviceService.instance.current();
    if (!device) {
      throw new Error('未检测到设备');
    }

    // 原 rebootpro.bat:189:adb reboot bootloader & goto rebootP-twrp-bl
    if (device.type === 'adb') {
      await AdbService.reboot('bootloader');
      // 等待 fastboot 设备
      logger.info('等待 Fastboot 设备...');
      await DeviceService.instance.waitFor(['fastboot'], 30000);
    }

    if (device.type !== 'fastboot' && device.type !== 'adb') {
      throw new Error('临时启动 TWRP 需要 ADB 或 Fastboot 设备');
    }

    // 原 rebootpro.bat:197:if not exist .\EDL\twrp call cloud twrp
    const twrpDir = paths.edlFile('twrp');
    if (!fs.existsSync(twrpDir)) {
      throw new Error('TWRP 镜像未下载,请先在"资源下载"页下载 TWRP');
    }

    // 原 rebootpro.bat:221:copy /Y .\EDL\twrp\%innermodel%.img .\EDL\rooting\recovery.img
    const twrpImg = path.join(twrpDir, `${innermodel}.img`);
    if (!fs.existsSync(twrpImg)) {
      throw new Error(`TWRP 镜像不存在: ${innermodel}.img`);
    }
    const workDir = paths.edlWork;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    const dstImg = path.join(workDir, 'recovery.img');
    fs.copyFileSync(twrpImg, dstImg);

    // 原 rebootpro.bat:223:fastboot boot EDL\rooting\recovery.img
    await FastbootService.boot(dstImg);
    logger.info('已临时启动 TWRP');

    // 原 rebootpro.bat:225:del /Q /F ".\EDL\rooting\*.*"
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  // ========== 模式 6-9:misc 进入 qmmi/ffbm/wipe-data/fastbootd ==========
  // 对应 rebootpro.bat:230-266 + :flash_device (268-343)
  private async flashMisc(
    mode: 'qmmi' | 'ffbm' | 'wipe-data' | 'fastbootd',
    platform: 'otherpash' | 'v3pash' | 'z10',
    innermodel: string,
  ): Promise<void> {
    if (!innermodel || !platform) {
      throw new Error(`${mode} 需要选择型号和平台`);
    }

    // 原 rebootpro.bat:306-309:请接入需要刷写的设备
    // device_check.exe qcom_edl adb → 若 adb 则 adb reboot edl
    let port = await EdlService.findPort();
    if (!port) {
      const device = DeviceService.instance.current();
      if (device?.type === 'adb') {
        // 原:adb reboot edl
        logger.info('设备在 ADB 模式,重启至 9008...');
        await AdbService.reboot('edl');
        // 等待 9008
        port = await EdlService.waitForEdl(60000);
      } else {
        throw new Error('未检测到 9008 设备,请将设备进入 9008 模式');
      }
    }

    // 原 rebootpro.bat:312-341:调用 :flash_device
    // EdlService.flashMisc 实现了 :flash_device 的完整逻辑
    const edlMode = mode === 'wipe-data' ? 'wipe' : mode;
    await EdlService.flashMisc({ port, mode: edlMode, platform, innermodel });

    const modeLabel: Record<typeof edlMode, string> = {
      qmmi: 'QMMI',
      ffbm: 'FFBM',
      wipe: '恢复出厂设置',
      fastbootd: 'fastbootd',
    };
    logger.info(`已进入 ${modeLabel[edlMode]}`);
  }

  // ========== 9008 设备重启(模式 1 的 EDL 分支) ==========
  // 对应 rebootpro.bat:46-68 :rebootP-reboot-edl
  private async edlReboot(): Promise<void> {
    const port = await EdlService.findPort();
    if (!port) {
      throw new Error('未检测到 9008 设备');
    }
    // 原 rebootpro.bat:50-55:选 loader(这里默认用 msm8937,真机时用户可调)
    // 简化:自动尝试常见 loader
    const loaders: EdlOptions['loader'][] = ['msm8937.mbn', 'msm8909w.mbn', 'prog_firehose_ddr.elf'];
    let loaded = false;
    for (const loader of loaders) {
      try {
        await EdlService.loadFirehose({ port, loader });
        loaded = true;
        break;
      } catch {
        // 尝试下一个 loader
      }
    }
    if (!loaded) {
      throw new Error('所有 firehose loader 加载失败');
    }
    // 原 rebootpro.bat:64-65:qfh_loader reboot.xml
    await EdlService.reboot({ port, loader: 'msm8937.mbn' });
  }
}

// 为 edlReboot 引用 EdlOptions 类型
import type { EdlOptions } from './EdlService';

export const RebootService = new RebootServiceClass();
