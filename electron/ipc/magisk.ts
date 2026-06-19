// electron/ipc/magisk.ts - magisk:* 通道
// 见 plan.md 8.1 通道命名规范
// 对应原 userinstmodule.bat / instmodule.bat / userunmodule.bat / unmodule.bat /
//      magisklist.bat / setmagisk.bat(均迁移到 MagiskService.ts,见 plan.md 6.9)
//
// 所有 magisk:* 操作均要求 ADB 模式设备(Magisk 模块管理通过 adb shell su -c 执行),
// 否则返回错误。

import { ipcMain } from 'electron';
import {
  MagiskService,
  type InstallMethod,
  type UninstallMethod,
  type MagiskModule,
  type StoreModule,
} from '../services/MagiskService';
import { DeviceService } from '../services/DeviceService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

function requireAdb(): boolean {
  const device = DeviceService.instance.current();
  return device?.type === 'adb';
}

export function registerMagiskIpc(): void {
  // 列出已安装模块
  // 对应原 magisklist.bat(逻辑保真在 MagiskService.list)
  ipcMain.handle('magisk:list', async (): Promise<{ success: boolean; modules?: MagiskModule[]; error?: string }> => {
    if (!requireAdb()) {
      return { success: false, error: '需要 ADB 模式设备' };
    }
    try {
      const modules = await MagiskService.list();
      return { success: true, modules };
    } catch (e) {
      logger.error('magisk', `列出模块失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  // 安装模块
  // 对应原 instmodule.bat:magisk / shinst / peremptory 三种方式
  ipcMain.handle(
    'magisk:install',
    async (
      _evt,
      { zip, method }: { zip: string; method: InstallMethod },
    ): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        return await MagiskService.install(zip, method);
      } catch (e) {
        logger.error('magisk', `安装模块失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 卸载模块
  // 对应原 unmodule.bat:mark / direct / script 三种方式
  ipcMain.handle(
    'magisk:uninstall',
    async (
      _evt,
      { id, method }: { id: string; method: UninstallMethod },
    ): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        return await MagiskService.uninstall(id, method);
      } catch (e) {
        logger.error('magisk', `卸载模块失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 启用模块
  ipcMain.handle(
    'magisk:enable',
    async (_evt, { id }: { id: string }): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        return await MagiskService.enable(id);
      } catch (e) {
        logger.error('magisk', `启用模块失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 禁用模块
  ipcMain.handle(
    'magisk:disable',
    async (_evt, { id }: { id: string }): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        return await MagiskService.disable(id);
      } catch (e) {
        logger.error('magisk', `禁用模块失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // ========== 模块商店(M5 新增) ==========

  // 搜索 Magisk 模块(对接 https://api.magiskmodule.com/v1/modules?search=)
  // API 不可用时返回空数组(不抛错)
  ipcMain.handle(
    'magisk:store-search',
    async (_evt, { query }: { query: string }): Promise<{ success: boolean; modules: StoreModule[] }> => {
      try {
        const modules = await MagiskService.storeSearch(query);
        return { success: true, modules };
      } catch (e) {
        logger.error('magisk', `商店搜索失败: ${(e as Error).message}`);
        return { success: false, modules: [] };
      }
    },
  );

  // 从商店下载并安装模块(需 ADB 设备)
  ipcMain.handle(
    'magisk:store-install',
    async (
      _evt,
      { module }: { module: StoreModule },
    ): Promise<{ success: boolean; error?: string }> => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 模式设备' };
      }
      try {
        return await MagiskService.installFromStore(module);
      } catch (e) {
        logger.error('magisk', `商店安装失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  logger.info('ipc', 'magisk:* 通道已注册');
}
