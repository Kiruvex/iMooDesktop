// electron/services/RootProService.ts - Android 8.1 Root 后优化(SDK27 专属)
// 对应原 rootpro.bat
//
// 逻辑保真(命令参数逐字一致):
//   rootpro.bat 流程:
//     1. call boot_completed.bat(等待开机完成)
//     2. 读 innermodel / model / androidversion / sdkversion / version
//     3. if not "%sdkversion%"=="27" exit /b(只支持 SDK27)
//     4. call isv3
//     5. adb shell pm path com.android.systemui(检查 SystemUI 是否存在)
//     6. 可选:y 安装拓展应用包(读 rootproapks/rootproapks.txt,逐个 call instapp.bat)
//     7. 可选:y 装禁用模式切换桌面
//          isv3+havesystemui → 130510_D.apk
//          isv3+!havesystemui → 121750_D.apk
//          !isv3 → 116100_D.apk
//     8. 可选:y 刷拓展 magisk 模块(读 magiskmod/rootpromods.txt,逐个 call instmodule.bat)
//
// 注:原 .bat 用 set /p 接收用户输入(y 跳过);这里通过 options 由 UI 决定是否执行各步骤

import { AdbService } from './AdbService';
import { TIMEOUT } from '../lib/timeouts';
import { MagiskService } from './MagiskService';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import { checkIsV3 } from '../../shared/isv3';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('RootProService');

export interface RootProOptions {
  /** 安装拓展应用包(读 rootproapks/rootproapks.txt,逐个 instapp) */
  installApks?: boolean;
  /** 安装禁用模式切换桌面(isv3+havesystemui → 130510_D;isv3+!havesystemui → 121750_D;!isv3 → 116100_D) */
  installDesktop?: boolean;
  /** 刷拓展 magisk 模块(读 magiskmod/rootpromods.txt,逐个 instmodule magisk) */
  installMods?: boolean;
}

export interface RootProStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
}

export interface RootProResult {
  success: boolean;
  supported: boolean;
  steps: RootProStep[];
  /** 检测到的设备信息 */
  innermodel?: string;
  model?: string;
  androidVersion?: string;
  sdkVersion?: string;
  softVersion?: string;
  isV3?: boolean;
  haveSystemUI?: boolean;
  error?: string;
}

