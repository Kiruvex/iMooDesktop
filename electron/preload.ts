// electron/preload.ts - contextBridge 暴露 API
// 见 plan.md 8.2 preload.ts 暴露
// 安全:contextIsolation=true, nodeIntegration=false, 只暴露白名单 API

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  DeviceInfo,
  DeviceType,
  LogEntry,
  InstallMethod,
  UninstallMethod,
  MagiskModule,
  StoreModule,
  CloudResource,
  ScrcpyOptions,
  AdbDdMatchResult,
  UpdateInfo,
} from '../shared/types';
import type { RebootMode } from '../services/RebootService';
import type { RootOptions, RootContext } from '../services/RootService';

const api = {
  device: {
    current: (): Promise<DeviceInfo | null> => ipcRenderer.invoke('device:current'),
    wait: (types: DeviceType[], timeout?: number): Promise<DeviceInfo> =>
      ipcRenderer.invoke('device:wait', { types, timeout }),
    onChange: (cb: (info: DeviceInfo | null) => void) => {
      const handler = (_: unknown, info: DeviceInfo | null): void => cb(info);
      ipcRenderer.on('device:change', handler);
      return () => ipcRenderer.removeListener('device:change', handler);
    },
  },

  reboot: {
    execute: (opts: {
      mode: RebootMode;
      innermodel?: string;
      platform?: 'otherpash' | 'v3pash' | 'z10';
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('reboot:execute', opts),
  },

  cloud: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('cloud:list'),
    listByCategory: (): Promise<Record<string, unknown[]>> =>
      ipcRenderer.invoke('cloud:list-by-category'),
    download: (name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('cloud:download', { name }),
    checkUpdates: (): Promise<{ resource: unknown; updateAvailable: boolean }[]> =>
      ipcRenderer.invoke('cloud:check-updates'),
    onProgress: (cb: (data: { name: string; percent: number }) => void) => {
      const handler = (_: unknown, data: { name: string; percent: number }): void => cb(data);
      ipcRenderer.on('cloud:progress', handler);
      return () => ipcRenderer.removeListener('cloud:progress', handler);
    },
  },

  scrcpy: {
    launch: (opts: unknown): Promise<{ success: boolean; pid?: number; error?: string }> =>
      ipcRenderer.invoke('scrcpy:launch', opts),
    stop: (pid: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('scrcpy:stop', { pid }),
    stopAll: (): Promise<{ success: boolean }> => ipcRenderer.invoke('scrcpy:stop-all'),
    list: (): Promise<{ pid: number; opts: unknown; startedAt: number }[]> =>
      ipcRenderer.invoke('scrcpy:list'),
  },

  app: {
    list: (thirdParty?: boolean): Promise<string[]> =>
      ipcRenderer.invoke('app:list', { thirdParty }),
    install: (
      apk: string,
      method?: 'install' | 'data' | '3install' | 'create',
    ): Promise<{ success: boolean; pkg?: string; error?: string }> =>
      ipcRenderer.invoke('app:install', { apk, method }),
    uninstall: (pkg: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('app:uninstall', { pkg }),
    // M5:Z10 解除安装限制(对应 z10openinst.bat)
    unlockZ10: (): Promise<{
      success: boolean;
      steps: { name: string; status: string; message?: string }[];
      error?: string;
    }> => ipcRenderer.invoke('app:unlock-z10'),
    // M5:QQ/微信开机自启(对应 qqwxautestart.bat)
    enableAutoStart: (packages?: string[]): Promise<{
      success: boolean;
      results: { pkg: string; success: boolean; error?: string }[];
      error?: string;
    }> => ipcRenderer.invoke('app:enable-autostart', { packages }),
  },

  tools: {
    openCharge: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tools:open-charge'),
    readBuildProps: (): Promise<{
      success: boolean;
      error?: string;
      props: { key: string; label: string; value: string }[];
    }> => ipcRenderer.invoke('tools:read-build-props'),
    wifiEnable: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tools:wifi-enable'),
    wifiConnect: (ip: string, port?: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tools:wifi-connect', { ip, port }),
    wifiDisconnect: (ip: string, port?: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tools:wifi-disconnect', { ip, port }),
    // M5:离线 OTA 升级(对应 ota.bat)
    otaStart: (zipPath: string): Promise<{
      success: boolean;
      steps: { name: string; status: string; message?: string }[];
      scrcpyStarted: boolean;
      error?: string;
    }> => ipcRenderer.invoke('tools:ota-start', { zipPath }),
    // M5:Android 8.1 Root 后优化(对应 rootpro.bat,SDK27 专属)
    rootpro: (options: {
      installApks?: boolean;
      installDesktop?: boolean;
      installMods?: boolean;
    }): Promise<{
      success: boolean;
      supported: boolean;
      steps: { name: string; status: string; message?: string }[];
      innermodel?: string;
      model?: string;
      androidVersion?: string;
      sdkVersion?: string;
      softVersion?: string;
      isV3?: boolean;
      haveSystemUI?: boolean;
      error?: string;
    }> => ipcRenderer.invoke('tools:rootpro', options),
    // M5:驱动检测(对应 checkdriver.bat)
    checkDrivers: (): Promise<{
      success: boolean;
      status: { qualcomm: boolean; adb: boolean; vcRuntime: boolean };
      allInstalled: boolean;
      error?: string;
    }> => ipcRenderer.invoke('tools:check-drivers'),
    installDrivers: (): Promise<{
      success: boolean;
      steps: { name: string; status: string; message?: string }[];
      error?: string;
    }> => ipcRenderer.invoke('tools:install-drivers'),
    // M5:.atbmod 模块(对应 Loadatbmod.bat)
    atbmodScan: (): Promise<{
      success: boolean;
      files: { path: string; filename: string; size: number }[];
      error?: string;
    }> => ipcRenderer.invoke('tools:atbmod-scan'),
    atbmodInstall: (file: string): Promise<{ success: boolean; modid?: string; error?: string }> =>
      ipcRenderer.invoke('tools:atbmod-install', { file }),
    atbmodList: (): Promise<{
      success: boolean;
      installed: {
        modid: string;
        dir: string;
        hasProp: boolean;
        prop?: {
          modid: string;
          modname: string;
          modversion: string;
          modversioncode: string;
          modtype: string;
        };
      }[];
      error?: string;
    }> => ipcRenderer.invoke('tools:atbmod-list'),
    atbmodUninstall: (modid: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('tools:atbmod-uninstall', { modid }),
    // M5:检查应用更新
    checkAppUpdate: (): Promise<{
      hasUpdate: boolean;
      currentVersion: string;
      latestVersion?: string;
      releaseUrl?: string;
      releaseNotes?: string;
      error?: string;
    }> => ipcRenderer.invoke('tools:check-app-update'),
  },

  // ========== magisk:* 通道(对应原 userinstmodule/instmodule/unmodule/magisklist) ==========
  magisk: {
    list: (): Promise<{ success: boolean; modules?: MagiskModule[]; error?: string }> =>
      ipcRenderer.invoke('magisk:list'),
    install: (
      zip: string,
      method: InstallMethod,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('magisk:install', { zip, method }),
    uninstall: (
      id: string,
      method: UninstallMethod,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('magisk:uninstall', { id, method }),
    enable: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('magisk:enable', { id }),
    disable: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('magisk:disable', { id }),
    // M5:模块商店
    storeSearch: (query: string): Promise<{ success: boolean; modules: StoreModule[] }> =>
      ipcRenderer.invoke('magisk:store-search', { query }),
    storeInstall: (module: StoreModule): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('magisk:store-install', { module }),
  },

  // ========== backup:* 通道(对应原 backup/super_recovery/pashtwrp/pashtwrppro/Xposed) ==========
  backup: {
    // DCIM 备份/恢复
    dcimBackup: (outputDir: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:dcim-backup', { outputDir }),
    dcimRecover: (inputDir: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:dcim-recover', { inputDir }),

    // ADB-dd 备份/恢复(分两步:prepare 返回匹配列表,execute 用户确认后调用)
    adbddBackup: (
      outputDir: string,
    ): Promise<{ success: boolean; zipPath?: string; error?: string }> =>
      ipcRenderer.invoke('backup:adbdd-backup', { outputDir }),
    adbddPrepare: (
      zipPath: string,
    ): Promise<{
      success: boolean;
      extractDir?: string;
      match?: AdbDdMatchResult;
      error?: string;
    }> => ipcRenderer.invoke('backup:adbdd-prepare', { zipPath }),
    adbddExecute: (
      extractDir: string,
      parts: string[],
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:adbdd-execute', { extractDir, parts }),
    adbddRecover: (zipPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:adbdd-recover', { zipPath }),

    // 9008 备份/恢复
    edlBackup: (opts: {
      innermodel: string;
      v3?: boolean;
      softVersion?: string;
      outputDir: string;
    }): Promise<{ success: boolean; zipPath?: string; error?: string }> =>
      ipcRenderer.invoke('backup:edl-backup', opts),
    edlRecover: (zipPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:edl-recover', { zipPath }),

    // 超级恢复
    superRecovery: (folder: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:super-recovery', { folder }),

    // TWRP 刷入(EDL 模式)
    flashTwrp: (innermodel: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:flash-twrp', { innermodel }),

    // 开机自刷 TWRP(ADB 模式)
    autoFlashTwrp: (innermodel: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:auto-flash-twrp', { innermodel }),

    // Xposed 安装
    xposedInstall: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:xposed-install'),

    // 进度事件订阅
    onProgress: (cb: (data: { msg: string; ts: number }) => void) => {
      const handler = (_: unknown, data: { msg: string; ts: number }): void => cb(data);
      ipcRenderer.on('backup:progress', handler);
      return () => ipcRenderer.removeListener('backup:progress', handler);
    },
  },

  system: {
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('system:get-settings'),
    setSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('system:set-settings', { settings }),
    pickFile: (opts: {
      kind: 'open' | 'folder';
      filter?: string;
      multi?: boolean;
    }): Promise<string | string[] | null> => ipcRenderer.invoke('system:pick-file', opts),
    openExternal: (path: string): Promise<void> =>
      ipcRenderer.invoke('system:open-external', { path }),
    showInFolder: (path: string): Promise<void> =>
      ipcRenderer.invoke('system:show-in-folder', { path }),
    verifyResources: () => ipcRenderer.invoke('system:verify-resources'),
    getVersion: (): Promise<{ version: string; buildDate: string }> =>
      ipcRenderer.invoke('system:get-version'),
    setWindowOpacity: (opacity: number): Promise<void> =>
      ipcRenderer.invoke('system:set-window-opacity', { opacity }),
    // 窗口控制(自定义标题栏)
    windowMinimize: (): Promise<void> => ipcRenderer.invoke('system:window-minimize'),
    windowToggleMaximize: (): Promise<void> =>
      ipcRenderer.invoke('system:window-toggle-maximize'),
    windowClose: (): Promise<void> => ipcRenderer.invoke('system:window-close'),
    windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('system:window-is-maximized'),
    openTerminal: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('system:open-terminal'),
  },

  log: {
    subscribe: (): Promise<void> => ipcRenderer.invoke('log:subscribe'),
    unsubscribe: (): Promise<void> => ipcRenderer.invoke('log:unsubscribe'),
    onLine: (cb: (entry: LogEntry) => void) => {
      const handler = (_: unknown, entry: LogEntry): void => cb(entry);
      ipcRenderer.on('log:line', handler);
      return () => ipcRenderer.removeListener('log:line', handler);
    },
  },

  // ========== root:* 通道(对应原 root.bat + ROOT-SDK19/25/27.bat + nd03root.bat) ==========
  root: {
    // 启动 Root 流程(返回 taskId)
    start: (options: RootOptions): Promise<{ success: boolean; taskId?: string; error?: string }> =>
      ipcRenderer.invoke('root:start', options),
    // 取消(尝试恢复 DCIM,不回滚已刷的分区)
    cancel: (taskId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('root:cancel', { taskId }),
    // 暂停(在下一个状态边界停下)
    pause: (taskId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('root:pause', { taskId }),
    // 恢复
    resume: (taskId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('root:resume', { taskId }),
    // 获取当前 context
    getContext: (taskId: string): Promise<{ success: boolean; context?: RootContext; error?: string }> =>
      ipcRenderer.invoke('root:get-context', { taskId }),
    // 订阅 stage 变化事件
    onStageChange: (cb: (ctx: RootContext) => void) => {
      const handler = (_: unknown, ctx: RootContext): void => cb(ctx);
      ipcRenderer.on('root:stage-change', handler);
      return () => ipcRenderer.removeListener('root:stage-change', handler);
    },
  },

  // 平台信息(渲染进程可能需要)
  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development',
};

contextBridge.exposeInMainWorld('api', api);

// TypeScript 类型导出(供渲染进程声明 global)
export type Api = typeof api;
