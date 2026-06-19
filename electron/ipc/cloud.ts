// electron/ipc/cloud.ts - cloud:* 通道

import { ipcMain } from 'electron';
import { CloudService, type CloudResource } from '../services/CloudService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerCloudIpc(): void {
  ipcMain.handle('cloud:list', async (): Promise<CloudResource[]> => {
    return CloudService.list();
  });

  ipcMain.handle('cloud:list-by-category', async () => {
    return CloudService.listByCategory();
  });

  ipcMain.handle('cloud:download', async (_evt, { name }: { name: string }) => {
    try {
      await CloudService.download(name, (percent) => {
        // 推送进度(通过 webContents.send)
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) {
            w.webContents.send('cloud:progress', { name, percent });
          }
        }
      });
      return { success: true };
    } catch (e) {
      logger.error('cloud', `下载失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('cloud:check-updates', async () => {
    return CloudService.checkUpdates();
  });

  logger.info('ipc', 'cloud:* 通道已注册');
}
