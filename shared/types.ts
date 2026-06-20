// shared/types.ts - 主进程与渲染进程共享的类型定义
// 见 plan.md 7. 数据模型与类型定义

// ========== 设备相关 ==========
export type DeviceType =
  | 'adb'
  | 'fastboot'
  | 'qcom_edl'
  | 'sprd_edl'
  | 'emulator'
  | 'unauthorized'
  | 'offline';

export interface DeviceInfo {
  type: DeviceType;
  serial: string;
  port?: string; // 9008 的 COM 端口
  innermodel?: string; // ro.product.innermodel
  model?: string; // ro.product.model
  androidVersion?: string;
  sdkVersion?: string;
  softVersion?: string; // ro.product.current.softversion
  isV3?: boolean;
  innermodelName?: string; // 如 'Z7' = innermodel 'I25'
  platform?: 'otherpash' | 'v3pash' | 'z10';
  connectedAt?: number;
  // 扩展属性(ADB 模式下读取)
  cpuAbi?: string; // ro.product.cpu.abi(如 armeabi-v7a)
  density?: string; // ro.sf.lcd_density(如 320)
  batteryLevel?: number; // 电量百分比(0-100)
  storageTotal?: number; // 存储总容量(字节)
  storageAvailable?: number; // 可用存储(字节)
  buildId?: string; // ro.build.id
  buildDate?: string; // ro.build.date
}

// ========== 日志相关 ==========
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  taskId?: string;
  source: string; // 服务名
  message: string;
  raw?: string; // 原始子进程输出
}

// ========== 设置相关 ==========
export interface AppSettings {
  windowOpacity: number; // 0-100,默认 100
  speedStart: boolean; // 快速启动(对应原 settings/speedstart.txt)
  checkUpdateTime: number; // 检查更新间隔(小时,1-24,对应 settings/check_up_time.txt)
  detailedLog: boolean; // 详细日志(对应 settings/detailedlog.txt)
  infoEn: boolean; // 英文信息(对应 settings/infoen.txt)
  onUserDebug: boolean; // userdebug 模式(对应 settings/onuserdebug.txt)
  showDisclaimerOnStart: boolean; // 启动时显示免责声明(默认 true)
}

export const DEFAULT_SETTINGS: AppSettings = {
  windowOpacity: 100,
  speedStart: false,
  checkUpdateTime: 1,
  detailedLog: false,
  infoEn: false,
  onUserDebug: false,
  showDisclaimerOnStart: true,
};

// ========== 菜单相关 ==========
// 菜单选项类型定义在 src/lib/menus.ts 的 MenuItem 接口
// (2026-06-18 重新定位:菜单不读 JSON,选项写死在代码,见 plan.md 7.5 节)

// ========== 资源校验 ==========
export interface ManifestEntry {
  file: string;
  md5: string;
  size: number;
}

export interface VerifyResult {
  file: string;
  ok: boolean;
  expected: string;
  actual: string;
  missing: boolean;
}

// ========== IPC 通道类型 ==========
export interface IpcChannels {
  'device:current': { args: void; result: DeviceInfo | null };
  'device:wait': { args: { types: DeviceType[]; timeout?: number }; result: DeviceInfo };
  'system:get-settings': { args: void; result: AppSettings };
  'system:set-settings': { args: { settings: Partial<AppSettings> }; result: AppSettings };
  'system:pick-file': {
    args: { kind: 'open' | 'folder'; filter?: string; multi?: boolean };
    result: string | string[] | null;
  };
  'system:open-external': { args: { path: string }; result: void };
  'system:show-in-folder': { args: { path: string }; result: void };
  'system:verify-resources': { args: void; result: VerifyResult[] };
  'system:get-version': { args: void; result: { version: string; buildDate: string } };
  'log:subscribe': { args: void; result: void };
  'log:unsubscribe': { args: void; result: void };
}

// IPC 事件(主进程 → 渲染进程)
export interface IpcEvents {
  'log:line': (entry: LogEntry) => void;
  'device:change': (info: DeviceInfo | null) => void;
}

// ========== 共享业务类型(preload + renderer 共用) ==========

export type InstallMethod = 'magisk' | 'shinst' | 'peremptory';
export type UninstallMethod = 'mark' | 'direct' | 'script';

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

export interface StoreModule {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloadUrl: string;
  size?: number;
}

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

export interface AdbDdMatchResult {
  matched: string[];
  skipped: string[];
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  error?: string;
}

// ========== Root / Reboot 相关类型(preload + renderer 共用) ==========

export type RebootMode =
  | 'system'
  | 'bootloader'
  | 'recovery'
  | 'edl'
  | 'twrp-temp'
  | 'qmmi'
  | 'ffbm'
  | 'wipe-data'
  | 'fastbootd';

export interface RootOptions {
  nouserdata?: boolean;
  sdkBranch?: 19 | 25 | 27 | 'nd03' | 'nd08';
  modelChoice?: string;
  sdk25Scheme?: 'boot' | 'recovery';
}

export interface RootContext {
  stage: string;
  options: RootOptions;
  innermodel: string;
  isV3: boolean;
  smodel: boolean;
  startedAt: number;
  logs: { ts: number; level: string; msg: string }[];
  error?: { stage: string; message: string; recoverable: boolean };
  edlPort?: string;
  sdkVersion?: string;
  androidVersion?: string;
  softVersion?: string;
  progress: number;
}

// ========== 应用元信息 ==========
export const APP_META = {
  name: 'iMooDesktop',
  version: '1.0.0',
  buildDate: '2026-06-18',
  copyright: 'Copyright (C) 2026 Kiruvex',
  // 作者信息
  author: 'Kiruvex',
  authorQQ: '3038929349',
  authorQQGroup: '', // 交流 QQ 群(留空)
  authorWebsite: '', // GitHub 仓库地址(留空)
  authorEmail: '3038929349@qq.com',
  // 参考的项目(业务逻辑参考,非代码衍生)
  basedOn: 'AllToolBox 1.3.8fix1(业务逻辑参考)',
};
