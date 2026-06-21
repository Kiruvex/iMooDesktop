// electron/core/windows.ts - 主窗口管理
// 见 plan.md 5. electron/core/windows.ts
// UI 规范:蓝色主题、无 emoji、lucide 图标(见 plan.md 核心约束 UI 规范)
// 自定义边框:frame: false + 自绘标题栏(用户指示,2026-06-18)

import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { paths } from './paths';
import { config } from './config';
import { setMainWindow } from './single-instance';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] || 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const preload = path.join(__dirname, '..', 'preload', 'preload.js');
  const opacity = config.get('windowOpacity') / 100;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    opacity,
    backgroundColor: '#00000000', // 透明(配合圆角)
    title: 'iMooDesktop',
    icon: paths.icon,
    // 自定义边框:Windows/Linux 无边框(不支持 macOS)
    frame: false,
    titleBarStyle: 'hidden',
    // 透明窗口 + 圆角(配合 CSS border-radius)
    transparent: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setMainWindow(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 外部链接在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (paths.isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(paths.appRoot, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    setMainWindow(null);
  });

  // 窗口最大化状态变化事件(推送到渲染进程,替代前端轮询)
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('system:window-state', { maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('system:window-state', { maximized: false });
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setWindowOpacity(opacity: number): void {
  mainWindow?.setOpacity(Math.max(0, Math.min(1, opacity / 100)));
  config.set('windowOpacity', opacity);
}

// ========== 窗口控制(自定义标题栏用) ==========

export function minimizeWindow(): void {
  mainWindow?.minimize();
}

export function toggleMaximizeWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
}

export function closeWindow(): void {
  mainWindow?.close();
}

export function isWindowMaximized(): boolean {
  return mainWindow?.isMaximized() ?? false;
}
