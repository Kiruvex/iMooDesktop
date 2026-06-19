// src/lib/api.ts - window.api 类型封装
// 见 plan.md 8.3 渲染进程封装

import type { AppSettings, DeviceInfo, DeviceType, LogEntry, VerifyResult, RebootMode } from '../../shared/types';

// 重新导出,保持下游 `import { type RebootMode } from '../lib/api'` 可用
export type { RebootMode };

export interface CloudResource {
  name: string;
  filename: string;
  required: boolean;
  extract: boolean;
  extractTo?: string;
  category: string;
  description: string;
  cloudVersion?: string;
  localVersion?: string;
}

export interface ScrcpyOptions {
  noControl?: boolean;
  turnScreenOff?: boolean;
  stayAwake?: boolean;
  record?: string;
  noAudio?: boolean;
  audio?: boolean;
  noClipboardAutosync?: boolean;
  legacyPaste?: boolean;
  showTouches?: boolean;
  maxFps?: number;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  windowBorderless?: boolean;
  recordFormat?: 'mp4' | 'mkv';
  bitRate?: number;
  crop?: string;
  windowTitle?: string;
  maxSize?: number;
}

// ========== Magisk 模块相关类型(对应 plan.md 6.9 MagiskService) ==========

/** 模块安装方式(对应原 instmodule.bat 的 magisk / shinst / peremptory) */
export type InstallMethod = 'magisk' | 'shinst' | 'peremptory';

/** 模块卸载方式(对应原 unmodule.bat 的 mark / direct / script) */
export type UninstallMethod = 'mark' | 'direct' | 'script';

/** Magisk 模块信息(对应 list_modules.sh 的输出) */
export interface MagiskModule {
  id: string;
  name: string;
  version: string;
  versionCode: string;
  author: string;
  status: string;
  description: string;
  updateJson: string;
}

/** 商店模块信息(M5 新增,对应 MagiskService.storeSearch 返回) */
export interface StoreModule {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  versionCode: string;
  downloadUrl: string;
  homepage: string;
  lastUpdate: string;
}

// ========== Z10/自启相关类型(M5) ==========

export interface Z10UnlockStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
}

export interface Z10UnlockResult {
  success: boolean;
  steps: Z10UnlockStep[];
  error?: string;
}

export interface AutoStartResult {
  success: boolean;
  results: { pkg: string; success: boolean; error?: string }[];
  error?: string;
}

// ========== OTA 相关类型(M5) ==========

export interface OtaStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
}

export interface OtaStartResult {
  success: boolean;
  steps: OtaStep[];
  scrcpyStarted: boolean;
  error?: string;
}

// ========== RootPro 相关类型(M5) ==========

export interface RootProStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
}

export interface RootProResult {
  success: boolean;
  supported: boolean;
  steps: RootProStep[];
  innermodel?: string;
  model?: string;
  androidVersion?: string;
  sdkVersion?: string;
  softVersion?: string;
  isV3?: boolean;
  haveSystemUI?: boolean;
  error?: string;
}

export interface RootProOptions {
  installApks?: boolean;
  installDesktop?: boolean;
  installMods?: boolean;
}

// ========== 驱动相关类型(M5) ==========

export interface DriverStatus {
  qualcomm: boolean;
  adb: boolean;
  vcRuntime: boolean;
}

export interface DriverCheckResult {
  success: boolean;
  status: DriverStatus;
  allInstalled: boolean;
  error?: string;
}

export interface DriverInstallStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
}

export interface DriverInstallResult {
  success: boolean;
  steps: DriverInstallStep[];
  error?: string;
}

// ========== Atbmod 相关类型(M5) ==========

export interface AtbmodFile {
  path: string;
  filename: string;
  size: number;
}

export interface AtbmodProp {
  modid: string;
  modname: string;
  modversion: string;
  modversioncode: string;
  modtype: string;
}

export interface InstalledAtbmod {
  modid: string;
  dir: string;
  hasProp: boolean;
  prop?: AtbmodProp;
}

// ========== 应用更新相关类型(M5) ==========

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  error?: string;
}

