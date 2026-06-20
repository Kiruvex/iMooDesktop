// electron/ipc/backup.ts - backup:* 通道
// 见 plan.md 8.1 通道命名规范 + 6.11 BackupService + 6.5 EdlService
//
// 备份恢复相关通道,涵盖:
//   - DCIM 备份/恢复(BackupService)
//   - ADB-dd 备份/恢复(BackupService)
//   - 9008 备份/恢复(EdlService.backup9008 / recover9008)
//   - 超级恢复(EdlService.superRecovery)
//   - TWRP 刷入(EdlService.flashTwrp)
//   - 开机自刷 TWRP(BackupService.autoFlashTwrp)
//   - Xposed 安装(BackupService.installXposed)
//
// 设备模式要求:
//   - DCIM / ADB-dd / 开机自刷 TWRP / Xposed 安装:需要 ADB 模式(adb shell su -c)
//   - 9008 备份/恢复 / 超级恢复 / TWRP 刷入:需要 9008 EDL 模式(fh_loader 通信)
//     (EdlService 内部通过 waitForEdl 等待 9008 设备,无需在 IPC 层预检)
//
// 重构:用 wrap 高阶函数消除重复 requireAdb + try-catch

import { ipcMain, BrowserWindow } from 'electron';
import { BackupService, type AdbDdMatchResult } from '../services/BackupService';
import { EdlService } from '../services/EdlService';
import { Logger } from '../services/Logger';
import { checkIsV3 } from '../../shared/isv3';
import { wrap, wrapNoArgs } from '../lib/ipcHelper';

const logger = Logger.instance;

/**
 * 推送进度事件到所有渲染进程
 * 渲染进程通过 api.backup.onProgress(cb) 订阅 'backup:progress' 事件
 */
function emitProgress(msg: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('backup:progress', { msg, ts: Date.now() });
    }
  }
}

export function registerBackupIpc(): void {
  // ========== DCIM ==========

  // DCIM 备份(对应 backup.bat :DCIM-backup)
  ipcMain.handle(
    'backup:dcim-backup',
    wrap(({ outputDir }: { outputDir: string }) =>
      BackupService.backupDcim(outputDir, emitProgress),
    { requireDevice: 'adb', logPrefix: 'backup' }),
  );

  // DCIM 恢复(对应 backup.bat :DCIM-recover)
  ipcMain.handle(
    'backup:dcim-recover',
    wrap(({ inputDir }: { inputDir: string }) =>
      BackupService.recoverDcim(inputDir, emitProgress),
    { requireDevice: 'adb', logPrefix: 'backup' }),
  );

  // ========== ADB-dd ==========

  // ADB-dd 备份(对应 backup.bat :adb-dd-backup)
  ipcMain.handle(
    'backup:adbdd-backup',
    wrap(({ outputDir }: { outputDir: string }) =>
      BackupService.backupAdbDd(outputDir, emitProgress),
    { requireDevice: 'adb', logPrefix: 'backup' }),
  );

  // ADB-dd 恢复-准备阶段(解压 + 匹配分区,等待用户确认)
  // 拆为两步是为了让 UI 在确认前能展示匹配的分区列表
  ipcMain.handle(
    'backup:adbdd-prepare',
    wrap(({ zipPath }: { zipPath: string }) =>
      BackupService.prepareAdbDdRecover(zipPath, emitProgress) as Promise<{ success: boolean; extractDir?: string; match?: AdbDdMatchResult; error?: string }>,
    { requireDevice: 'adb', logPrefix: 'backup' }),
  );

  // ADB-dd 恢复-执行阶段(用户确认后调用)
  ipcMain.handle(
    'backup:adbdd-execute',
    wrap(({ extractDir, parts }: { extractDir: string; parts: string[] }) =>
      BackupService.executeAdbDdRecover(extractDir, parts, emitProgress),
    { requireDevice: 'adb', logPrefix: 'backup' }),
  );

  // ADB-dd 恢复-一站式入口(无需 UI 确认的快速调用)
  ipcMain.handle(
    'backup:adbdd-recover',
    wrap(({ zipPath }: { zipPath: string }) =>
      BackupService.recoverAdbDd(zipPath, emitProgress, async () => true),
    { requireDevice: 'adb', logPrefix: 'backup' }),
  );

  // ========== 9008 EDL ==========

  // 9008 备份(对应 backup.bat :9008-backup-run)
  // 参数:innermodel(型号)、v3(V3 协议,可自动从 innermodel+softVersion 推断)、outputDir
  ipcMain.handle(
    'backup:edl-backup',
    wrap((opts: { innermodel: string; v3?: boolean; softVersion?: string; outputDir: string }) => {
      // 若未传 v3,根据 innermodel + softVersion 自动推断(对应 isv3.bat 的行为)
      const v3 = opts.v3 ?? checkIsV3(opts.innermodel, opts.softVersion ?? '');
      return EdlService.backup9008({
        innermodel: opts.innermodel,
        v3,
        outputDir: opts.outputDir,
        onProgress: emitProgress,
      }).then((zipPath) => ({ success: true, zipPath }));
    }, { logPrefix: 'backup' }),
  );

  // 9008 恢复(对应 backup.bat :9008-recover)
  ipcMain.handle(
    'backup:edl-recover',
    wrap(({ zipPath }: { zipPath: string }) =>
      EdlService.recover9008({ zipPath, onProgress: emitProgress }).then(() => ({ success: true })),
    { logPrefix: 'backup' }),
  );

  // ========== 超级恢复(对应 super_recovery.bat) ==========

  ipcMain.handle(
    'backup:super-recovery',
    wrap(({ folder }: { folder: string }) =>
      EdlService.superRecovery({ folder, onProgress: emitProgress }).then(() => ({ success: true })),
    { logPrefix: 'backup' }),
  );

  // ========== TWRP 刷入(对应 pashtwrp.bat) ==========

  ipcMain.handle(
    'backup:flash-twrp',
    wrap(({ innermodel }: { innermodel: string }) =>
      EdlService.flashTwrp({ innermodel, onProgress: emitProgress }).then(() => ({ success: true })),
    { logPrefix: 'backup' }),
  );

  // ========== 开机自刷 TWRP(对应 pashtwrppro.bat) ==========

  ipcMain.handle(
    'backup:auto-flash-twrp',
    wrap(({ innermodel }: { innermodel: string }) =>
      BackupService.autoFlashTwrp(innermodel, emitProgress),
    { requireDevice: 'adb', logPrefix: 'backup' }),
  );

  // ========== Xposed 安装(对应 Xposed.bat) ==========

  ipcMain.handle(
    'backup:xposed-install',
    wrapNoArgs(() => BackupService.installXposed(emitProgress), {
      requireDevice: 'adb',
      logPrefix: 'backup',
    }),
  );

  logger.info('ipc', 'backup:* 通道已注册');
}
