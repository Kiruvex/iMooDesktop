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

  logger.info('ipc', 'scrcpy:* 通道已注册');
}
