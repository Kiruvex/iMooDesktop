// electron/ipc/log.ts - log:* 通道

import { ipcMain } from 'electron';
import { Logger } from '../services/Logger';

export function registerLogIpc(): void {
  // 订阅日志(渲染进程启动时调用)
  ipcMain.handle('log:subscribe', () => {
    Logger.instance.addSubscriber();
  });

  ipcMain.handle('log:unsubscribe', () => {
    Logger.instance.removeSubscriber();
  });
}
