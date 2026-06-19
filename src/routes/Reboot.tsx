// src/routes/Reboot.tsx - 高级重启页(9 种模式)
// 对应原 rebootpro.bat + rebootpro.json
// 逻辑保真:9 种模式的 value 与原 JSON 一致

import { useState } from 'react';
import {
  Power,
  Cpu,
  RefreshCw,
  HardDriveDownload,
  ToggleRight,
  Trash2,
  RotateCw,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { api, type RebootMode } from '../lib/api';
import { MODELS, FASTBOOTD_MODELS, type ModelInfo } from '../lib/models';
import { cn } from '../lib/utils';
import { useDeviceStore } from '../stores/deviceStore';

interface RebootItem {
  value: string;
  mode: RebootMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  needsModel?: boolean;
  /** Fastboot 模式下需要选型号(ADB 模式不需要) */
  needsModelForFastboot?: boolean;
  fastbootdOnly?: boolean;
}

const REBOOT_ITEMS: RebootItem[] = [
  {
    value: '1',
    mode: 'system',
    label: '重启至系统',
    description: '正常重启设备',
    icon: Power,
  },
  {
    value: '2',
    mode: 'bootloader',
    label: '重启至 Bootloader/Fastboot',
    description: '进入 Fastboot 模式',
    icon: Cpu,
  },
  {
    value: '3',
    mode: 'recovery',
    label: '重启至 Recovery',
    description: '进入 Recovery 模式',
    icon: RefreshCw,
    needsModelForFastboot: true,
  },
  {
    value: '4',
    mode: 'edl',
    label: '重启至 9008 (EDL)',
    description: '进入 Qualcomm 紧急下载模式',
    icon: Cpu,
    danger: true,
    needsModelForFastboot: true,
  },
  {
    value: '5',
    mode: 'twrp-temp',
    label: '临时启动 TWRP',
    description: '不刷入,仅临时启动 TWRP Recovery',
    icon: HardDriveDownload,
    needsModel: true,
  },
  {
    value: '6',
    mode: 'qmmi',
    label: 'misc 进入 QMMI',
    description: '写 misc 分区(ffbm-02),进入 QMMI 工厂模式',
    icon: ToggleRight,
    needsModel: true,
  },
  {
    value: '7',
    mode: 'ffbm',
    label: 'misc 进入 FFBM',
    description: '写 misc 分区(ffbm-01),进入 Fast Factory Boot Mode',
    icon: ToggleRight,
    needsModel: true,
  },
  {
    value: '8',
    mode: 'wipe-data',
    label: 'misc 进入 Recovery 并清除 data',
    description: '写 misc 分区(boot-recovery),重启后恢复出厂设置',
    icon: Trash2,
    danger: true,
    needsModel: true,
  },
  {
    value: '9',
    mode: 'fastbootd',
    label: 'misc 进入 fastbootd',
    description: '写 misc 分区(boot-fastbootd),仅 Z10/Z11',
    icon: ToggleRight,
    needsModel: true,
    fastbootdOnly: true,
  },
];

export function Reboot(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [selected, setSelected] = useState<RebootItem | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleClick = (item: RebootItem): void => {
    setSelected(item);
    setResult(null);
    setModel(null);
    // 需要型号,或 Fastboot 模式下需要型号 → 弹出型号选择
    const needModel =
      item.needsModel || (item.needsModelForFastboot && device?.type === 'fastboot');
    if (!needModel) {
      void execute(item);
    }
  };

  const execute = async (item: RebootItem, selectedModel?: ModelInfo): Promise<void> => {
    setExecuting(true);
    setResult(null);
    try {
      const opts: { mode: RebootMode; innermodel?: string; platform?: 'otherpash' | 'v3pash' | 'z10' } = {
        mode: item.mode,
      };
      if (item.needsModel && selectedModel) {
        opts.innermodel = selectedModel.innermodel;
        opts.platform = selectedModel.platform;
      }
      // Fastboot 模式下的 recovery/edl 也需要 innermodel
      if (item.needsModelForFastboot && selectedModel) {
        opts.innermodel = selectedModel.innermodel;
      }
      const res = await api.reboot.execute(opts);
      if (res.success) {
        setResult({ success: true, message: '指令已发送' });
      } else {
        setResult({ success: false, message: res.error ?? '未知错误' });
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
    }
  };

  const handleConfirmModel = (): void => {
    if (!selected || !model) return;
    void execute(selected, model);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <RotateCw className="h-5 w-5 text-blue-500" />
          高级重启
        </h1>
        <p className="mt-1 text-sm text-zinc-500">选择重启模式。危险操作会高亮提示。</p>
      </div>

      {/* 重启模式列表 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {REBOOT_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = selected?.value === item.value;
          return (
            <button
              key={item.value}
              onClick={() => handleClick(item)}
              disabled={executing}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-left transition-all',
                isActive
                  ? 'border-blue-600 bg-blue-950/30'
                  : 'border-zinc-800/80 bg-zinc-900/30 hover:border-blue-600/60 hover:bg-blue-950/20',
                item.danger && !isActive && 'border-red-900/40 bg-red-950/10 hover:border-red-700/60 hover:bg-red-950/20',
                item.danger && isActive && 'border-red-600 bg-red-950/30',
                executing && 'cursor-not-allowed opacity-50',
              )}
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  item.danger
                    ? 'bg-red-600/15 text-red-400'
                    : 'bg-blue-600/15 text-blue-400',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'text-sm font-medium',
                    item.danger ? 'text-red-200' : 'text-zinc-100',
                  )}
                >
                  {item.label}
                </div>
                <div className="truncate text-xs text-zinc-500">{item.description}</div>
              </div>
              {item.needsModel && (
                <ChevronRight
                  className={cn(
                    'h-4 w-4 shrink-0 transition-transform',
                    isActive && 'rotate-90',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 型号选择面板(需要型号的模式,或 Fastboot 下需要型号) */}
      {selected && (selected.needsModel || (selected.needsModelForFastboot && device?.type === 'fastboot')) && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            选择型号
            <span className="text-xs font-normal text-zinc-500">
              ({selected.fastbootdOnly ? '仅 Z10/Z11 支持' : '全部型号'})
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
            {(selected.fastbootdOnly ? FASTBOOTD_MODELS : MODELS).map((m) => (
              <button
                key={m.innermodel}
                onClick={() => setModel(m)}
                disabled={executing}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-xs transition-colors',
                  model?.innermodel === m.innermodel
                    ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                    : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-blue-600/40 hover:bg-zinc-900/50',
                )}
              >
                <div className="font-medium">{m.model}</div>
                <div className="text-[10px] text-zinc-500">{m.innermodel}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleConfirmModel}
              disabled={!model || executing}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
                selected.danger
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700',
                (!model || executing) && 'cursor-not-allowed opacity-50',
              )}
            >
              {executing ? '执行中...' : `确认${selected.danger ? '(危险)' : '执行'}`}
            </button>
            {model && (
              <span className="text-xs text-zinc-500">
                已选:{model.model} ({model.innermodel}) · {model.platform}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 执行结果 */}
      {result && (
        <div
          className={cn(
            'rounded-lg border p-4 text-sm',
            result.success
              ? 'border-green-800/50 bg-green-950/20 text-green-300'
              : 'border-red-800/50 bg-red-950/20 text-red-300',
          )}
        >
          <div className="flex items-center gap-2">
            {result.success ? <Power className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="font-medium">{result.success ? '成功' : '失败'}</span>
          </div>
          <p className="mt-1 text-xs opacity-80">{result.message}</p>
        </div>
      )}
    </div>
  );
}
