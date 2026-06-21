// src/routes/Home.tsx - 主菜单页 + 设备状态(整合)
// 菜单选项写死在 src/lib/menus.ts,设备状态原 Device 路由已合并到此处

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Info,
  Smartphone,
  Zap,
  Cpu,
  CircleAlert,
  WifiOff,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { MAIN_MENU, type MenuItem } from '../lib/menus';
import { cn, formatDeviceType, formatTime, formatBytes } from '../lib/utils';
import { APP_META, type DeviceInfo } from '../../shared/types';
import { useDeviceStore } from '../stores/deviceStore';
import { api } from '../lib/api';
import { toast } from '../stores/toastStore';

export function Home(): JSX.Element {
  const navigate = useNavigate();
  const device = useDeviceStore((s) => s.current);
  const [refreshing, setRefreshing] = useState(false);

  const handleClick = async (item: MenuItem): Promise<void> => {
    if (item.disabled) {
      return;
    }
    if (item.to) {
      navigate(item.to);
    } else if (item.value === '2') {
      // 打开带 adb 环境的终端
      const res = await api.system.openTerminal();
      if (!res.success) {
        toast.err(`打开终端失败: ${res.error}`);
      }
    }
  };

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const info = await api.device.current();
      useDeviceStore.getState().setCurrent(info);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  return (
    <div className="space-y-6">
      {/* 欢迎信息 */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-br from-blue-950/40 via-zinc-900 to-zinc-950 p-6">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="relative">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">iMooDesktop</h1>
          <p className="mt-1 text-sm text-zinc-400">
            XTC 电话手表工具箱 · v{APP_META.version}
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            仅供学习交流,严禁用于商业用途与手表强制解绑
          </p>
        </div>
      </div>

      {/* 设备状态 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            设备状态
          </h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            刷新
          </button>
        </div>
        {device === null ? (
          <EmptyDevice />
        ) : (
          <DeviceCard device={device} />
        )}
        <ConnectionGuide />
      </section>

      {/* 主菜单 */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          主菜单
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MAIN_MENU.map((item) => {
            const Icon = item.icon ?? Info;
            const isRoot = item.danger;
            return (
              <button
                key={item.value}
                onClick={() => handleClick(item)}
                className={cn(
                  'group flex items-center gap-4 rounded-lg border p-4 text-left transition-all',
                  isRoot
                    ? 'border-red-900/40 bg-red-950/10 hover:border-red-700/60 hover:bg-red-950/20 hover:shadow-[0_0_20px_-5px] hover:shadow-red-900/40'
                    : 'border-zinc-800/80 bg-zinc-900/30 hover:border-blue-600/60 hover:bg-blue-950/20 hover:shadow-[0_0_20px_-5px] hover:shadow-blue-900/40',
                  item.disabled &&
                    'cursor-not-allowed opacity-60 hover:border-zinc-800/80 hover:bg-zinc-900/30 hover:shadow-none',
                )}
              >
                <div
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors',
                    isRoot
                      ? 'bg-red-600/15 text-red-400 group-hover:bg-red-600/25'
                      : 'bg-blue-600/15 text-blue-400 group-hover:bg-blue-600 group-hover:text-white',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'flex items-center gap-2 font-medium',
                      isRoot ? 'text-red-200' : 'text-zinc-100',
                    )}
                  >
                    {item.label}
                    {item.disabled && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                        未开放
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {item.description ?? '点击进入'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ========== 设备状态组件(原 Device.tsx) ==========

function DeviceCard({ device }: { device: DeviceInfo }): JSX.Element {
  // 存储容量格式化
  const storageStr =
    device.storageTotal !== undefined && device.storageAvailable !== undefined
      ? `${formatBytes(device.storageAvailable)} / ${formatBytes(device.storageTotal)}`
      : undefined;

  const rows: { label: string; value: string | undefined }[] = [
    { label: '设备类型', value: formatDeviceType(device.type) },
    { label: '序列号', value: device.serial },
    { label: 'COM 端口', value: device.port },
    { label: '型号', value: device.innermodelName },
    { label: '内部型号', value: device.innermodel },
    { label: '产品型号', value: device.model },
    { label: 'Android 版本', value: device.androidVersion },
    { label: 'SDK 版本', value: device.sdkVersion },
    { label: '软件版本', value: device.softVersion },
    { label: 'V3 协议', value: device.isV3 === undefined ? undefined : device.isV3 ? '是' : '否' },
    { label: '平台', value: device.platform },
    { label: 'CPU 架构', value: device.cpuAbi },
    { label: '屏幕密度', value: device.density ? `${device.density} dpi` : undefined },
    { label: '电量', value: device.batteryLevel !== undefined ? `${device.batteryLevel}%` : undefined },
    { label: '存储可用', value: storageStr },
    { label: 'Build ID', value: device.buildId },
    { label: '构建时间', value: device.buildDate },
    { label: '连接时间', value: device.connectedAt ? formatTime(device.connectedAt) : undefined },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-2.5',
          device.type === 'adb' && 'bg-blue-950/30',
          device.type === 'fastboot' && 'bg-amber-950/30',
          device.type === 'qcom_edl' && 'bg-purple-950/30',
        )}
      >
        <DeviceIcon type={device.type} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">
            {device.innermodelName ?? formatDeviceType(device.type)}
            {device.port ? ` · ${device.port}` : ''}
          </div>
          <div className="text-[11px] text-zinc-500">
            {device.serial}
            {device.batteryLevel !== undefined && (
              <span className="ml-2 text-zinc-600">电量 {device.batteryLevel}%</span>
            )}
          </div>
        </div>
        {device.batteryLevel !== undefined && (
          <BatteryBadge level={device.batteryLevel} />
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {rows.map(
          (row) =>
            row.value !== undefined && (
              <div
                key={row.label}
                className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-2 text-xs"
              >
                <span className="text-zinc-500">{row.label}</span>
                <span className="ml-2 truncate font-mono text-zinc-200" title={row.value}>
                  {row.value}
                </span>
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/** 电量徽章(颜色根据电量变化) */
function BatteryBadge({ level }: { level: number }): JSX.Element {
  const color = level > 50 ? 'text-green-400' : level > 20 ? 'text-amber-400' : 'text-red-400';
  return (
    <span className={cn('shrink-0 text-xs font-medium', color)}>{level}%</span>
  );
}

function EmptyDevice(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 py-10">
      <WifiOff className="h-10 w-10 text-zinc-600" />
      <div className="text-sm text-zinc-400">未检测到设备</div>
      <p className="max-w-md text-center text-xs text-zinc-500">
        请连接手表到电脑,并确保已开启 ADB 调试。详见下方连接引导。
      </p>
    </div>
  );
}

function DeviceIcon({ type }: { type: string }): JSX.Element {
  switch (type) {
    case 'adb':
    case 'emulator':
      return <Smartphone className="h-4 w-4" />;
    case 'fastboot':
      return <Zap className="h-4 w-4" />;
    case 'qcom_edl':
    case 'sprd_edl':
      return <Cpu className="h-4 w-4" />;
    case 'unauthorized':
      return <CircleAlert className="h-4 w-4" />;
    case 'offline':
      return <WifiOff className="h-4 w-4" />;
    default:
      return <Smartphone className="h-4 w-4" />;
  }
}

function ConnectionGuide(): JSX.Element {
  return (
    <div className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-900/20 p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
        <ExternalLink className="h-3 w-3 text-blue-500" />
        连接引导
      </h3>
      <div className="space-y-2 text-xs text-zinc-400">
        <div>
          <span className="text-zinc-300">方式一:</span>
          在手表上打开拨号盘,输入{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-blue-300">
            *#0769651#*
          </code>{' '}
          打开 ADB 开关,随后用数据线连接电脑。
        </div>
        <div>
          <span className="text-zinc-300">方式二:</span>
          打开手表卡槽,用金属物品短接触点,随后用数据线连接电脑。
        </div>
        <div className="rounded bg-amber-950/20 p-2 text-[11px] text-amber-300/80">
          注意:Z2、Z3、Z5A、Z5Q、Z6 请使用方式一连接,输入无反应需断网恢复出厂设置重试,Z2 v3.3.5 需超降级。
        </div>
      </div>
    </div>
  );
}
