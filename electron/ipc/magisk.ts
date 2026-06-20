// electron/ipc/magisk.ts - magisk:* 通道
// 见 plan.md 8.1 通道命名规范
// 对应原 userinstmodule.bat / instmodule.bat / userunmodule.bat / unmodule.bat /
//      magisklist.bat / setmagisk.bat(均迁移到 MagiskService.ts,见 plan.md 6.9)
//
// 所有 magisk:* 操作均要求 ADB 模式设备(Magisk 模块管理通过 adb shell su -c 执行),
// 否则返回错误。
//
// 重构:用 wrap 高阶函数消除重复 requireAdb + try-catch

import { ipcMain } from 'electron';
import {
  MagiskService,
  type InstallMethod,
  type UninstallMethod,
  type StoreModule,
} from '../services/MagiskService';
import { Logger } from '../services/Logger';
import { wrap, wrapNoArgs } from '../lib/ipcHelper';

const logger = Logger.instance;

export function registerMagiskIpc(): void {
  // 列出已安装模块(对应原 magisklist.bat)
  ipcMain.handle(
    'magisk:list',
    wrapNoArgs(() => MagiskService.list().then((modules) => ({ success: true, modules })), {
      requireDevice: 'adb',
      logPrefix: 'magisk',
    }),
  );

  // 安装模块(对应原 instmodule.bat:magisk / shinst / peremptory 三种方式)
  ipcMain.handle(
    'magisk:install',
    wrap(({ zip, method }: { zip: string; method: InstallMethod }) =>
      MagiskService.install(zip, method),
    { requireDevice: 'adb', logPrefix: 'magisk' }),
  );

  // 卸载模块(对应原 unmodule.bat:mark / direct / script 三种方式)
  ipcMain.handle(
    'magisk:uninstall',
    wrap(({ id, method }: { id: string; method: UninstallMethod }) =>
      MagiskService.uninstall(id, method),
    { requireDevice: 'adb', logPrefix: 'magisk' }),
  );

  // 启用模块
  ipcMain.handle(
    'magisk:enable',
    wrap(({ id }: { id: string }) => MagiskService.enable(id), {
      requireDevice: 'adb',
      logPrefix: 'magisk',
    }),
  );

  // 禁用模块
  ipcMain.handle(
    'magisk:disable',
    wrap(({ id }: { id: string }) => MagiskService.disable(id), {
      requireDevice: 'adb',
      logPrefix: 'magisk',
    }),
  );

  // ========== 模块商店 ==========

  // 搜索 Magisk 模块(对接 https://api.magiskmodule.com/v1/modules?search=)
  // API 不可用时返回空数组(不抛错),不需要 ADB 设备
  ipcMain.handle(
    'magisk:store-search',
    wrap(({ query }: { query: string }) =>
      MagiskService.storeSearch(query).then((modules) => ({ success: true, modules })),
    { errorExtra: { modules: [] }, logPrefix: 'magisk' }),
  );

  // 从商店下载并安装模块(需 ADB 设备)
  ipcMain.handle(
    'magisk:store-install',
    wrap(({ module }: { module: StoreModule }) => MagiskService.installFromStore(module), {
      requireDevice: 'adb',
      logPrefix: 'magisk',
    }),
  );

  logger.info('ipc', 'magisk:* 通道已注册');
}
