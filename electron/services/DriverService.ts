// electron/services/DriverService.ts - 驱动检测与安装
// 对应原 checkdriver.bat(M5)
//
// 逻辑保真(检测路径与原 .bat 逐字一致):
//   checkdriver.bat:
//     REM edl
//     set QUALCOMM=0
//     if exist "%SystemRoot%\System32\DriverStore\FileRepository\qdbusb*" set QUALCOMM=1
//     if exist "%SystemRoot%\System32\DriverStore\FileRepository\qcfilter*" set QUALCOMM=1
//     if exist "%SystemRoot%\System32\DriverStore\FileRepository\qcmbn*" set QUALCOMM=1
//     REM ADB
//     set ADB_INSTALLED=0
//     if exist "%SystemRoot%\System32\DriverStore\FileRepository\android_winusb.inf*" set ADB_INSTALLED=1
//     REM VC 运行库
//     set VC_RUNTIMES=1
//     if not exist "%SystemRoot%\System32\mfc100*" set VC_RUNTIMES=0
//     if not exist "%SystemRoot%\System32\mfc110*" set VC_RUNTIMES=0
//     if not exist "%SystemRoot%\System32\mfc120*" set VC_RUNTIMES=0
//
//   安装:
//     if not exist .\drivers call cloud drivers
//     ADB: pnputil /add-driver ".\drivers\adb\android_winusb.inf" /install
//     Qualcomm: pushd .\drivers\9008\ & call 9008.bat & popd
//     VC: .\drivers\vc.exe

import { SubprocessPool } from './SubprocessPool';
import { CloudService } from './CloudService';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import path from 'node:path';
import fs from 'node:fs';

const logger = Logger.instance.child('DriverService');

export interface DriverStatus {
  qualcomm: boolean;
  adb: boolean;
  vcRuntime: boolean;
}

export interface DriverCheckResult {
  success: boolean;
  status: DriverStatus;
  /** 是否所有驱动都已安装(若全 true 则原 .bat exit /b) */
  allInstalled: boolean;
}

export interface DriverInstallStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
}

export interface DriverInstallResult {
  success: boolean;
  steps: DriverInstallStep[];
  error?: string;
}

class DriverServiceClass {
  /**
   * 检查驱动状态
   * 对应 checkdriver.bat 上半段(只检测,不安装)
   */
  async check(): Promise<DriverCheckResult> {
    // REM edl: QUALCOMM
    const qualcomm =
      (await this.existsGlobInDir('qdbusb*')) ||
      (await this.existsGlobInDir('qcfilter*')) ||
      (await this.existsGlobInDir('qcmbn*'));

    // REM ADB: ADB_INSTALLED
    const adb = await this.existsGlobInDir('android_winusb.inf*');

    // REM VC 运行库: VC_RUNTIMES(原 .bat 用 mfc100*/110*/120*,System32 根目录)
    const vcRuntime =
      (await this.existsGlobInSystem32('mfc100*')) &&
      (await this.existsGlobInSystem32('mfc110*')) &&
      (await this.existsGlobInSystem32('mfc120*'));

    const status: DriverStatus = { qualcomm, adb, vcRuntime };
    const allInstalled = qualcomm && adb && vcRuntime;
    logger.info(
      `驱动检查: qualcomm=${qualcomm}, adb=${adb}, vc=${vcRuntime}, all=${allInstalled}`,
    );
    return { success: true, status, allInstalled };
  }

