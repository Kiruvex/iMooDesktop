// electron/ipc/app.ts - app:* 通道(应用管理)
// unlock-z10(Z10 解除安装限制)+ enable-autostart(QQ/微信开机自启)
// 重构:用 wrap 高阶函数消除重复 requireAdb + try-catch

import { ipcMain } from 'electron';
import { AdbService } from '../services/AdbService';
import { AppService, DEFAULT_AUTOSTART_PACKAGES } from '../services/AppService';
import { Logger } from '../services/Logger';
import { wrap } from '../lib/ipcHelper';

const logger = Logger.instance;

export function registerAppIpc(): void {
  // 列出已安装应用
  ipcMain.handle(
    'app:list',
    wrap(({ thirdParty }: { thirdParty?: boolean }) => AdbService.listPackages(thirdParty), {
      logPrefix: 'app',
    }),
  );

  // 安装应用
  ipcMain.handle(
    'app:install',
    wrap(({ apk, method }: { apk: string; method?: 'install' | 'data' | '3install' | 'create' }) =>
      AdbService.install(apk, method ?? 'install'),
    { logPrefix: 'app' }),
  );

  // 卸载应用
  ipcMain.handle(
    'app:uninstall',
    wrap(({ pkg }: { pkg: string }) =>
      AdbService.uninstall(pkg).then((success) => ({ success })),
    { logPrefix: 'app' }),
  );

  // ========== 扩展功能 ==========

  // Z10 解除安装限制(对应 z10openinst.bat)
  ipcMain.handle(
    'app:unlock-z10',
    wrap(() => AppService.unlockZ10Install(), {
      requireDevice: 'adb',
      errorExtra: { steps: [] },
      logPrefix: 'app',
    }),
  );

  // QQ/微信开机自启(对应 qqwxautestart.bat)
  // 默认包名: com.tencent.qqlite, com.tencent.qqwatch, com.tencent.wechatkids
  ipcMain.handle(
    'app:enable-autostart',
    wrap(({ packages }: { packages?: string[] } = {}) =>
      AppService.enableAutoStart(packages ?? DEFAULT_AUTOSTART_PACKAGES),
    {
      requireDevice: 'adb',
      errorExtra: { results: [] },
      logPrefix: 'app',
    }),
  );

  logger.info('ipc', 'app:* 通道已注册');
}
