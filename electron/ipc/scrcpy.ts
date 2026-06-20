// electron/ipc/scrcpy.ts - scrcpy:* 通道

import { ipcMain } from 'electron';
import { ScrcpyService, type ScrcpyOptions } from '../services/ScrcpyService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerScrcpyIpc(): void {
  ipcMain.handle('scrcpy:launch', async (_evt, opts: ScrcpyOptions) => {
    try {
      const pid = await ScrcpyService.launch(opts);
      return { success: true, pid };
    } catch (e) {
      logger.error('scrcpy', `启动失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('scrcpy:stop', async (_evt, { pid }: { pid: number }) => {
    await ScrcpyService.stop(pid);
    return { success: true };
  });

  ipcMain.handle('scrcpy:stop-all', async () => {
    await ScrcpyService.stopAll();
    return { success: true };
  });

  ipcMain.handle('scrcpy:list', () => {
    return ScrcpyService.listRunning();
  });

  // 订阅进程变化事件(launch/exit),替代前端轮询
  // 每个 webContents 独立订阅,关闭时清理
  ipcMain.handle('scrcpy:subscribe', (evt) => {
    const sender = evt.sender;
    const handler = (data: unknown): void => {
      if (!sender.isDestroyed()) {
        sender.send('scrcpy:process-change', data);
      }
    };
    ScrcpyService.on('process-change', handler);
    // webContents 销毁时自动清理
    sender.once('did-finish-load', () => {
      ScrcpyService.off('process-change', handler);
    });
    sender.on('destroyed', () => {
      ScrcpyService.off('process-change', handler);
    });
  });

  logger.info('ipc', 'scrcpy:* 通道已注册');
}