class RootProServiceClass {
  /**
   * 执行 Root 后优化(对应 rootpro.bat 完整流程)
   */
  async run(options: RootProOptions): Promise<RootProResult> {
    const steps: RootProStep[] = [
      { name: '检查 ADB 设备', status: 'pending' },
      { name: '等待 boot_completed', status: 'pending' },
      { name: '读取设备信息', status: 'pending' },
      { name: '检查 SDK=27', status: 'pending' },
      { name: '检测 isv3', status: 'pending' },
      { name: '检查 SystemUI(pm path)', status: 'pending' },
      { name: '安装拓展应用包', status: 'pending' },
      { name: '安装禁用模式切换桌面', status: 'pending' },
      { name: '刷拓展 magisk 模块', status: 'pending' },
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

    const skipStep = (i: number, reason: string): void => {
      steps[i].status = 'skipped';
      steps[i].message = reason;
    };

    const result: RootProResult = {
      success: false,
      supported: false,
      steps,
    };

    // 步骤 1:检查 ADB 设备
    let ok = await runStep(0, async () => {
      const devices = await AdbService.devices();
      if (devices.length === 0) {
        throw new Error('未检测到 ADB 设备');
      }
    });
    if (!ok) {
      result.error = steps[0].message;
      return result;
    }

    // 步骤 2:等待 boot_completed(对应 call boot_completed.bat)
    ok = await runStep(1, async () => {
      await AdbService.waitForBoot(120000);
    });
    if (!ok) {
      result.error = steps[1].message;
      return result;
    }

    // 步骤 3:读取设备信息
    let innermodel = '';
    let model = '';
    let androidVersion = '';
    let sdkVersion = '';
    let softVersion = '';
    ok = await runStep(2, async () => {
      innermodel = await AdbService.getprop('ro.product.innermodel');
      model = await AdbService.getprop('ro.product.model');
      androidVersion = await AdbService.getprop('ro.build.version.release');
      sdkVersion = await AdbService.getprop('ro.build.version.sdk');
      softVersion = await AdbService.getprop('ro.product.current.softversion');
      logger.info(
        `innermodel=${innermodel}, model=${model}, android=${androidVersion}, sdk=${sdkVersion}, version=${softVersion}`,
      );
      result.innermodel = innermodel;
      result.model = model;
      result.androidVersion = androidVersion;
      result.sdkVersion = sdkVersion;
      result.softVersion = softVersion;
    });
    if (!ok) {
      result.error = steps[2].message;
      return result;
    }

    // 步骤 4:检查 SDK=27
    ok = await runStep(3, async () => {
      if (sdkVersion !== '27') {
        throw new Error('你的安卓版本不是 8.1,该功能不支持你的手表');
      }
      result.supported = true;
    });
    if (!ok) {
      result.error = steps[3].message;
      return result;
    }

    // 步骤 5:检测 isv3(对应 call isv3)
    let isV3 = false;
    ok = await runStep(4, async () => {
      isV3 = checkIsV3(innermodel, softVersion);
      result.isV3 = isV3;
      logger.info(`isV3=${isV3}`);
    });
    if (!ok) {
      result.error = steps[4].message;
      return result;
    }

    // 步骤 6:检查 SystemUI(对应:adb shell pm path com.android.systemui)
    let haveSystemUI = false;
    ok = await runStep(5, async () => {
      const out = await AdbService.shell('pm path com.android.systemui', { timeout: TIMEOUT.shell });
      // 原 .bat:if %errorlevel%==0 set havesystemui=1
      // pm path 返回非空(包名前缀 package:)=存在
      haveSystemUI = out.trim().length > 0 && out.includes('package:');
      result.haveSystemUI = haveSystemUI;
      logger.info(`haveSystemUI=${haveSystemUI}`);
    });
    if (!ok) {
      result.error = steps[5].message;
      return result;
    }

    // 步骤 7:可选 - 安装拓展应用包
    if (!options.installApks) {
      skipStep(6, '用户未选择');
    } else {
      ok = await runStep(6, async () => {
        await this.installRootProApks();
      });
      if (!ok) {
        // 安装应用包失败不中断整体流程,只标记失败
        logger.warn(`安装拓展应用包失败: ${steps[6].message}`);
      }
    }

    // 步骤 8:可选 - 安装禁用模式切换桌面
    if (!options.installDesktop) {
      skipStep(7, '用户未选择');
    } else {
      ok = await runStep(7, async () => {
        await this.installDesktopApk(isV3, haveSystemUI);
      });
      if (!ok) {
        logger.warn(`安装桌面失败: ${steps[7].message}`);
      }
    }

    // 步骤 9:可选 - 刷拓展 magisk 模块
    if (!options.installMods) {
      skipStep(8, '用户未选择');
    } else {
      ok = await runStep(8, async () => {
        await this.installRootProMods();
      });
      if (!ok) {
        logger.warn(`安装 magisk 模块失败: ${steps[8].message}`);
      }
    }

    result.success = true;
    logger.info('Root 后优化全部完成');
    return result;
  }

  /**
   * 安装拓展应用包
   * 对应:
   *   if not exist ".\rootproapks\rootproapks.txt" echo 找不到 rootproapks.txt
   *   for /f %%i in (rootproapks.txt) do call instapp.bat ".\rootproapks\%%i"
   */
  private async installRootProApks(): Promise<void> {
    const apksDir = path.join(paths.resources, 'rootproapks');
    const txtPath = path.join(apksDir, 'rootproapks.txt');
    if (!fs.existsSync(txtPath)) {
      throw new Error('找不到 rootproapks/rootproapks.txt 无法完成安装');
    }
    const lines = fs.readFileSync(txtPath, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const apkPath = path.join(apksDir, line);
      if (!fs.existsSync(apkPath)) {
        logger.warn(`APK 不存在,跳过: ${apkPath}`);
        continue;
      }
      logger.info(`安装拓展应用: ${line}`);
      // 对应 call instapp.bat(默认 install 方法 = adb install -r -t -d)
      const result = await AdbService.install(apkPath, 'install');
      if (!result.success) {
        logger.warn(`安装失败: ${line}`);
      }
    }
  }

  /**
   * 安装禁用模式切换桌面
   * 对应:
   *   if "%isv3%"=="1" (
   *     if "%havesystemui%"=="1" call instapp.bat .\rootproapks\130510_D.apk
   *     else call instapp.bat .\rootproapks\121750_D.apk
   *   ) else call instapp.bat .\rootproapks\116100_D.apk
   */
  private async installDesktopApk(isV3: boolean, haveSystemUI: boolean): Promise<void> {
    const apksDir = path.join(paths.resources, 'rootproapks');
    let apkName: string;
    if (isV3) {
      apkName = haveSystemUI ? '130510_D.apk' : '121750_D.apk';
    } else {
      apkName = '116100_D.apk';
    }
    const apkPath = path.join(apksDir, apkName);
    if (!fs.existsSync(apkPath)) {
      throw new Error(`桌面 APK 不存在: ${apkName}`);
    }
    logger.info(`安装禁用模式切换桌面: ${apkName}(isv3=${isV3}, havesystemui=${haveSystemUI})`);
    const result = await AdbService.install(apkPath, 'install');
    if (!result.success) {
      throw new Error(`安装桌面失败: ${apkName}`);
    }
  }

  /**
   * 刷拓展 magisk 模块
   * 对应:
   *   if not exist ".\magiskmod\rootpromods.txt" echo 找不到 rootpromods.txt
   *   for /f %%i in (rootpromods.txt) do call instmodule.bat ".\magiskmod\%%i"
   * 注:instmodule.bat 默认 :magisk 方式(本服务调 MagiskService.install(zip, 'magisk'))
   */
  private async installRootProMods(): Promise<void> {
    const modsDir = path.join(paths.resources, 'magiskmod');
    const txtPath = path.join(modsDir, 'rootpromods.txt');
    if (!fs.existsSync(txtPath)) {
      throw new Error('找不到 magiskmod/rootpromods.txt 无法完成安装');
    }
    const lines = fs.readFileSync(txtPath, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const zipPath = path.join(modsDir, line);
      if (!fs.existsSync(zipPath)) {
        logger.warn(`模块 zip 不存在,跳过: ${zipPath}`);
        continue;
      }
      logger.info(`刷入拓展 magisk 模块: ${line}`);
      const result = await MagiskService.install(zipPath, 'magisk');
      if (!result.success) {
        logger.warn(`模块安装失败: ${line} - ${result.error}`);
      }
    }
  }
}

export const RootProService = new RootProServiceClass();
