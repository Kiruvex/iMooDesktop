// electron/ipc/tools.ts - tools:* 通道(常用功能散件)
// ota-start / rootpro / check-drivers / install-drivers
//         / atbmod-scan / atbmod-install / atbmod-list / atbmod-uninstall
//         / check-app-update
// 重构:用 wrap 高阶函数消除重复 requireAdb + try-catch

import { ipcMain } from 'electron';
import { AdbService } from '../services/AdbService';
import { OtaService } from '../services/OtaService';
import { RootProService } from '../services/RootProService';
import { DriverService } from '../services/DriverService';
import { AtbmodService } from '../services/AtbmodService';
import { Logger } from '../services/Logger';
import { wrap, wrapNoArgs } from '../lib/ipcHelper';

const logger = Logger.instance;

export function registerToolsIpc(): void {
  // 打开充电可用(原 opencharge.bat:adb shell "su -c setprop persist.sys.charge.usable true")
  ipcMain.handle(
    'tools:open-charge',
    wrapNoArgs(() => AdbService.openCharge().then(() => ({ success: true })), {
      requireDevice: 'adb',
      logPrefix: 'tools',
    }),
  );

  // 读取设备 build 属性(原 listbuild.bat)
  ipcMain.handle(
    'tools:read-build-props',
    wrapNoArgs(() => AdbService.readBuildProps().then((props) => ({ success: true, props })), {
      requireDevice: 'adb',
      errorExtra: { props: [] },
      logPrefix: 'tools',
    }),
  );

  // 无线 ADB:切换到无线模式
  ipcMain.handle(
    'tools:wifi-enable',
    wrapNoArgs(() => AdbService.wifiEnable().then(() => ({ success: true })), {
      requireDevice: 'adb',
      logPrefix: 'tools',
    }),
  );

  // 无线 ADB:连接
  ipcMain.handle(
    'tools:wifi-connect',
    wrap(({ ip, port }: { ip: string; port?: number }) =>
      AdbService.wifiConnect(ip, port ?? 5555).then((ok) => ({ success: ok })),
    { logPrefix: 'tools' }),
  );

  // 无线 ADB:断开
  ipcMain.handle(
    'tools:wifi-disconnect',
    wrap(({ ip, port }: { ip: string; port?: number }) =>
      AdbService.wifiDisconnect(ip, port ?? 5555).then(() => ({ success: true })),
    { logPrefix: 'tools' }),
  );

  // ========== 扩展功能 ==========

  // 离线 OTA 升级(对应 ota.bat)
  ipcMain.handle(
    'tools:ota-start',
    wrap(({ zipPath }: { zipPath: string }) => OtaService.start({ zipPath }), {
      requireDevice: 'adb',
      errorExtra: { steps: [], scrcpyStarted: false },
      logPrefix: 'tools',
    }),
  );

  // Android 8.1 Root 后优化(对应 rootpro.bat,SDK27 专属)
  ipcMain.handle(
    'tools:rootpro',
    wrap((options: { installApks?: boolean; installDesktop?: boolean; installMods?: boolean }) =>
      RootProService.run(options),
    {
      requireDevice: 'adb',
      errorExtra: { supported: false, steps: [] },
      logPrefix: 'tools',
    }),
  );

  // 驱动检测(对应 checkdriver.bat 上半段)
  ipcMain.handle(
    'tools:check-drivers',
    wrapNoArgs(() => DriverService.check(), {
      errorExtra: { status: { qualcomm: false, adb: false, vcRuntime: false }, allInstalled: false },
      logPrefix: 'tools',
    }),
  );

  // 安装驱动(对应 checkdriver.bat 下半段)
  ipcMain.handle(
    'tools:install-drivers',
    wrapNoArgs(() => DriverService.installDrivers(), {
      errorExtra: { steps: [] },
      logPrefix: 'tools',
    }),
  );

  // .atbmod 扫描
  ipcMain.handle(
    'tools:atbmod-scan',
    wrapNoArgs(() => AtbmodService.scan().then((files) => ({ success: true, files })), {
      errorExtra: { files: [] },
      logPrefix: 'tools',
    }),
  );

  // .atbmod 安装
  ipcMain.handle(
    'tools:atbmod-install',
    wrap(({ file }: { file: string }) => AtbmodService.install(file), {
      logPrefix: 'tools',
    }),
  );

  // .atbmod 列出已安装
  ipcMain.handle(
    'tools:atbmod-list',
    wrapNoArgs(() => AtbmodService.listInstalled().then((installed) => ({ success: true, installed })), {
      errorExtra: { installed: [] },
      logPrefix: 'tools',
    }),
  );

  // .atbmod 卸载
  ipcMain.handle(
    'tools:atbmod-uninstall',
    wrap(({ modid }: { modid: string }) => AtbmodService.uninstall(modid), {
      logPrefix: 'tools',
    }),
  );

  // 检查应用更新 - 已禁用
  // ipcMain.handle('tools:check-app-update', ...);

  logger.info('ipc', 'tools:* 通道已注册');
}
