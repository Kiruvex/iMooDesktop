// electron/ipc/app.ts - app:* 通道(应用管理)
// M5 新增:unlock-z10(Z10 解除安装限制)+ enable-autostart(QQ/微信开机自启)

import { ipcMain } from 'electron';
import { AdbService } from '../services/AdbService';
import { AppService, DEFAULT_AUTOSTART_PACKAGES } from '../services/AppService';
import { DeviceService } from '../services/DeviceService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

function requireAdb(): boolean {
  const device = DeviceService.instance.current();
  return device?.type === 'adb';
}

export function registerAppIpc(): void {
  // 列出已安装应用
  ipcMain.handle('app:list', async (_evt, { thirdParty }: { thirdParty?: boolean }) => {
    try {
      return await AdbService.listPackages(thirdParty);
    } catch (e) {
      logger.error('app', `列出应用失败: ${(e as Error).message}`);
      return [];
    }
  });

  // 安装应用
  ipcMain.handle(
    'app:install',
    async (_evt, { apk, method }: { apk: string; method?: 'install' | 'data' | '3install' | 'create' }) => {
      try {
        return await AdbService.install(apk, method ?? 'install');
      } catch (e) {
        logger.error('app', `安装失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 卸载应用
  ipcMain.handle('app:uninstall', async (_evt, { pkg }: { pkg: string }) => {
    try {
      const success = await AdbService.uninstall(pkg);
      return { success };
    } catch (e) {
      logger.error('app', `卸载失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  // ========== M5 新增 ==========

  // Z10 解除安装限制(对应 z10openinst.bat)
  ipcMain.handle('app:unlock-z10', async () => {
    if (!requireAdb()) {
      return { success: false, error: '需要 ADB 模式设备', steps: [] };
    }
    try {
      return await AppService.unlockZ10Install();
    } catch (e) {
      logger.error('app', `Z10 解除限制失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message, steps: [] };
    }
  });

  // QQ/微信开机自启(对应 qqwxautestart.bat)
  // 默认包名: com.tencent.qqlite, com.tencent.qqwatch, com.tencent.wechatkids
  ipcMain.handle(
    'app:enable-autostart',
    async (_evt, { packages }: { packages?: string[] } = {}) => {
      if (!requireAdb()) {
        return {
          success: false,
          error: '需要 ADB 模式设备',
          results: [],
        };
      }
      try {
        return await AppService.enableAutoStart(packages ?? DEFAULT_AUTOSTART_PACKAGES);
      } catch (e) {
        logger.error('app', `开机自启失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message, results: [] };
      }
    },
  );

  logger.info('ipc', 'app:* 通道已注册');
}
