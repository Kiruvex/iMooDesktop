// src/routes/Backup.tsx - 备份恢复页
// 对应原 backup.bat(DCIM + 9008 + adb-dd)+ super_recovery.bat + pashtwrp.bat + pashtwrppro.bat + Xposed.bat
// 业务逻辑见 plan.md 6.5 EdlService + 6.11 BackupService

import { useEffect, useRef, useState } from 'react';
import {
  DatabaseBackup,
  HardDriveDownload,
  Smartphone,
  Cpu,
  Upload,
  Download,
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Power,
  ChevronDown,
  ChevronRight,
  Package,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { api, type AdbDdMatchResult } from '../lib/api';
import { MODELS, type ModelInfo } from '../lib/models';
import { cn } from '../lib/utils';
import { useDeviceStore } from '../stores/deviceStore';

// 备份功能项类型
interface BackupItem {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<LucideProps>;
  /** 'adb' 需要 ADB 模式设备,'edl' 需要 9008 模式(由 EdlService 内部等待),'any' 不预检 */
  mode: 'adb' | 'edl' | 'any';
  /** 是否危险操作 */
  danger?: boolean;
}

// 7 个备份功能分区(对应原 backup.bat 的菜单 + super_recovery + pashtwrp* + Xposed)
const BACKUP_ITEMS: BackupItem[] = [
  {
    id: 'dcim-backup',
    title: 'DCIM 备份',
    description: 'adb pull /storage/emulated/0/DCIM(对应 backup.bat :DCIM-backup)',
    icon: Upload,
    mode: 'adb',
  },
  {
    id: 'dcim-recover',
    title: 'DCIM 恢复',
    description: 'adb push <dir>/DCIM /storage/emulated/0/(对应 backup.bat :DCIM-recover)',
    icon: Download,
    mode: 'adb',
  },
  {
    id: 'edl-backup',
    title: '9008 备份',
    description: 'fh_loader 读取全分区 → 7z 打包(对应 backup.bat :9008-backup-run)',
    icon: HardDriveDownload,
    mode: 'edl',
  },
  {
    id: 'edl-recover',
    title: '9008 恢复',
    description: '7z 解压 → fh_loader 刷 rawprogram0.xml(对应 backup.bat :9008-recover)',
    icon: HardDriveDownload,
    mode: 'edl',
    danger: true,
  },
  {
    id: 'adbdd-backup',
    title: 'ADB-dd 备份',
    description: 'su -c dd 逐分区读取(不含 userdata,需 root)→ 7z 打包(对应 backup.bat :adb-dd-backup)',
    icon: DatabaseBackup,
    mode: 'adb',
  },
  {
    id: 'adbdd-recover',
    title: 'ADB-dd 恢复',
    description: '7z 解压 → 匹配设备分区 → dd 写入(对应 backup.bat :adb-dd-recover,危险)',
    icon: DatabaseBackup,
    mode: 'adb',
    danger: true,
  },
  {
    id: 'super-recovery',
    title: '超级恢复',
    description: '自动检测 loader + 逐个刷 rawprogram0/1/2 + patch0(对应 super_recovery.bat)',
    icon: HardDriveDownload,
    mode: 'edl',
    danger: true,
  },
  {
    id: 'flash-twrp',
    title: 'TWRP 刷入',
    description: 'EDL 模式刷入 TWRP recovery(对应 pashtwrp.bat,需先选型号)',
    icon: HardDriveDownload,
    mode: 'edl',
  },
  {
    id: 'auto-flash-twrp',
    title: '开机自刷 TWRP',
    description: '推送 recovery.img + auto_flash_recovery.sh 到 /data/adb/service.d/(对应 pashtwrppro.bat)',
    icon: Power,
    mode: 'adb',
  },
  {
    id: 'xposed-install',
    title: 'Xposed 安装',
    description: '根据 SDK 版本(SDK19/25)安装 Xposed 框架(对应 Xposed.bat)',
    icon: Package,
    mode: 'adb',
  },
];

export function Backup(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { success: boolean; message: string }>>({});
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [adbddMatch, setAdbddMatch] = useState<AdbDdMatchResult | null>(null);
  const [adbddExtractDir, setAdbddExtractDir] = useState<string | null>(null);
  const progressEndRef = useRef<HTMLDivElement | null>(null);

  // 订阅 backup:progress 事件
  useEffect(() => {
    const unsub = api.backup.onProgress((data) => {
      setProgressLines((prev) => [...prev.slice(-200), data.msg]);
    });
    return unsub;
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progressLines]);

  // 设备模式变化时清空选中状态
  useEffect(() => {
    setSelectedModel(null);
    setExpandedId(null);
    setAdbddMatch(null);
    setAdbddExtractDir(null);
  }, [device]);

  const clearProgress = (): void => setProgressLines([]);

  const handleExecute = async (item: BackupItem): Promise<void> => {
    // 9008 备份/恢复、TWRP 刷入、超级恢复 → 需要 9008 模式(EdlService 内部等待)
    // 但 flash-twrp / edl-backup 需要先选型号
    if ((item.id === 'edl-backup' || item.id === 'flash-twrp' || item.id === 'auto-flash-twrp') && !selectedModel) {
      setExpandedId(item.id);
      return;
    }

    setExecutingId(item.id);
    setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '执行中...' } }));
    clearProgress();
    try {
      let r: { success: boolean; error?: string; zipPath?: string };
      switch (item.id) {
        case 'dcim-backup': {
          const outputDir = await api.system.pickFile({ kind: 'folder' });
          if (!outputDir) {
            setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '已取消' } }));
            return;
          }
          const dir = Array.isArray(outputDir) ? outputDir[0] : outputDir;
          r = await api.backup.dcimBackup(dir);
          break;
        }
        case 'dcim-recover': {
          const inputDir = await api.system.pickFile({ kind: 'folder' });
          if (!inputDir) {
            setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '已取消' } }));
            return;
          }
          const dir = Array.isArray(inputDir) ? inputDir[0] : inputDir;
          r = await api.backup.dcimRecover(dir);
          break;
        }
        case 'edl-backup': {
          if (!selectedModel) {
            r = { success: false, error: '请先选择型号' };
            break;
          }
          const outputDir = await api.system.pickFile({ kind: 'folder' });
          if (!outputDir) {
            setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '已取消' } }));
            return;
          }
          const dir = Array.isArray(outputDir) ? outputDir[0] : outputDir;
          r = await api.backup.edlBackup({
            innermodel: selectedModel.innermodel,
            softVersion: device?.softVersion,
            outputDir: dir,
          });
          break;
        }
        case 'edl-recover': {
          const file = await api.system.pickFile({
            kind: 'open',
            filter: '备份文件|*.zip;所有文件|*.*',
          });
          if (!file) {
            setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '已取消' } }));
            return;
          }
          const zip = Array.isArray(file) ? file[0] : file;
          r = await api.backup.edlRecover(zip);
          break;
        }
        case 'adbdd-backup': {
          const outputDir = await api.system.pickFile({ kind: 'folder' });
          if (!outputDir) {
            setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '已取消' } }));
            return;
          }
          const dir = Array.isArray(outputDir) ? outputDir[0] : outputDir;
          r = await api.backup.adbddBackup(dir);
          break;
        }
        case 'adbdd-recover': {
          // 两步:prepare → 用户确认 → execute
          const file = await api.system.pickFile({
            kind: 'open',
            filter: '备份文件|*.zip;所有文件|*.*',
          });
          if (!file) {
            setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '已取消' } }));
            return;
          }
          const zip = Array.isArray(file) ? file[0] : file;
          const prep = await api.backup.adbddPrepare(zip);
          if (!prep.success || !prep.extractDir || !prep.match) {
            r = { success: false, error: prep.error ?? '准备失败' };
            break;
          }
          setAdbddMatch(prep.match);
          setAdbddExtractDir(prep.extractDir);
          setExpandedId('adbdd-recover');
          // 等待用户在 UI 中确认
          setResult((prev) => ({
            ...prev,
            [item.id]: {
              success: true,
              message: `匹配 ${prep.match!.matched.length} 个分区,跳过 ${prep.match!.skipped.length} 个,请确认后执行`,
            },
          }));
          return;
        }
        case 'super-recovery': {
          const folder = await api.system.pickFile({ kind: 'folder' });
          if (!folder) {
            setResult((prev) => ({ ...prev, [item.id]: { success: false, message: '已取消' } }));
            return;
          }
          const dir = Array.isArray(folder) ? folder[0] : folder;
          r = await api.backup.superRecovery(dir);
          break;
        }
        case 'flash-twrp': {
          if (!selectedModel) {
            r = { success: false, error: '请先选择型号' };
            break;
          }
          r = await api.backup.flashTwrp(selectedModel.innermodel);
          break;
        }
        case 'auto-flash-twrp': {
          if (!selectedModel) {
            r = { success: false, error: '请先选择型号' };
            break;
          }
          r = await api.backup.autoFlashTwrp(selectedModel.innermodel);
          break;
        }
        case 'xposed-install': {
          r = await api.backup.xposedInstall();
          break;
        }
        default:
          r = { success: false, error: '未知操作' };
      }
      setResult((prev) => ({
        ...prev,
        [item.id]: {
          success: r.success,
          message: r.success
            ? r.zipPath
              ? `操作成功,文件: ${r.zipPath}`
              : '操作成功'
            : r.error ?? '操作失败',
        },
      }));
    } catch (e) {
      setResult((prev) => ({
        ...prev,
        [item.id]: { success: false, message: (e as Error).message },
      }));
    } finally {
      setExecutingId(null);
    }
  };

  const handleAdbddConfirm = async (): Promise<void> => {
    if (!adbddExtractDir || !adbddMatch) return;
    setExecutingId('adbdd-recover');
    try {
      const r = await api.backup.adbddExecute(adbddExtractDir, adbddMatch.matched);
      setResult((prev) => ({
        ...prev,
        'adbdd-recover': {
          success: r.success,
          message: r.success ? 'ADB-dd 恢复完成' : r.error ?? '恢复失败',
        },
      }));
      if (r.success) {
        setAdbddMatch(null);
        setAdbddExtractDir(null);
      }
    } catch (e) {
      setResult((prev) => ({
        ...prev,
        'adbdd-recover': { success: false, message: (e as Error).message },
      }));
    } finally {
      setExecutingId(null);
    }
  };

  const handleAdbddCancel = (): void => {
    setAdbddMatch(null);
    setAdbddExtractDir(null);
    setResult((prev) => ({
      ...prev,
      'adbdd-recover': { success: false, message: '已取消' },
    }));
  };

  // 检查设备模式是否满足
  const isModeOk = (item: BackupItem): boolean => {
    if (item.mode === 'adb') return device?.type === 'adb';
    // edl 模式由 EdlService 内部 waitForEdl 等待,这里不预检
    return true;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <DatabaseBackup className="h-5 w-5 text-blue-500" />
          备份恢复
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          DCIM / 9008 / ADB-dd 备份恢复 + 超级恢复 + TWRP 刷入 + Xposed 安装
        </p>
      </div>

      {/* 进度日志(可折叠) */}
      {progressLines.length > 0 && (
        <section>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">实时日志</span>
              <button
                onClick={clearProgress}
                className="rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
              >
                清空
              </button>
            </div>
            <div className="max-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed text-zinc-400">
              {progressLines.map((line, i) => (
                <div key={i} className="truncate">
                  <span className="text-zinc-600">[{new Date().toLocaleTimeString()}]</span> {line}
                </div>
              ))}
              <div ref={progressEndRef} />
            </div>
          </div>
        </section>
      )}

      {/* 功能项网格 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {BACKUP_ITEMS.map((item) => {
          const Icon = item.icon;
          const expanded = expandedId === item.id;
          const needsModel = item.id === 'edl-backup' || item.id === 'flash-twrp' || item.id === 'auto-flash-twrp';
          const isExecuting = executingId === item.id;
          const itemResult = result[item.id];
          const modeOk = isModeOk(item);
          return (
            <div
              key={item.id}
              className={cn(
                'rounded-lg border p-3 transition-all',
                expanded
                  ? 'border-blue-600 bg-blue-950/20'
                  : 'border-zinc-800/80 bg-zinc-900/30',
                item.danger && !expanded && 'border-red-900/40 bg-red-950/10',
              )}
            >
              <button
                onClick={() => {
                  if (needsModel && !selectedModel) {
                    setExpandedId(expanded ? null : item.id);
                    return;
                  }
                  if (item.id === 'adbdd-recover' && adbddMatch) {
                    setExpandedId(expanded ? null : item.id);
                    return;
                  }
                  void handleExecute(item);
                }}
                disabled={isExecuting || !modeOk}
                className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed"
              >
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    item.danger
                      ? 'bg-red-600/15 text-red-400'
                      : 'bg-blue-600/15 text-blue-400',
                  )}
                >
                  {isExecuting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'text-sm font-medium',
                      item.danger ? 'text-red-200' : 'text-zinc-100',
                    )}
                  >
                    {item.title}
                  </div>
                  <div className="truncate text-xs text-zinc-500">{item.description}</div>
                </div>
                {needsModel && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px]',
                      selectedModel
                        ? 'bg-blue-500/15 text-blue-400'
                        : 'bg-zinc-800 text-zinc-500',
                    )}
                  >
                    {selectedModel ? selectedModel.model : '选型号'}
                  </span>
                )}
                {needsModel && (
                  <span className="shrink-0">
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                    )}
                  </span>
                )}
              </button>

              {/* 结果反馈 */}
              {itemResult && (
                <div
                  className={cn(
                    'mt-2 flex items-center gap-1.5 rounded px-2 py-1 text-[10px]',
                    itemResult.success
                      ? 'text-green-400'
                      : itemResult.message === '已取消'
                        ? 'text-zinc-500'
                        : 'text-red-400',
                  )}
                >
                  {itemResult.success ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : itemResult.message === '已取消' ? null : (
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">{itemResult.message}</span>
                </div>
              )}

              {/* 型号选择面板 */}
              {expanded && needsModel && (
                <div className="mt-3 border-t border-zinc-800/60 pt-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Smartphone className="h-3 w-3" />
                    选择型号(对应原 pashtwrp.json / backup_9008.json)
                  </div>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {MODELS.map((m) => (
                      <button
                        key={m.innermodel}
                        onClick={() => {
                          setSelectedModel(m);
                          setExpandedId(null);
                        }}
                        className={cn(
                          'rounded border px-2 py-1 text-left text-[10px] transition-colors',
                          selectedModel?.innermodel === m.innermodel
                            ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                            : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-blue-600/40 hover:bg-zinc-900/50',
                        )}
                      >
                        <div className="font-medium">{m.model}</div>
                        <div className="text-[9px] text-zinc-600">{m.innermodel}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ADB-dd 恢复确认面板 */}
              {expanded && item.id === 'adbdd-recover' && adbddMatch && (
                <div className="mt-3 border-t border-zinc-800/60 pt-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    确认恢复以下分区?
                  </div>
                  <div className="mb-2 text-[10px] text-zinc-500">
                    匹配 {adbddMatch.matched.length} 个,跳过 {adbddMatch.skipped.length} 个
                  </div>
                  {adbddMatch.matched.length > 0 && (
                    <div className="mb-2 max-h-32 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/40 p-2">
                      <div className="mb-1 text-[10px] text-zinc-500">将恢复:</div>
                      <div className="flex flex-wrap gap-1">
                        {adbddMatch.matched.map((p) => (
                          <span key={p} className="rounded bg-amber-900/30 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {adbddMatch.skipped.length > 0 && (
                    <div className="mb-2 max-h-24 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/40 p-2">
                      <div className="mb-1 text-[10px] text-zinc-500">跳过(设备无此分区):</div>
                      <div className="flex flex-wrap gap-1">
                        {adbddMatch.skipped.map((p) => (
                          <span key={p} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAdbddConfirm}
                      disabled={isExecuting}
                      className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      确认恢复(危险)
                    </button>
                    <button
                      onClick={handleAdbddCancel}
                      disabled={isExecuting}
                      className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 设备模式提示 */}
      {(!device || device.type !== 'adb') && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <div>当前无 ADB 模式设备。DCIM / ADB-dd / 开机自刷 TWRP / Xposed 安装需要 ADB 模式。</div>
            <div className="mt-1 text-amber-400/80">
              9008 备份/恢复 / 超级恢复 / TWRP 刷入 需要设备进入 9008 EDL 模式,功能执行时会自动等待 9008 设备。
            </div>
          </div>
        </div>
      )}

      {/* 危险提示 */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <Cpu className="h-3.5 w-3.5" />
          风险提示
        </h2>
        <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-4 text-xs text-red-300/90">
          <p>
            <FolderOpen className="mr-1 inline h-3 w-3" />
            <strong>9008 恢复 / ADB-dd 恢复 / 超级恢复</strong>是高风险操作,可能使设备变砖。
            请确保备份来源可靠,并仔细核对匹配分区后再确认执行。
          </p>
          <p className="mt-2">
            <Power className="mr-1 inline h-3 w-3" />
            <strong>开机自刷 TWRP</strong>会在设备每次开机时尝试刷入 recovery,
            若镜像与设备不匹配会导致 bootloop,操作前请确认型号选择正确。
          </p>
        </div>
      </section>
    </div>
  );
}