// ========== 备份恢复相关类型(对应 plan.md 6.11 BackupService) ==========

/** adb-dd 恢复时的分区匹配结果 */
export interface AdbDdMatchResult {
  /** 备份中包含、设备上也存在的分区(将被恢复) */
  matched: string[];
  /** 备份中包含、设备上不存在的分区(跳过) */
  skipped: string[];
}

// ========== Root 相关类型(对应 plan.md 6.7 RootService) ==========

/** Root stage 枚举(60+ 个 stage,见 RootService.ts) */
export type RootStage =
  | 'idle'
  | 'preparing-resources'
  | 'showing-disclaimer'
  | 'detecting-device'
  | 'selecting-model'
  | 'entering-edl'
  | 'waiting-adb-after-edl'
  | 'reading-device-info'
  | 'detecting-v3'
  | 'extracting-root-zip'
  | 'routing-by-sdk'
  | 'sdk19-backup-dcim'
  | 'sdk19-flash-boot'
  | 'sdk19-install-magisk'
  | 'sdk19-install-xtcpatch'
  | 'sdk19-restore-dcim'
  | 'sdk19-reboot'
  | 'sdk25-backup-dcim'
  | 'sdk25-select-scheme'
  | 'sdk25-entering-edl'
  | 'sdk25-reading-boot'
  | 'sdk25-patching-boot'
  | 'sdk25-flashing'
  | 'sdk25-rebooting'
  | 'sdk25-waiting-boot'
  | 'sdk25-install-magisk'
  | 'sdk25-install-xtcpatch'
  | 'sdk25-boot-scheme-second-edl'
  | 'sdk25-restore-dcim'
  | 'sdk27-backup-dcim'
  | 'sdk27-entering-edl'
  | 'sdk27-reading-boot'
  | 'sdk27-patching-boot'
  | 'sdk27-flashing-rawprogram'
  | 'sdk27-rebooting-to-fastboot'
  | 'sdk27-fastboot-flash-boot'
  | 'sdk27-fastboot-flash-userdata'
  | 'sdk27-fastboot-flash-misc'
  | 'sdk27-waiting-boot'
  | 'sdk27-install-preinstall'
  | 'sdk27-enable-charge'
  | 'sdk27-auto-grant-magisk'
  | 'sdk27-activate-systemplus'
  | 'sdk27-install-xtcpatch'
  | 'sdk27-install-systemui'
  | 'sdk27-install-preinstall-apk'
  | 'sdk27-erase-misc-reboot'
  | 'sdk27-install-bundled-apks'
  | 'sdk27-compile-packages'
  | 'sdk27-restore-dcim'
  | 'nd03-download-zip'
  | 'nd03-extract'
  | 'nd03-entering-edl'
  | 'nd03-flash-281-recovery'
  | 'nd03-flash-root-firmware'
  | 'nd03-erase-boot'
  | 'nd03-reboot-to-fastboot'
  | 'nd03-fastboot-flash-boot'
  | 'nd03-boot-recovery'
  | 'nd03-sideload-dm'
  | 'nd03-flash-misc-reboot'
  | 'nd03-wait-3-reboots'
  | 'nd03-auto-grant-magisk'
  | 'nd03-install-xtcpatch'
  | 'nd03-install-toolkit'
  | 'nd03-activate-lsposed'
  | 'nd03-install-preinstall'
  | 'nd03-compile-packages'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Root 选项(对应原 root.bat 的 nouserdata + ROOT-SDK25.bat 的 BOOT/Recovery 方案选择) */
export interface RootOptions {
  /** 不刷 userdata(对应原 root.bat 第一个参数) */
  nouserdata?: boolean;
  /** SDK25 方案:'boot' 或 'recovery'(对应 ROOT-SDK25.bat menu 1/2) */
  sdk25Scheme?: 'boot' | 'recovery';
  /** EDL 模式用户选的型号 innermodel(如 'I25') */
  modelChoice?: string;
}

