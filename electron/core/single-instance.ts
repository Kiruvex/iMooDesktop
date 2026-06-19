// electron/core/single-instance.ts - 单实例锁
// 见 plan.md 5. electron/core/single-instance.ts

import { app } from 'electron';

let mainWindow: Electron.BrowserWindow | null = null;

export function setMainWindow(win: Electron.BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): Electron.BrowserWindow | null {
  return mainWindow;
}

/**
 * 请求单实例锁。若已有实例运行,则聚焦到已有窗口并退出当前进程。
 * @returns true 表示获得了锁(应继续启动),false 表示已有实例(应退出)
 */
export function ensureSingleInstance(): boolean {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    // 有人试图启动第二个实例,聚焦到主窗口
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    }
  });

  return true;
}
