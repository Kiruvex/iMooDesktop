// electron/main.ts - 应用入口
// 见 plan.md 5. electron/main.ts
// 见 plan.md 4.1 进程模型

import { app, BrowserWindow, Menu } from 'electron';
import { createMainWindow } from './core/windows';
import { buildAppMenu } from './core/menu';
import { ensureSingleInstance } from './core/single-instance';
import { paths } from './core/paths';
import { Logger } from './services/Logger';
import { DeviceService } from './services/DeviceService';
import { registerAllIpc } from './ipc';

// 确保单实例
if (!ensureSingleInstance()) {
  process.exit(0);
}

// 保留硬件加速(transparent:false 后不需要禁用)

// 日志初始化
const logger = Logger.instance;
logger.info('main', `iMooDesktop 启动中(dev=${paths.isDev})`);

// 设备服务(轮询设备状态)
const deviceService = DeviceService.instance;

app.whenReady().then(() => {
  // 设置应用菜单
  Menu.setApplicationMenu(buildAppMenu());

  // 创建主窗口
  createMainWindow();

  // 注册所有 IPC handler
  registerAllIpc();

  // 启动设备监听
  deviceService.start();

  logger.info('main', '应用就绪');

  // macOS: 点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// 所有窗口关闭时退出(除 macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', () => {
  deviceService.stop();
  logger.info('main', '应用退出');
});

// 防止崩溃时静默退出
process.on('uncaughtException', (err) => {
  logger.error('main', `未捕获异常: ${err.message}`, err.stack);
});

process.on('unhandledRejection', (reason) => {
  logger.error('main', `未处理的 Promise 拒绝: ${String(reason)}`);
});