/** Root 任务上下文(运行时状态) */
export interface RootContext {
  taskId: string;
  stage: RootStage;
  options: RootOptions;
  device: DeviceInfo | null;
  innermodel: string;
  isV3: boolean;
  smodel: boolean;
  sdkVersion: string;
  androidVersion: string;
  startedAt: number;
  endedAt?: number;
  paused: boolean;
  cancelled: boolean;
  dcimBackupDir?: string;
  edlPort?: string;
  sdk25Scheme?: 'boot' | 'recovery';
  patchedBootPath?: string;
  logs: { ts: number; level: 'info' | 'warn' | 'error'; msg: string }[];
  error?: { stage: RootStage; message: string; recoverable: boolean };
  progress: number;
}

interface ElectronApi {
  device: {
    current: () => Promise<DeviceInfo | null>;
    wait: (types: DeviceType[], timeout?: number) => Promise<DeviceInfo>;
    onChange: (cb: (info: DeviceInfo | null) => void) => () => void;
  };
  reboot: {
    execute: (opts: {
      mode: RebootMode;
      innermodel?: string;
      platform?: 'otherpash' | 'v3pash' | 'z10';
    }) => Promise<{ success: boolean; error?: string }>;
  };
  cloud: {
    list: () => Promise<CloudResource[]>;
    listByCategory: () => Promise<Record<string, CloudResource[]>>;
    download: (name: string) => Promise<{ success: boolean; error?: string }>;
    checkUpdates: () => Promise<{ resource: CloudResource; updateAvailable: boolean }[]>;
    onProgress: (cb: (data: { name: string; percent: number }) => void) => () => void;
  };
  scrcpy: {
    launch: (opts: ScrcpyOptions) => Promise<{ success: boolean; pid?: number; error?: string }>;
    stop: (pid: number) => Promise<{ success: boolean }>;
    stopAll: () => Promise<{ success: boolean }>;
    list: () => Promise<{ pid: number; opts: ScrcpyOptions; startedAt: number }[]>;
  };
  app: {
    list: (thirdParty?: boolean) => Promise<string[]>;
    install: (
      apk: string,
      method?: 'install' | 'data' | '3install' | 'create',
    ) => Promise<{ success: boolean; pkg?: string; error?: string }>;
    uninstall: (pkg: string) => Promise<{ success: boolean; error?: string }>;
    // M5:Z10 解除安装限制
    unlockZ10: () => Promise<Z10UnlockResult>;
    // M5:QQ/微信开机自启
    enableAutoStart: (packages?: string[]) => Promise<AutoStartResult>;
  };
  tools: {
    openCharge: () => Promise<{ success: boolean; error?: string }>;
    readBuildProps: () => Promise<{
      success: boolean;
      error?: string;
      props: { key: string; label: string; value: string }[];
    }>;
    wifiEnable: () => Promise<{ success: boolean; error?: string }>;
    wifiConnect: (ip: string, port?: number) => Promise<{ success: boolean; error?: string }>;
    wifiDisconnect: (ip: string, port?: number) => Promise<{ success: boolean; error?: string }>;
    // M5:OTA 升级
    otaStart: (zipPath: string) => Promise<OtaStartResult>;
    // M5:Root 后优化
    rootpro: (options: RootProOptions) => Promise<RootProResult>;
    // M5:驱动检测/安装
    checkDrivers: () => Promise<DriverCheckResult>;
    installDrivers: () => Promise<DriverInstallResult>;
    // M5:.atbmod 模块
    atbmodScan: () => Promise<{ success: boolean; files: AtbmodFile[]; error?: string }>;
    atbmodInstall: (file: string) => Promise<{ success: boolean; modid?: string; error?: string }>;
    atbmodList: () => Promise<{ success: boolean; installed: InstalledAtbmod[]; error?: string }>;
    atbmodUninstall: (modid: string) => Promise<{ success: boolean; error?: string }>;
    // M5:检查应用更新
    checkAppUpdate: () => Promise<UpdateInfo>;
  };
  // Magisk 模块管理(对应 plan.md 6.9 MagiskService)
  magisk: {
    list: () => Promise<{ success: boolean; modules?: MagiskModule[]; error?: string }>;
    install: (
      zip: string,
      method: InstallMethod,
    ) => Promise<{ success: boolean; error?: string }>;
    uninstall: (
      id: string,
      method: UninstallMethod,
    ) => Promise<{ success: boolean; error?: string }>;
    enable: (id: string) => Promise<{ success: boolean; error?: string }>;
    disable: (id: string) => Promise<{ success: boolean; error?: string }>;
    // M5:模块商店
    storeSearch: (query: string) => Promise<{ success: boolean; modules: StoreModule[] }>;
    storeInstall: (module: StoreModule) => Promise<{ success: boolean; error?: string }>;
  };
  // 备份恢复(对应 plan.md 6.11 BackupService + 6.5 EdlService)
  backup: {
    // DCIM 备份/恢复
    dcimBackup: (outputDir: string) => Promise<{ success: boolean; error?: string }>;
    dcimRecover: (inputDir: string) => Promise<{ success: boolean; error?: string }>;
    // ADB-dd 备份/恢复(两步:prepare 返回匹配,execute 写入)
    adbddBackup: (
      outputDir: string,
    ) => Promise<{ success: boolean; zipPath?: string; error?: string }>;
    adbddPrepare: (
      zipPath: string,
    ) => Promise<{
      success: boolean;
      extractDir?: string;
      match?: AdbDdMatchResult;
      error?: string;
    }>;
    adbddExecute: (
      extractDir: string,
      parts: string[],
    ) => Promise<{ success: boolean; error?: string }>;
    adbddRecover: (zipPath: string) => Promise<{ success: boolean; error?: string }>;
    // 9008 备份/恢复
    edlBackup: (opts: {
      innermodel: string;
      v3?: boolean;
      softVersion?: string;
      outputDir: string;
    }) => Promise<{ success: boolean; zipPath?: string; error?: string }>;
    edlRecover: (zipPath: string) => Promise<{ success: boolean; error?: string }>;
    // 超级恢复
    superRecovery: (folder: string) => Promise<{ success: boolean; error?: string }>;
    // TWRP 刷入(EDL 模式)
    flashTwrp: (innermodel: string) => Promise<{ success: boolean; error?: string }>;
    // 开机自刷 TWRP(ADB 模式)
    autoFlashTwrp: (innermodel: string) => Promise<{ success: boolean; error?: string }>;
    // Xposed 安装
    xposedInstall: () => Promise<{ success: boolean; error?: string }>;
    // 进度事件订阅
    onProgress: (cb: (data: { msg: string; ts: number }) => void) => () => void;
  };
  system: {
    getSettings: () => Promise<AppSettings>;
    setSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    pickFile: (opts: {
      kind: 'open' | 'folder';
      filter?: string;
      multi?: boolean;
    }) => Promise<string | string[] | null>;
    openExternal: (path: string) => Promise<void>;
    showInFolder: (path: string) => Promise<void>;
    verifyResources: () => Promise<VerifyResult[]>;
    getVersion: () => Promise<{ version: string; buildDate: string }>;
    setWindowOpacity: (opacity: number) => Promise<void>;
    // 窗口控制(自定义标题栏)
    windowMinimize: () => Promise<void>;
    windowToggleMaximize: () => Promise<void>;
    windowClose: () => Promise<void>;
    windowIsMaximized: () => Promise<boolean>;
    openTerminal: () => Promise<{ success: boolean; error?: string }>;
  };
  log: {
    subscribe: () => Promise<void>;
    unsubscribe: () => Promise<void>;
    onLine: (cb: (entry: LogEntry) => void) => () => void;
  };
  // Root 全流程(对应 plan.md 6.7 RootService)
  root: {
    start: (options: RootOptions) => Promise<{ success: boolean; taskId?: string; error?: string }>;
    cancel: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    pause: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    resume: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    getContext: (
      taskId: string,
    ) => Promise<{ success: boolean; context?: RootContext; error?: string }>;
    onStageChange: (cb: (ctx: RootContext) => void) => () => void;
  };
  platform: NodeJS.Platform;
  isDev: boolean;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}

export const api: ElectronApi = window.api;
export type { ElectronApi };
