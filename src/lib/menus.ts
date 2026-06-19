// src/lib/menus.ts - 菜单选项定义(写死在代码里,UI 自由设计)
//
// 重新定位(2026-06-18):原 resources/menus/*.json 降级为"参考文档",
// 菜单选项在代码里定义,可自由加 icon/description/分组。
// 业务逻辑(adb/fastboot/fh_loader 命令参数、Root 流程步骤等)仍 1:1 复刻原项目,
// 但菜单 UI 的视觉/字段/选项数量不在约束内。
//
// 参考原项目 bin/menu/*.json 确保选项覆盖完整(不漏功能),
// 但字段结构和文案可自由调整。

import {
  Smartphone,
  TerminalSquare,
  Info,
  Wrench,
  RotateCw,
  Download,
  AppWindow,
  Boxes,
  Settings,
  ShieldAlert,
  DatabaseBackup,
  HardDriveDownload,
  Activity,
  BatteryCharging,
  MonitorSmartphone,
  Network,
  Cpu,
  Power,
  RefreshCw,
  ToggleRight,
  PackageSearch,
  ListPlus,
  Trash2,
  ListChecks,
  Upload,
  FolderTree,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface MenuItem {
  /** 选项值(对应原 JSON 的 value,业务逻辑可能依赖) */
  value: string;
  /** 显示文案 */
  label: string;
  /** 描述 */
  description?: string;
  /** 图标 */
  icon: ComponentType<LucideProps>;
  /** 是否危险操作(红色高亮) */
  danger?: boolean;
  /** 跳转路由(若有) */
  to?: string;
  /** 是否未实现 */
  disabled?: boolean;
  /** 里程碑标识 */
  milestone?: string;
}

// ========== 主菜单(对应原 main.json) ==========
export const MAIN_MENU: MenuItem[] = [
  {
    value: '1',
    label: '一键 Root 设备',
    description: '通过 ADB 或 EDL (9008) 模式 Root 手表',
    icon: ShieldAlert,
    danger: true,
    to: '/root',
  },
  {
    value: '2',
    label: '在此处打开 CMD',
    description: '打开含 adb 环境的命令行',
    icon: TerminalSquare,
  },
  {
    value: '3',
    label: '关于脚本',
    description: '版本信息与作者',
    icon: Info,
    to: '/settings',
  },
  {
    value: '4',
    label: '常用功能',
    description: 'scrcpy 投屏、充电、无线 ADB 等',
    icon: Wrench,
    to: '/tools',
  },
  {
    value: '5',
    label: '高级重启',
    description: '9 种重启模式(系统/Bootloader/Recovery/9008 等)',
    icon: RotateCw,
    to: '/reboot',
  },
  {
    value: '6',
    label: '下载功能所需资源',
    description: '从云端拉取 userdata/apks/xtcpatch 等资源',
    icon: Download,
    to: '/cloud',
  },
  {
    value: '7',
    label: '应用管理',
    description: '安装/卸载应用、开机自启管理',
    icon: AppWindow,
    to: '/apps',
  },
  {
    value: '8',
    label: 'Magisk 模块管理',
    description: '模块安装/卸载/列表/商店',
    icon: Boxes,
    to: '/magisk',
  },
  {
    value: '9',
    label: '其他功能',
    description: '型号对照、本地 root 导入、读手表信息',
    icon: Wrench,
    to: '/tools',
  },
  {
    value: '10',
    label: '工具箱设置',
    description: '快速启动、版本、检查更新、窗口设置',
    icon: Settings,
    to: '/settings',
  },
];

// ========== 常用功能菜单(对应原 commonly.json,M2 用) ==========
export const COMMONLY_MENU: MenuItem[] = [
  { value: '1', label: '离线 OTA 升级', icon: Download, to: '/tools' },
  { value: '2', label: '刷入 TWRP', icon: HardDriveDownload, to: '/backup' },
  { value: '3', label: '备份与恢复', icon: DatabaseBackup, to: '/backup' },
  { value: '4', label: '安卓 8.1 Root 后优化', icon: Wrench, to: '/tools' },
  { value: '5', label: 'scrcpy 投屏', icon: MonitorSmartphone, to: '/tools' },
  { value: '6', label: '打开充电可用', icon: BatteryCharging, to: '/tools' },
  { value: '7', label: '刷入固件包或超级恢复', icon: HardDriveDownload, to: '/backup' },
  { value: '8', label: '7.1 机型刷入 XP 框架', icon: PackageSearch, to: '/backup' },
  { value: '9', label: '无线调试 (ADB)', icon: Network, to: '/tools' },
];

// ========== 高级重启菜单(对应原 rebootpro.json,M2 用) ==========
export const REBOOT_MENU: MenuItem[] = [
  { value: '1', label: '重启至系统', icon: Power, to: '/reboot' },
  { value: '2', label: '重启至 Bootloader/Fastboot', icon: Cpu, to: '/reboot' },
  { value: '3', label: '重启至 Recovery', icon: RefreshCw, to: '/reboot' },
  { value: '4', label: '重启至 9008 (EDL)', icon: Cpu, danger: true, to: '/reboot' },
  { value: '5', label: '临时启动 TWRP', icon: HardDriveDownload, to: '/reboot' },
  { value: '6', label: 'misc 进入 qmmi', icon: ToggleRight, to: '/reboot' },
  { value: '7', label: 'misc 进入 ffbm', icon: ToggleRight, to: '/reboot' },
  { value: '8', label: 'misc 进入 Recovery 并清除 data', icon: Trash2, danger: true, to: '/reboot' },
  { value: '9', label: 'misc 进入 fastbootd', icon: ToggleRight, to: '/reboot' },
];

// ========== 应用管理菜单(对应原 appset.json,M2 用) ==========
export const APPSET_MENU: MenuItem[] = [
  { value: '1', label: '安装应用', icon: Upload, to: '/apps' },
  { value: '2', label: '卸载应用', icon: Trash2, to: '/apps' },
  { value: '3', label: '设置微信 QQ 为开机自启应用', icon: ToggleRight, to: '/apps' },
  { value: '4', label: '解除 z10 [1.0.1] 安装限制', icon: ToggleRight, to: '/apps' },
];

// ========== Magisk 模块管理菜单(对应原 magisk.json,M3 用) ==========
export const MAGISK_MENU: MenuItem[] = [
  { value: '1', label: '选择并刷入单个 Magisk 模块', icon: Upload, to: '/magisk' },
  { value: '2', label: '选择并刷入多个 Magisk 模块', icon: ListPlus, to: '/magisk' },
  { value: '3', label: '选择文件夹刷入所有 Magisk 模块', icon: FolderTree, to: '/magisk' },
  { value: '4', label: '列出已安装的 Magisk 模块', icon: ListChecks, to: '/magisk' },
  { value: '5', label: '卸载指定 Magisk 模块', icon: Trash2, to: '/magisk' },
  { value: '6', label: '切换安装 Magisk 模块的方式', icon: ToggleRight, to: '/magisk' },
  { value: '7', label: '切换卸载 Magisk 模块的方式', icon: ToggleRight, to: '/magisk' },
  { value: '8', label: '刷入 XTC Patch (可用于更新)', icon: PackageSearch, to: '/magisk' },
  { value: '9', label: '模块商店', icon: PackageSearch, to: '/magisk' },
];

// ========== 设置菜单(对应原 settings.json) ==========
export const SETTINGS_MENU: MenuItem[] = [
  { value: '1', label: '开启/关闭快速启动', icon: ToggleRight },
  { value: '2', label: '版本信息', icon: Info },
  { value: '3', label: '检查更新', icon: Download },
  { value: '4', label: '拉取公告', icon: Activity },
  { value: '5', label: 'CMD 窗口设置', icon: Settings },
  { value: '6', label: '设置检查更新的间隔时间', icon: RefreshCw },
];

// ========== 其他工具菜单(对应原 scripttool.json) ==========
export const TOOLS_MENU: MenuItem[] = [
  { value: '1', label: '型号与 innermodel 对照表', icon: Smartphone, to: '/tools' },
  { value: '2', label: '导入本地 root 文件', icon: Upload, to: '/root' },
  { value: '3', label: '一键 Root (不刷 userdata)', icon: ShieldAlert, danger: true, to: '/root' },
  { value: '4', label: '开机自刷 Recovery', icon: HardDriveDownload, to: '/backup' },
  { value: '5', label: '读取手表信息', icon: Info, to: '/tools' },
];

// ========== Root 型号选择菜单(对应原 root.json,M4 用) ==========
export const ROOT_MODEL_MENU: MenuItem[] = [
  { value: '1', label: 'Z2', icon: Smartphone },
  { value: '2', label: 'Z3', icon: Smartphone },
  { value: '3', label: 'Z5A', icon: Smartphone },
  { value: '4', label: 'Z5Q', icon: Smartphone },
  { value: '5', label: 'Z5PRO', icon: Smartphone },
  { value: '6', label: 'Z6', icon: Smartphone },
  { value: '7', label: 'Z6 巅峰版', icon: Smartphone },
  { value: '8', label: 'Z7', icon: Smartphone },
  { value: '9', label: 'Z7A', icon: Smartphone },
  { value: '10', label: 'Z7S', icon: Smartphone },
  { value: '11', label: 'Z8 (或少年版)', icon: Smartphone },
  { value: '12', label: 'Z8A', icon: Smartphone },
  { value: '13', label: 'Z9 (或少年版)', icon: Smartphone },
  { value: '14', label: 'Z10 (或少年版)', icon: Smartphone },
  { value: '15', label: 'Z11 (或少年版)', icon: Smartphone },
];

/** 按 name 获取菜单(M2-M5 路由用) */
export function getMenu(name: string): MenuItem[] {
  switch (name) {
    case 'main':
      return MAIN_MENU;
    case 'commonly':
      return COMMONLY_MENU;
    case 'rebootpro':
      return REBOOT_MENU;
    case 'appset':
      return APPSET_MENU;
    case 'magisk':
      return MAGISK_MENU;
    case 'settings':
      return SETTINGS_MENU;
    case 'scripttool':
      return TOOLS_MENU;
    case 'root':
      return ROOT_MODEL_MENU;
    default:
      return [];
  }
}
