// electron/ipc/edlPartition.ts - edl-part:* 通道(EDL 分区管理,基于 edl-ng)
//
// 通道列表:
//   edl-part:list-loaders      列出可用 firehose loader
//   edl-part:check-edl-device  检查设备是否在 9008 模式
//   edl-part:print-gpt         实时读设备 GPT 分区表
//   edl-part:backup-partition  备份单个分区
//   edl-part:restore-partition 恢复单个分区(含备份/校验选项)
//   edl-part:erase-partition   擦除单个分区
//   edl-part:verify-partition  校验分区(读回比对)
//   edl-part:reset-device      重启设备
//   edl-part:get-history       获取操作历史
//   edl-part:clear-history     清空操作历史

import { ipcMain } from 'electron';
import { EdlPartitionService } from '../services/EdlPartitionService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerEdlPartitionIpc(): void {
  // 列出可用 firehose loader
  ipcMain.handle('edl-part:list-loaders', async () => {
    return { success: true, loaders: EdlPartitionService.listLoaders() };
  });

  // 检查设备是否在 9008 模式
  ipcMain.handle('edl-part:check-edl-device', async () => {
    try {
      const result = await EdlPartitionService.checkEdlDevice();
      return { success: true, ...result };
    } catch (e) {
      return { success: false, inEdl: false, error: (e as Error).message };
    }
  });

  // 实时读 GPT 分区表(基于 edl-ng printgpt)
  ipcMain.handle(
    'edl-part:print-gpt',
    async (evt, opts: { loader: string }) => {
      return EdlPartitionService.printGpt({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
    },
  );

  // 备份单个分区
  ipcMain.handle(
    'edl-part:backup-partition',
    async (
      evt,
      opts: { loader: string; label: string; outputFile: string },
    ) => {
      return EdlPartitionService.backupPartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
        onTransferProgress: (p) => {
          evt.sender.send('edl-part:transfer-progress', p);
        },
      });
    },
  );

  // 恢复单个分区
  ipcMain.handle(
    'edl-part:restore-partition',
    async (
      evt,
      opts: {
        loader: string;
        label: string;
        inputFile: string;
        backupBeforeRestore?: boolean;
        backupOutputDir?: string;
        verifyAfterRestore?: boolean;
      },
    ) => {
      return EdlPartitionService.restorePartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
        onTransferProgress: (p) => {
          evt.sender.send('edl-part:transfer-progress', p);
        },
      });
    },
  );

  // 擦除单个分区
  ipcMain.handle(
    'edl-part:erase-partition',
    async (
      evt,
      opts: { loader: string; label: string },
    ) => {
      return EdlPartitionService.erasePartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
    },
  );

  // 校验分区
  ipcMain.handle(
    'edl-part:verify-partition',
    async (
      evt,
      opts: { loader: string; label: string; expectedFile: string },
    ) => {
      const result = await EdlPartitionService.verifyPartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
        onTransferProgress: (p) => {
          evt.sender.send('edl-part:transfer-progress', p);
        },
      });
      return { success: true, result };
    },
  );

  // 重启设备
  ipcMain.handle(
    'edl-part:reset-device',
    async (evt, opts: { loader: string }) => {
      return EdlPartitionService.resetDevice({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
    },
  );

  // 操作历史
  ipcMain.handle('edl-part:get-history', async () => {
    return { success: true, history: EdlPartitionService.getHistory() };
  });

  ipcMain.handle('edl-part:clear-history', async () => {
    EdlPartitionService.clearHistory();
    return { success: true };
  });

  logger.info('ipc', 'edl-part:* 通道已注册');
}