  /**
   * 安装缺失的驱动
   * 对应 checkdriver.bat 下半段
   */
  async installDrivers(): Promise<DriverInstallResult> {
    const steps: DriverInstallStep[] = [
      { name: '检查驱动状态', status: 'pending' },
      { name: '下载 drivers.zip(若未下载)', status: 'pending' },
      { name: '安装 ADB 驱动(pnputil)', status: 'pending' },
      { name: '安装 Qualcomm 9008 驱动(9008.bat)', status: 'pending' },
      { name: '安装 VC 运行库(vc.exe)', status: 'pending' },
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

    // 步骤 1:检查驱动状态
    let status: DriverStatus | null = null;
    let ok = await runStep(0, async () => {
      const r = await this.check();
      status = r.status;
    });
    if (!ok) return { success: false, steps, error: steps[0].message };

    // 步骤 2:下载 drivers(对应:if not exist .\drivers call cloud drivers)
    ok = await runStep(1, async () => {
      const driversDir = path.join(paths.resources, 'drivers');
      if (fs.existsSync(driversDir)) {
        skipStep(1, 'drivers 已存在,跳过下载');
        return;
      }
      logger.info('下载 drivers 资源...');
      await CloudService.download('drivers');
    });

    // 步骤 3:安装 ADB 驱动(对应:pnputil /add-driver ".\drivers\adb\android_winusb.inf" /install)
    if (status!.adb) {
      skipStep(2, 'ADB 驱动已安装');
    } else {
      ok = await runStep(2, async () => {
        const infPath = path.join(paths.resources, 'drivers', 'adb', 'android_winusb.inf');
        if (!fs.existsSync(infPath)) {
          throw new Error(`ADB 驱动 inf 不存在: ${infPath}`);
        }
        logger.info('安装 ADB 驱动...');
        // 原:pnputil /add-driver ".\drivers\adb\android_winusb.inf" /install
        await SubprocessPool.spawn({
          cmd: 'pnputil.exe',
          args: ['/add-driver', infPath, '/install'],
          encoding: 'gbk',
          timeout: 60000,
        });
      });
      if (!ok) logger.warn(`ADB 驱动安装失败: ${steps[2].message}`);
    }

    // 步骤 4:安装 Qualcomm 9008 驱动(对应:pushd .\drivers\9008\ & call 9008.bat & popd)
    if (status!.qualcomm) {
      skipStep(3, 'Qualcomm 9008 驱动已安装');
    } else {
      ok = await runStep(3, async () => {
        const batPath = path.join(paths.resources, 'drivers', '9008', '9008.bat');
        if (!fs.existsSync(batPath)) {
          throw new Error(`9008.bat 不存在: ${batPath}`);
        }
        logger.info('安装 Qualcomm 9008 驱动...');
        // 原:pushd .\drivers\9008\ & call 9008.bat & popd
        await SubprocessPool.spawn({
          cmd: 'cmd.exe',
          args: ['/c', batPath],
          encoding: 'gbk',
          timeout: 120000,
          cwd: path.dirname(batPath),
        });
      });
      if (!ok) logger.warn(`Qualcomm 9008 驱动安装失败: ${steps[3].message}`);
    }

    // 步骤 5:安装 VC 运行库(对应:.\drivers\vc.exe)
    if (status!.vcRuntime) {
      skipStep(4, 'VC 运行库已安装');
    } else {
      ok = await runStep(4, async () => {
        const vcPath = path.join(paths.resources, 'drivers', 'vc.exe');
        if (!fs.existsSync(vcPath)) {
          throw new Error(`vc.exe 不存在: ${vcPath}`);
        }
        logger.info('安装 VC 运行库...');
        await SubprocessPool.spawn({
          cmd: vcPath,
          args: [],
          encoding: 'gbk',
          timeout: 120000,
        });
      });
      if (!ok) logger.warn(`VC 运行库安装失败: ${steps[4].message}`);
    }

    logger.info('驱动和环境配置完毕,部分更改可能需要重启电脑以完成安装');
    return { success: true, steps };
  }

  /**
   * 在 %SystemRoot%\System32\DriverStore\FileRepository\ 下检查通配符路径是否存在
   * 对应原 .bat:if exist "%SystemRoot%\System32\DriverStore\FileRepository\<glob>"
   */
  private async existsGlobInDir(glob: string): Promise<boolean> {
    const baseDir = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'DriverStore', 'FileRepository');
    return this.existsGlob(baseDir, glob);
  }

  /** 在 %SystemRoot%\System32\ 下检查通配符(对应 if exist "%SystemRoot%\System32\mfc100*") */
  private async existsGlobInSystem32(glob: string): Promise<boolean> {
    const baseDir = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    return this.existsGlob(baseDir, glob);
  }

  /**
   * 通配符匹配目录或文件是否存在
   * 原 .bat 用 if exist <path>\<glob>,Windows cmd 会展开 * 通配符
   */
  private async existsGlob(baseDir: string, glob: string): Promise<boolean> {
    try {
      if (!fs.existsSync(baseDir)) return false;
      const entries = await fs.promises.readdir(baseDir);
      // 简单 glob:把 * 转换为正则
      const regex = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return entries.some((e) => regex.test(e));
    } catch {
      return false;
    }
  }
}

export const DriverService = new DriverServiceClass();
