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
  AdbDdMatchResult,
  RebootMode,
  RootOptions,
  RootContext,
} from '../shared/types';

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
    // 订阅进程变化事件(launch/exit),替代轮询
    subscribe: (): Promise<void> => ipcRenderer.invoke('scrcpy:subscribe'),
    onProcessChange: (cb: (data: { type: 'launch' | 'exit'; pid: number; code?: number }) => void) => {
      const handler = (_: unknown, data: { type: 'launch' | 'exit'; pid: number; code?: number }): void => cb(data);
      ipcRenderer.on('scrcpy:process-change', handler);
      return () => ipcRenderer.removeListener('scrcpy:process-change', handler);
    },
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
    // Z10 解除安装限制(对应 z10openinst.bat)
    unlockZ10: (): Promise<{
      success: boolean;
      steps: { name: string; status: string; message?: string }[];
      error?: string;
    }> => ipcRenderer.invoke('app:unlock-z10'),
    // QQ/微信开机自启(对应 qqwxautestart.bat)
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
    // 离线 OTA 升级(对应 ota.bat)
    otaStart: (zipPath: string): Promise<{
      success: boolean;
      steps: { name: string; status: string; message?: string }[];
      scrcpyStarted: boolean;
      error?: string;
    }> => ipcRenderer.invoke('tools:ota-start', { zipPath }),
    // Android 8.1 Root 后优化(对应 rootpro.bat,SDK27 专属)
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
    // 驱动检测(对应 checkdriver.bat)
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
    // .atbmod 模块(对应 Loadatbmod.bat)
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
    // 检查应用更新
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
    // 模块商店
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
    onWindowState: (cb: (state: { maximized: boolean }) => void) => {
      const handler = (_: unknown, state: { maximized: boolean }): void => cb(state);
      ipcRenderer.on('system:window-state', handler);
      return () => ipcRenderer.removeListener('system:window-state', handler);
    },
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

  // ========== file:* 通道(ADB 文件管理) ==========
  file: {
    list: (path: string, deviceSerial?: string): Promise<{
      success: boolean;
      entries: {
        name: string;
        path: string;
        isDir: boolean;
        isLink: boolean;
        linkTarget?: string;
        size: number;
        perms: string;
        type: string;
        owner: string;
        group: string;
        mtime: string;
        ext: string;
      }[];
      error?: string;
    }> => ipcRenderer.invoke('file:list', { path, deviceSerial }),

    stat: (path: string): Promise<{ success: boolean; entry: unknown; error?: string }> =>
      ipcRenderer.invoke('file:stat', { path }),

    exists: (path: string): Promise<{ success: boolean; exists: boolean }> =>
      ipcRenderer.invoke('file:exists', { path }),

    mkdir: (path: string, recursive?: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:mkdir', { path, recursive }),

    remove: (path: string, recursive?: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:remove', { path, recursive }),

    rename: (oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:rename', { oldPath, newPath }),

    copy: (
      srcPath: string,
      dstPath: string,
      recursive?: boolean,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:copy', { srcPath, dstPath, recursive }),

    push: (
      local: string,
      remote: string,
      deviceSerial?: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:push', { local, remote, deviceSerial }),

    pull: (
      remote: string,
      local: string,
      deviceSerial?: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:pull', { remote, local, deviceSerial }),

    pushFolder: (localDir: string, remoteDir: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:push-folder', { localDir, remoteDir }),

    installApk: (remoteApk: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:install-apk', { remoteApk }),

    installLocalApk: (): Promise<{ success: boolean; pkg?: string; error?: string }> =>
      ipcRenderer.invoke('file:install-local-apk'),

    diskInfo: (path?: string): Promise<{
      success: boolean;
      info: {
        path: string;
        total: number;
        used: number;
        available: number;
        usagePercent: number;
      } | null;
      error?: string;
    }> => ipcRenderer.invoke('file:disk-info', { path }),

    readText: (path: string): Promise<{ success: boolean; content: string; error?: string }> =>
      ipcRenderer.invoke('file:read-text', { path }),

    quickPaths: (): Promise<{
      success: boolean;
      paths: { label: string; path: string; icon: string }[];
    }> => ipcRenderer.invoke('file:quick-paths'),

    // ========== 文件管理增强 ==========
    listDevices: (): Promise<{
      success: boolean;
      devices: { serial: string; state: string; model?: string }[];
      error?: string;
    }> => ipcRenderer.invoke('file:list-devices'),

    createFile: (path: string, content?: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:create-file', { path, content }),

    writeFile: (path: string, content: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:write-file', { path, content }),

    chmod: (
      path: string,
      mode: string,
      recursive?: boolean,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:chmod', { path, mode, recursive }),

    batchRemove: (
      paths: string[],
      recursive?: boolean,
    ): Promise<{
      success: boolean;
      deleted: string[];
      failed: { path: string; error: string }[];
      error?: string;
    }> => ipcRenderer.invoke('file:batch-remove', { paths, recursive }),

    search: (
      dir: string,
      query: string,
      deviceSerial?: string,
    ): Promise<{ success: boolean; entries: unknown[]; error?: string }> =>
      ipcRenderer.invoke('file:search', { dir, query, deviceSerial }),

    setCompatMode: (enabled: boolean): Promise<{ success: boolean; compatMode: boolean }> =>
      ipcRenderer.invoke('file:set-compat-mode', { enabled }),

    setKeepMtime: (enabled: boolean): Promise<{ success: boolean; keepMtime: boolean }> =>
      ipcRenderer.invoke('file:set-keep-mtime', { enabled }),

    // APK 解析(不需要设备连接)
    parseApk: (apkPath: string): Promise<{
      packageName: string;
      versionName?: string;
      versionCode?: string;
      minSdkVersion?: number;
      targetSdkVersion?: number;
      permissions: string[];
      apkSize: number;
      dexSize?: number;
      abis: string[];
      signer?: string;
      label?: string;
      iconBase64?: string;
      iconMime?: string;
    }> => ipcRenderer.invoke('file:parse-apk', { apkPath }),

    onTransferProgress: (cb: (p: {
      local: string;
      remote: string;
      direction: 'push' | 'pull';
      transferred: number;
      total: number;
      percent: number;
    }) => void) => {
      const handler = (_: unknown, p: unknown): void => cb(p as never);
      ipcRenderer.on('file:transfer-progress', handler);
      return () => ipcRenderer.removeListener('file:transfer-progress', handler);
    },
  },

  // ========== edl-part:* 通道(EDL 分区管理,基于 edl-ng) ==========
  edlPartition: {
    listLoaders: (): Promise<{
      success: boolean;
      loaders: { name: string; path: string; description: string }[];
    }> => ipcRenderer.invoke('edl-part:list-loaders'),

    checkEdlDevice: (): Promise<{
      success: boolean;
      inEdl: boolean;
      port?: string;
      error?: string;
    }> => ipcRenderer.invoke('edl-part:check-edl-device'),

    printGpt: (loader: string): Promise<{
      success: boolean;
      partitions: {
        label: string;
        typeGuid: string;
        uid: string;
        firstLba: number;
        lastLba: number;
        sizeBytes: number;
        lun: number;
      }[];
      storage?: { sectorSize: number; lunCount: number };
      error?: string;
    }> => ipcRenderer.invoke('edl-part:print-gpt', { loader }),

    backupPartition: (opts: {
      loader: string;
      label: string;
      outputFile: string;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('edl-part:backup-partition', opts),

    restorePartition: (opts: {
      loader: string;
      label: string;
      inputFile: string;
      backupBeforeRestore?: boolean;
      backupOutputDir?: string;
      verifyAfterRestore?: boolean;
    }): Promise<{ success: boolean; error?: string; backupPath?: string }> =>
      ipcRenderer.invoke('edl-part:restore-partition', opts),

    erasePartition: (opts: {
      loader: string;
      label: string;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('edl-part:erase-partition', opts),

    verifyPartition: (opts: {
      loader: string;
      label: string;
      expectedFile: string;
    }): Promise<{
      success: boolean;
      result: {
        success: boolean;
        matched: boolean;
        bytesRead: number;
        bytesExpected: number;
        error?: string;
      };
    }> => ipcRenderer.invoke('edl-part:verify-partition', opts),

    resetDevice: (loader: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('edl-part:reset-device', { loader }),

    getHistory: (): Promise<{
      success: boolean;
      history: {
        id: string;
        type: 'printgpt' | 'backup' | 'restore' | 'erase' | 'reset' | 'verify';
        label: string;
        timestamp: number;
        success: boolean;
        message: string;
        durationMs: number;
      }[];
    }> => ipcRenderer.invoke('edl-part:get-history'),

    clearHistory: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('edl-part:clear-history'),

    onProgress: (cb: (data: { msg: string; ts: number }) => void) => {
      const handler = (_: unknown, data: { msg: string; ts: number }): void => cb(data);
      ipcRenderer.on('edl-part:progress', handler);
      return () => ipcRenderer.removeListener('edl-part:progress', handler);
    },

    onTransferProgress: (cb: (p: {
      operation: string;
      percent: number;
      transferredMiB: number;
      totalMiB: number;
      speed: string;
    }) => void) => {
      const handler = (_: unknown, p: unknown): void => cb(p as never);
      ipcRenderer.on('edl-part:transfer-progress', handler);
      return () => ipcRenderer.removeListener('edl-part:transfer-progress', handler);
    },
  },

  // 平台信息(渲染进程可能需要)
  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development',
};

contextBridge.exposeInMainWorld('api', api);

// TypeScript 类型导出(供渲染进程声明 global)
export type Api = typeof api;
