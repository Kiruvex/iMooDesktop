// src/components/layout/TopBar.tsx - 顶部标题栏(自定义边框,可拖拽)
// 见 plan.md 9.4 AppShell 布局图
// UI 规范:蓝色主题、lucide 图标、无 emoji
// 无边框窗口:整个标题栏设为 drag 区域,按钮区域设为 no-drag

import { Smartphone, Zap, Cpu, CircleAlert, WifiOff } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';
import { formatDeviceType, cn } from '../../lib/utils';
import { WindowControls } from './WindowControls';
import { APP_META } from '../../../shared/types';
import iconUrl from '../../assets/icon.svg';

export function TopBar(): JSX.Element {
  const device = useDeviceStore((s) => s.current);

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-zinc-950/70 px-3 backdrop-blur-xl"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Logo(可拖拽区域) */}
      <div className="flex items-center gap-2.5 pl-1">
        <img src={iconUrl} alt="iMooDesktop" className="h-7 w-7 rounded-md" />
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold tracking-tight text-zinc-100">
            iMooDesktop
          </span>
          <span className="text-[10px] font-medium text-zinc-600">v{APP_META.version}</span>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="h-4 w-px bg-zinc-800/80" />

      <div className="flex-1" />

      {/* 设备状态 + 窗口控制(no-drag,可点击) */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center gap-2"
      >
        {device === null ? (
          <div className="flex items-center gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-1 text-xs text-zinc-500">
            <WifiOff className="h-3 w-3" />
            <span>未连接</span>
          </div>
        ) : (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs',
              device.type === 'adb' && 'border-blue-700/40 bg-blue-950/40 text-blue-300',
              device.type === 'fastboot' && 'border-amber-700/40 bg-amber-950/40 text-amber-300',
              device.type === 'qcom_edl' && 'border-purple-700/40 bg-purple-950/40 text-purple-300',
              !['adb', 'fastboot', 'qcom_edl'].includes(device.type) &&
                'border-zinc-800/80 bg-zinc-900/40 text-zinc-400',
            )}
          >
            <DeviceIcon type={device.type} />
            <span className="font-medium">
              {formatDeviceType(device.type)}
              {device.port ? ` · ${device.port}` : ''}
            </span>
            {device.innermodel && (
              <>
                <span className="text-zinc-700">|</span>
                <span className="text-zinc-400">
                  {device.model ?? device.innermodel}
                  {device.androidVersion ? ` · ${device.androidVersion}` : ''}
                </span>
              </>
            )}
          </div>
        )}

        {/* 窗口控制按钮 */}
        <WindowControls />
      </div>
    </header>
  );
}

function DeviceIcon({ type }: { type: string }): JSX.Element {
  switch (type) {
    case 'adb':
    case 'emulator':
      return <Smartphone className="h-3.5 w-3.5" />;
    case 'fastboot':
      return <Zap className="h-3.5 w-3.5" />;
    case 'qcom_edl':
    case 'sprd_edl':
      return <Cpu className="h-3.5 w-3.5" />;
    case 'unauthorized':
      return <CircleAlert className="h-3.5 w-3.5" />;
    case 'offline':
      return <WifiOff className="h-3.5 w-3.5" />;
    default:
      return <Smartphone className="h-3.5 w-3.5" />;
  }
}
