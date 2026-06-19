// src/routes/Device.tsx - 设备状态页
// 见 plan.md 5. src/routes/Device.tsx

import { useEffect, useState } from 'react';
import {
  Smartphone,
  Zap,
  Cpu,
  CircleAlert,
  WifiOff,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { useDeviceStore } from '../stores/deviceStore';
import { api } from '../lib/api';
import { formatDeviceType, formatTime } from '../lib/utils';
import { cn } from '../lib/utils';
import type { DeviceInfo } from '../../shared/types';

export function Device(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [refreshing, setRefreshing] = useState(false);

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">设备状态</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          刷新
        </button>
      </div>

      {device === null ? (
        <EmptyDevice />
      ) : (
        <DeviceCard device={device} />
      )}

      {/* 连接引导 */}
      <ConnectionGuide />
    </div>
  );
}

function DeviceCard({ device }: { device: DeviceInfo }): JSX.Element {
  const rows: { label: string; value: string | undefined }[] = [
    { label: '设备类型', value: formatDeviceType(device.type) },
    { label: '序列号', value: device.serial },
    { label: 'COM 端口', value: device.port },
    { label: '内部型号 (innermodel)', value: device.innermodel },
    { label: '产品型号 (model)', value: device.model },
    { label: 'Android 版本', value: device.androidVersion },
    { label: 'SDK 版本', value: device.sdkVersion },
    { label: '软件版本', value: device.softVersion },
    { label: 'V3 协议', value: device.isV3 === undefined ? undefined : device.isV3 ? '是' : '否' },
    { label: '平台', value: device.platform },
    { label: '连接时间', value: device.connectedAt ? formatTime(device.connectedAt) : undefined },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3',
          device.type === 'adb' && 'bg-blue-950/40',
          device.type === 'fastboot' && 'bg-amber-950/40',
          device.type === 'qcom_edl' && 'bg-purple-950/40',
        )}
      >
        <DeviceIcon type={device.type} />
        <div>
          <div className="font-medium">{formatDeviceType(device.type)}</div>
          <div className="text-xs text-zinc-400">{device.serial}</div>
        </div>
      </div>
      <div className="divide-y divide-zinc-800">
        {rows.map(
          (row) =>
            row.value !== undefined && (
              <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-zinc-400">{row.label}</span>
                <span className="font-mono text-sm text-zinc-100">{row.value}</span>
              </div>
            ),
        )}
      </div>
    </div>
  );
}

function EmptyDevice(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-zinc-800 py-16">
      <WifiOff className="h-12 w-12 text-zinc-600" />
      <div className="text-zinc-400">未检测到设备</div>
      <p className="max-w-md text-center text-sm text-zinc-500">
        请连接手表到电脑,并确保已开启 ADB 调试。详见下方连接引导。
      </p>
    </div>
  );
}

function DeviceIcon({ type }: { type: string }): JSX.Element {
  switch (type) {
    case 'adb':
    case 'emulator':
      return <Smartphone className="h-5 w-5" />;
    case 'fastboot':
      return <Zap className="h-5 w-5" />;
    case 'qcom_edl':
    case 'sprd_edl':
      return <Cpu className="h-5 w-5" />;
    case 'unauthorized':
      return <CircleAlert className="h-5 w-5" />;
    default:
      return <Smartphone className="h-5 w-5" />;
  }
}

function ConnectionGuide(): JSX.Element {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-medium">
        <ExternalLink className="h-4 w-4 text-blue-500" />
        连接引导
      </h2>
      <div className="space-y-3 text-sm text-zinc-300">
        <div>
          <div className="mb-1 font-medium text-zinc-100">方式一:拨号盘开启 ADB</div>
          <p className="text-zinc-400">
            在手表上打开拨号盘,输入 <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-blue-300">*#0769651#*</code>{' '}
            打开 ADB 开关,随后用数据线连接电脑。
          </p>
        </div>
        <div>
          <div className="mb-1 font-medium text-zinc-100">方式二:短接触点</div>
          <p className="text-zinc-400">
            打开手表卡槽,用金属物品短接触点,随后用数据线连接电脑。
          </p>
        </div>
        <div className="rounded bg-amber-950/30 p-3 text-xs text-amber-300">
          注意:Z2、Z3、Z5A、Z5Q、Z6 请使用方式一连接,输入无反应需断网恢复出厂设置重试,Z2 v3.3.5 需超降级。
        </div>
      </div>
    </div>
  );
}
