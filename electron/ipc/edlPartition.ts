// electron/ipc/edlPartition.ts - edl-part:* 通道(EDL 分区管理)
//
// 基于 EdlPartitionService(QSaharaServer + fh_loader)
// 通道列表:
//   edl-part:list-models       列出可用型号(扫描 allxml)
//   edl-part:list-partitions   列出指定型号的分区
//   edl-part:get-partition-info 获取单个分区信息(含是否关键)
//   edl-part:check-edl-device  检查设备是否在 9008 模式
//   edl-part:backup-partition  备份单个分区
//   edl-part:restore-partition 恢复单个分区(含校验/备份选项)
//   edl-part:erase-partition   擦除单个分区
//   edl-part:verify-partition  校验分区(读回比对)
//   edl-part:reset-device      重启设备回系统
//   edl-part:get-history       获取操作历史
//   edl-part:clear-history     清空操作历史

import { ipcMain } from 'electron';
import { EdlPartitionService } from '../services/EdlPartitionService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerEdlPartitionIpc(): void {
  // 列出可用型号(不连设备可用)
  ipcMain.handle('edl-part:list-models', async () => {
    try {
      const models = await EdlPartitionService.listModels();
      return { success: true, models };
    } catch (e) {
      return { success: false, models: [], error: (e as Error).message };
    }
  });

  // 列出指定型号的分区(不连设备可用)
  ipcMain.handle(
    'edl-part:list-partitions',
    async (_evt, { innermodel }: { innermodel: string }) => {
      try {
        const partitions = await EdlPartitionService.listPartitions(innermodel);
        return { success: true, partitions };
      } catch (e) {
        return { success: false, partitions: [], error: (e as Error).message };
      }
    },
  );

  // 获取单个分区信息(含是否关键分区)
  ipcMain.handle(
    'edl-part:get-partition-info',
    async (_evt, { innermodel, label }: { innermodel: string; label: string }) => {
      try {
        const info = await EdlPartitionService.getPartitionInfo(innermodel, label);
        return { success: true, info };
      } catch (e) {
        return { success: false, info: null, error: (e as Error).message };
      }
    },
  );

  // 检查设备是否在 9008 模式
  ipcMain.handle('edl-part:check-edl-device', async () => {
    try {
      const result = await EdlPartitionService.checkEdlDevice();
      return { success: true, ...result };
    } catch (e) {
      return { success: false, inEdl: false, error: (e as Error).message };
    }
  });

  // 备份单个分区(带进度事件)
  ipcMain.handle(
    'edl-part:backup-partition',
    async (
      evt,
      opts: {
        innermodel: string;
        label: string;
        outputFile: string;
        v3: boolean;
      },
    ) => {
      const result = await EdlPartitionService.backupPartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
      return result;
    },
  );

  // 恢复单个分区(含备份/校验选项,带进度事件)
  ipcMain.handle(
    'edl-part:restore-partition',
    async (
      evt,
      opts: {
        innermodel: string;
        label: string;
        inputFile: string;
        v3: boolean;
        backupBeforeRestore?: boolean;
        backupOutputDir?: string;
        verifyAfterRestore?: boolean;
      },
    ) => {
      const result = await EdlPartitionService.restorePartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
      return result;
    },
  );

  // 校验分区(读回比对)
  ipcMain.handle(
    'edl-part:verify-partition',
    async (
      evt,
      opts: {
        innermodel: string;
        label: string;
        expectedFile: string;
        v3: boolean;
      },
    ) => {
      const result = await EdlPartitionService.verifyPartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
      return { success: true, result };
    },
  );

  // 擦除单个分区(阶段二,带进度事件)
  ipcMain.handle(
    'edl-part:erase-partition',
    async (
      evt,
      opts: {
        innermodel: string;
        label: string;
        v3: boolean;
      },
    ) => {
      const result = await EdlPartitionService.erasePartition({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
      return result;
    },
  );

  // 重启设备
  ipcMain.handle(
    'edl-part:reset-device',
    async (
      evt,
      opts: { innermodel: string; v3: boolean },
    ) => {
      const result = await EdlPartitionService.resetDevice({
        ...opts,
        onProgress: (msg) => {
          evt.sender.send('edl-part:progress', { msg, ts: Date.now() });
        },
      });
      return result;
    },
  );

  // 获取操作历史(会话级)
  ipcMain.handle('edl-part:get-history', async () => {
    return { success: true, history: EdlPartitionService.getHistory() };
  });

  // 清空操作历史
  ipcMain.handle('edl-part:clear-history', async () => {
    EdlPartitionService.clearHistory();
    return { success: true };
  });

  logger.info('ipc', 'edl-part:* 通道已注册');
}
