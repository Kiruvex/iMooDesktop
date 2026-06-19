// electron/ipc/tools.ts - tools:* 通道(常用功能散件)
// M5 新增:ota-start / rootpro / check-drivers / install-drivers
//         / atbmod-scan / atbmod-install / atbmod-list / atbmod-uninstall
//         / check-app-update

import { ipcMain } from 'electron';
import { AdbService } from '../services/AdbService';
import { DeviceService } from '../services/DeviceService';
import { OtaService } from '../services/OtaService';
import { RootProService } from '../services/RootProService';
import { DriverService } from '../services/DriverService';
import { AtbmodService } from '../services/AtbmodService';
import { UpdateService } from '../services/UpdateService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

function requireAdb(): boolean {
  const device = DeviceService.instance.current();
  return device?.type === 'adb';
}

export function registerToolsIpc(): void {
  // 打开充电可用
  // 原 opencharge.bat:adb shell "su -c setprop persist.sys.charge.usable true"
  ipcMain.handle('tools:open-charge', async () => {
    if (!requireAdb()) {
      return { success: false, error: '需要 ADB 设备' };
    }
    try {
      await AdbService.openCharge();
      return { success: true };
    } catch (e) {
      logger.error('tools', `开启充电可用失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  // 读取设备 build 属性
  // 原 listbuild.bat
  ipcMain.handle('tools:read-build-props', async () => {
    if (!requireAdb()) {
      return { success: false, error: '需要 ADB 设备', props: [] };
    }
    try {
      const props = await AdbService.readBuildProps();
      return { success: true, props };
    } catch (e) {
      logger.error('tools', `读取设备信息失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message, props: [] };
    }
  });

  // 无线 ADB:切换到无线模式
  ipcMain.handle('tools:wifi-enable', async () => {
    if (!requireAdb()) {
      return { success: false, error: '需要 ADB 设备(USB 连接)' };
    }
    try {
      await AdbService.wifiEnable();
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  // 无线 ADB:连接
  ipcMain.handle(
    'tools:wifi-connect',
    async (_evt, { ip, port }: { ip: string; port?: number }) => {
      try {
        const ok = await AdbService.wifiConnect(ip, port ?? 5555);
        return { success: ok };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 无线 ADB:断开
  ipcMain.handle(
    'tools:wifi-disconnect',
    async (_evt, { ip, port }: { ip: string; port?: number }) => {
      try {
        await AdbService.wifiDisconnect(ip, port ?? 5555);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== M5 新增 ==========

  // 离线 OTA 升级(对应 ota.bat)
  ipcMain.handle(
    'tools:ota-start',
    async (_evt, { zipPath }: { zipPath: string }) => {
      if (!requireAdb()) {
        return {
          success: false,
          error: '需要 ADB 模式设备',
          steps: [],
          scrcpyStarted: false,
        };
      }
      try {
        return await OtaService.start({ zipPath });
      } catch (e) {
        logger.error('tools', `OTA 升级失败: ${(e as Error).message}`);
        return {
          success: false,
          error: (e as Error).message,
          steps: [],
          scrcpyStarted: false,
        };
      }
    },
  );

  // Android 8.1 Root 后优化(对应 rootpro.bat,SDK27 专属)
  ipcMain.handle(
    'tools:rootpro',
    async (_evt, options: {
      installApks?: boolean;
      installDesktop?: boolean;
      installMods?: boolean;
    }) => {
      if (!requireAdb()) {
        return {
          success: false,
          supported: false,
          error: '需要 ADB 模式设备',
          steps: [],
        };
      }
      try {
        return await RootProService.run(options);
      } catch (e) {
        logger.error('tools', `Root 后优化失败: ${(e as Error).message}`);
        return {
          success: false,
          supported: false,
          error: (e as Error).message,
          steps: [],
        };
      }
    },
  );

  // 驱动检测(对应 checkdriver.bat 上半段)
  ipcMain.handle('tools:check-drivers', async () => {
    try {
      return await DriverService.check();
    } catch (e) {
      logger.error('tools', `驱动检测失败: ${(e as Error).message}`);
      return {
        success: false,
        status: { qualcomm: false, adb: false, vcRuntime: false },
        allInstalled: false,
        error: (e as Error).message,
      };
    }
  });

  // 安装驱动(对应 checkdriver.bat 下半段)
  ipcMain.handle('tools:install-drivers', async () => {
    try {
      return await DriverService.installDrivers();
    } catch (e) {
      logger.error('tools', `驱动安装失败: ${(e as Error).message}`);
      return { success: false, steps: [], error: (e as Error).message };
    }
  });

  // .atbmod 扫描
  ipcMain.handle('tools:atbmod-scan', async () => {
    try {
      const files = await AtbmodService.scan();
      return { success: true, files };
    } catch (e) {
      logger.error('tools', `atbmod 扫描失败: ${(e as Error).message}`);
      return { success: false, files: [], error: (e as Error).message };
    }
  });

  // .atbmod 安装
  ipcMain.handle('tools:atbmod-install', async (_evt, { file }: { file: string }) => {
    try {
      return await AtbmodService.install(file);
    } catch (e) {
      logger.error('tools', `atbmod 安装失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  // .atbmod 列出已安装
  ipcMain.handle('tools:atbmod-list', async () => {
    try {
      const installed = await AtbmodService.listInstalled();
      return { success: true, installed };
    } catch (e) {
      logger.error('tools', `atbmod 列出失败: ${(e as Error).message}`);
      return { success: false, installed: [], error: (e as Error).message };
    }
  });

  // .atbmod 卸载
  ipcMain.handle('tools:atbmod-uninstall', async (_evt, { modid }: { modid: string }) => {
    try {
      return await AtbmodService.uninstall(modid);
    } catch (e) {
      logger.error('tools', `atbmod 卸载失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  // 检查应用更新
  // 检查更新 - 已禁用
  // ipcMain.handle('tools:check-app-update', async () => {
  //   try {
  //     return await UpdateService.checkAppUpdate();
  //   } catch (e) {
  //     logger.error('tools', `检查更新失败: ${(e as Error).message}`);
  //     return {
  //       hasUpdate: false,
  //       currentVersion: '',
  //       error: (e as Error).message,
  //     };
  //   }
  // });

  logger.info('ipc', 'tools:* 通道已注册');
}
