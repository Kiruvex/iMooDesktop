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

import { ipcMain, BrowserWindow } from 'electron';
import { BackupService, type AdbDdMatchResult } from '../services/BackupService';
import { EdlService } from '../services/EdlService';
import { DeviceService } from '../services/DeviceService';
import { Logger } from '../services/Logger';
import { checkIsV3 } from '../../shared/isv3';

const logger = Logger.instance;

function requireAdb(): boolean {
  const device = DeviceService.instance.current();
  return device?.type === 'adb';
}

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
    async (_evt, { outputDir }: { outputDir: string }): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        const r = await BackupService.backupDcim(outputDir, emitProgress);
        return r;
      } catch (e) {
        logger.error('backup', `DCIM 备份失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // DCIM 恢复(对应 backup.bat :DCIM-recover)
  ipcMain.handle(
    'backup:dcim-recover',
    async (_evt, { inputDir }: { inputDir: string }): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        const r = await BackupService.recoverDcim(inputDir, emitProgress);
        return r;
      } catch (e) {
        logger.error('backup', `DCIM 恢复失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== ADB-dd ==========

  // ADB-dd 备份(对应 backup.bat :adb-dd-backup)
  ipcMain.handle(
    'backup:adbdd-backup',
    async (_evt, { outputDir }: { outputDir: string }): Promise<{ success: boolean; zipPath?: string; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        const r = await BackupService.backupAdbDd(outputDir, emitProgress);
        return r;
      } catch (e) {
        logger.error('backup', `ADB-dd 备份失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ADB-dd 恢复-准备阶段(解压 + 匹配分区,等待用户确认)
  // 拆为两步是为了让 UI 在确认前能展示匹配的分区列表
  ipcMain.handle(
    'backup:adbdd-prepare',
    async (
      _evt,
      { zipPath }: { zipPath: string },
    ): Promise<{ success: boolean; extractDir?: string; match?: AdbDdMatchResult; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        return await BackupService.prepareAdbDdRecover(zipPath, emitProgress);
      } catch (e) {
        logger.error('backup', `ADB-dd 恢复准备失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ADB-dd 恢复-执行阶段(用户确认后调用)
  ipcMain.handle(
    'backup:adbdd-execute',
    async (
      _evt,
      { extractDir, parts }: { extractDir: string; parts: string[] },
    ): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        return await BackupService.executeAdbDdRecover(extractDir, parts, emitProgress);
      } catch (e) {
        logger.error('backup', `ADB-dd 恢复执行失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ADB-dd 恢复-一站式入口(无需 UI 确认的快速调用)
  ipcMain.handle(
    'backup:adbdd-recover',
    async (_evt, { zipPath }: { zipPath: string }): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        // 自动确认(直接执行所有匹配分区)
        const r = await BackupService.recoverAdbDd(zipPath, emitProgress, async () => true);
        return r;
      } catch (e) {
        logger.error('backup', `ADB-dd 恢复失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== 9008 EDL ==========

  // 9008 备份(对应 backup.bat :9008-backup-run)
  // 参数:innermodel(型号)、v3(V3 协议,可自动从 innermodel+softVersion 推断)、outputDir
  ipcMain.handle(
    'backup:edl-backup',
    async (
      _evt,
      opts: { innermodel: string; v3?: boolean; softVersion?: string; outputDir: string },
    ): Promise<{ success: boolean; zipPath?: string; error?: string }> => {
      try {
        // 若未传 v3,根据 innermodel + softVersion 自动推断(对应 isv3.bat 的行为)
        let v3 = opts.v3;
        if (v3 === undefined) {
          v3 = checkIsV3(opts.innermodel, opts.softVersion ?? '');
        }
        const zipPath = await EdlService.backup9008({
          innermodel: opts.innermodel,
          v3,
          outputDir: opts.outputDir,
          onProgress: emitProgress,
        });
        return { success: true, zipPath };
      } catch (e) {
        logger.error('backup', `9008 备份失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 9008 恢复(对应 backup.bat :9008-recover)
  ipcMain.handle(
    'backup:edl-recover',
    async (_evt, { zipPath }: { zipPath: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        await EdlService.recover9008({ zipPath, onProgress: emitProgress });
        return { success: true };
      } catch (e) {
        logger.error('backup', `9008 恢复失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== 超级恢复(对应 super_recovery.bat) ==========

  ipcMain.handle(
    'backup:super-recovery',
    async (_evt, { folder }: { folder: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        await EdlService.superRecovery({ folder, onProgress: emitProgress });
        return { success: true };
      } catch (e) {
        logger.error('backup', `超级恢复失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== TWRP 刷入(对应 pashtwrp.bat) ==========

  ipcMain.handle(
    'backup:flash-twrp',
    async (_evt, { innermodel }: { innermodel: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        await EdlService.flashTwrp({ innermodel, onProgress: emitProgress });
        return { success: true };
      } catch (e) {
        logger.error('backup', `TWRP 刷入失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== 开机自刷 TWRP(对应 pashtwrppro.bat) ==========

  ipcMain.handle(
    'backup:auto-flash-twrp',
    async (_evt, { innermodel }: { innermodel: string }): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        const r = await BackupService.autoFlashTwrp(innermodel, emitProgress);
        return r;
      } catch (e) {
        logger.error('backup', `开机自刷 TWRP 失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== Xposed 安装(对应 Xposed.bat) ==========

  ipcMain.handle(
    'backup:xposed-install',
    async (): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        const r = await BackupService.installXposed(emitProgress);
        return r;
      } catch (e) {
        logger.error('backup', `Xposed 安装失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  logger.info('ipc', 'backup:* 通道已注册');
}
