// src/routes/EdlPartitions.tsx - EDL 分区管理(阶段二增强版)
//
// 基于 QSaharaServer + fh_loader(复用现有 EdlService)
// 分区表来源:resources/edl/allxml/<innermodel>.xml(静态,不连设备可用)
// 功能:选型号看分区表 + 备份/恢复/擦除单分区 + 校验 + 重启设备 + 操作历史
//
// 安全防护(阶段二强化):
//   - 关键分区擦除需输入分区名确认(防误操作)
//   - 恢复前强制备份选项(默认开启)
//   - 恢复后读回校验选项(逐字节比对)
//   - 文件大小校验(镜像不能超过分区)
//   - 操作历史记录(会话级,可追溯)
//   - 设备非 9008 时禁用写操作

import { useCallback, useEffect, useState } from 'react';
import {
  HardDrive,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  Upload,
  Trash2,
  Power,
  Search,
  ShieldAlert,
  Cpu,
  History,
  X,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  api,
  type EdlPartition,
  type EdlModel,
  type EdlOperationRecord,
} from '../lib/api';
import { cn, formatBytes } from '../lib/utils';

// 关键分区黑名单(擦除需输入名称确认)
const CRITICAL_PARTITIONS = [
  'boot', 'system', 'modem', 'recovery', 'xbl', 'sbl', 'aboot',
  'tz', 'rpm', 'hyp', 'modemst1', 'modemst2', 'fsg', 'fsc', 'ssd',
  'DDR', 'pad',
];

export function EdlPartitions(): JSX.Element {
  const [models, setModels] = useState<EdlModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [partitions, setPartitions] = useState<EdlPartition[]>([]);
  const [loadingPartitions, setLoadingPartitions] = useState(false);
  const [v3, setV3] = useState(false);

  // 设备状态
  const [inEdl, setInEdl] = useState(false);
  const [edlPort, setEdlPort] = useState<string | undefined>();

  // 搜索
  const [search, setSearch] = useState('');

  // 操作状态
  const [executing, setExecuting] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // 擦除确认(关键分区需输入名称)
  const [eraseTarget, setEraseTarget] = useState<EdlPartition | null>(null);
  const [eraseConfirmInput, setEraseConfirmInput] = useState('');

  // 恢复弹窗(含备份/校验选项)
  const [restoreTarget, setRestoreTarget] = useState<EdlPartition | null>(null);
  const [restoreBackupBefore, setRestoreBackupBefore] = useState(true);
  const [restoreVerifyAfter, setRestoreVerifyAfter] = useState(false);
  const [restoreSelectedFile, setRestoreSelectedFile] = useState<string | null>(null);

  // 操作历史
  const [history, setHistory] = useState<EdlOperationRecord[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // 加载型号列表
  const loadModels = useCallback(async (): Promise<void> => {
    const r = await api.edlPartition.listModels();
    if (r.success && r.models.length > 0) {
      setModels(r.models);
      if (!selectedModel) {
        setSelectedModel(r.models[0].innermodel);
      }
    }
  }, [selectedModel]);

  // 加载分区表
  const loadPartitions = useCallback(async (model: string): Promise<void> => {
    if (!model) {
      setPartitions([]);
      return;
    }
    setLoadingPartitions(true);
    try {
      const r = await api.edlPartition.listPartitions(model);
      if (r.success) {
        setPartitions(r.partitions);
      } else {
        setPartitions([]);
        setResult({ success: false, message: r.error ?? '加载分区表失败' });
      }
    } finally {
      setLoadingPartitions(false);
    }
  }, []);

  // 检查设备状态
  const checkDevice = useCallback(async (): Promise<void> => {
    const r = await api.edlPartition.checkEdlDevice();
    setInEdl(r.inEdl);
    setEdlPort(r.port);
  }, []);

  // 刷新操作历史
  const refreshHistory = useCallback(async (): Promise<void> => {
    const r = await api.edlPartition.getHistory();
    if (r.success) setHistory(r.history);
  }, []);

  useEffect(() => {
    void loadModels();
    void checkDevice();
    void refreshHistory();
    const timer = window.setInterval(checkDevice, 3000);
    return () => window.clearInterval(timer);
  }, [loadModels, checkDevice, refreshHistory]);

  useEffect(() => {
    if (selectedModel) void loadPartitions(selectedModel);
  }, [selectedModel, loadPartitions]);

  // 订阅进度
  useEffect(() => {
    const unsub = api.edlPartition.onProgress((data) => {
      setProgressMsg(data.msg);
    });
    return unsub;
  }, []);

  // 操作:备份单分区
  const handleBackup = async (p: EdlPartition): Promise<void> => {
    if (!inEdl) {
      setResult({ success: false, message: '需要设备处于 9008 (EDL) 模式' });
      return;
    }
    const picked = await api.system.pickFile({ kind: 'folder' });
    if (!picked || Array.isArray(picked)) return;
    const outputFile = `${picked.replace(/[\\/]$/, '')}/${p.label}.img`;

    setExecuting(true);
    setResult(null);
    setProgressMsg('开始备份...');
    try {
      const r = await api.edlPartition.backupPartition({
        innermodel: selectedModel,
        label: p.label,
        outputFile,
        v3,
      });
      setResult({
        success: r.success,
        message: r.success ? `备份成功: ${outputFile}` : `备份失败: ${r.error}`,
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
      setProgressMsg(null);
      void refreshHistory();
    }
  };

  // 操作:选择恢复文件
  const handleSelectRestoreFile = async (): Promise<void> => {
    if (!restoreTarget) return;
    const picked = await api.system.pickFile({
      kind: 'open',
      filter: `分区镜像|*.img;所有文件|*.*`,
    });
    if (!picked) return;
    const file = Array.isArray(picked) ? picked[0] : picked;
    setRestoreSelectedFile(file);
  };

  // 操作:执行恢复
  const handleRestore = async (): Promise<void> => {
    if (!restoreTarget || !restoreSelectedFile) return;
    let backupOutputDir: string | undefined;
    if (restoreBackupBefore) {
      const picked = await api.system.pickFile({ kind: 'folder' });
      if (!picked || Array.isArray(picked)) return;
      backupOutputDir = picked.replace(/[\\/]$/, '');
    }

    setExecuting(true);
    setResult(null);
    setProgressMsg('开始恢复...');
    try {
      const r = await api.edlPartition.restorePartition({
        innermodel: selectedModel,
        label: restoreTarget.label,
        inputFile: restoreSelectedFile,
        v3,
        backupBeforeRestore: restoreBackupBefore,
        backupOutputDir,
        verifyAfterRestore: restoreVerifyAfter,
      });
      let message = r.success ? `恢复成功: ${restoreTarget.label}` : `恢复失败: ${r.error}`;
      if (r.backupPath) {
        message += `(原数据已备份: ${r.backupPath})`;
      }
      if (r.verified) {
        message += r.verified.matched
          ? ' [校验通过]'
          : ` [校验未通过: ${r.verified.error ?? '数据不一致'}]`;
      }
      setResult({ success: r.success, message });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
      setProgressMsg(null);
      setRestoreTarget(null);
      setRestoreSelectedFile(null);
      void refreshHistory();
    }
  };

  // 操作:执行擦除
  const handleErase = async (): Promise<void> => {
    if (!eraseTarget) return;
    const isCritical = CRITICAL_PARTITIONS.includes(eraseTarget.label);
    // 关键分区必须输入正确名称
    if (isCritical && eraseConfirmInput !== eraseTarget.label) {
      return;
    }
    setExecuting(true);
    setResult(null);
    setProgressMsg('开始擦除...');
    try {
      const r = await api.edlPartition.erasePartition({
        innermodel: selectedModel,
        label: eraseTarget.label,
        v3,
      });
      setResult({
        success: r.success,
        message: r.success
          ? `擦除成功: ${eraseTarget.label}`
          : `擦除失败: ${r.error}`,
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
      setProgressMsg(null);
      setEraseTarget(null);
      setEraseConfirmInput('');
      void refreshHistory();
    }
  };

  // 操作:重启设备
  const handleReset = async (): Promise<void> => {
    if (!inEdl) {
      setResult({ success: false, message: '需要设备处于 9008 (EDL) 模式' });
      return;
    }
    setExecuting(true);
    setResult(null);
    setProgressMsg('正在重启...');
    try {
      const r = await api.edlPartition.resetDevice({ innermodel: selectedModel, v3 });
      setResult({
        success: r.success,
        message: r.success ? '重启指令已发送,设备将重启回系统' : `重启失败: ${r.error}`,
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
      setProgressMsg(null);
      void refreshHistory();
    }
  };

  const filtered = partitions.filter((p) =>
    p.label.toLowerCase().includes(search.toLowerCase()),
  );
  const totalSize = partitions.reduce((sum, p) => sum + p.sizeBytes, 0);

  const isCritical = (label: string): boolean => CRITICAL_PARTITIONS.includes(label);

  return (
    <div className="space-y-6">
      {/* 标题 + 设备状态 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <HardDrive className="h-5 w-5 text-blue-500" />
            EDL 分区管理
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            9008 模式下查看/备份/恢复/擦除/校验分区(基于 fh_loader)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
              inEdl
                ? 'border-green-700/50 bg-green-950/20 text-green-300'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-500',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', inEdl ? 'bg-green-500' : 'bg-zinc-600')} />
            {inEdl ? `9008 已连接${edlPort ? ` (${edlPort})` : ''}` : '未检测到 9008'}
          </span>
          <button
            onClick={checkDevice}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <RefreshCw className="h-3 w-3" /> 刷新
          </button>
        </div>
      </div>

      {/* 警告条 */}
      <div className="flex items-center gap-2 rounded-md border border-amber-700/40 bg-amber-900/10 p-3 text-xs text-amber-300">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          恢复/擦除操作有变砖风险。恢复默认会先备份原分区,关键分区擦除需输入分区名确认。请确保电量充足。
        </span>
      </div>

      {/* 型号 & 协议选择 */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <Cpu className="h-3.5 w-3.5" />
          设备型号
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-sm text-zinc-200 focus:border-blue-600 focus:outline-none"
            >
              {models.map((m) => (
                <option key={m.innermodel} value={m.innermodel}>
                  {m.innermodel} ({m.partitionCount} 个分区)
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={v3}
                onChange={(e) => setV3(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              V3 协议(Z6+/Z7+ 勾选,其余不勾)
            </label>
            <button
              onClick={() => selectedModel && void loadPartitions(selectedModel)}
              disabled={loadingPartitions}
              className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loadingPartitions && 'animate-spin')} />
              刷新分区表
            </button>
          </div>
        </div>
      </section>

      {/* 操作结果 */}
      {result && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 text-sm',
            result.success
              ? 'border-green-800/50 bg-green-950/20 text-green-300'
              : 'border-red-800/50 bg-red-950/20 text-red-300',
          )}
        >
          {result.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="break-all">{result.message}</span>
        </div>
      )}

      {/* 进度提示 */}
      {executing && progressMsg && (
        <div className="flex items-center gap-2 rounded-md border border-blue-800/50 bg-blue-950/20 p-3 text-sm text-blue-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="break-all">{progressMsg}</span>
        </div>
      )}

      {/* 分区列表 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索分区名..."
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <span className="text-xs text-zinc-500">
            共 {filtered.length} 个分区,总大小 {formatBytes(totalSize)}
          </span>
          <button
            onClick={handleReset}
            disabled={!inEdl || executing}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
          >
            <Power className="h-3.5 w-3.5" /> 重启设备
          </button>
        </div>

        {loadingPartitions ? (
          <div className="flex items-center justify-center gap-2 py-10 text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">加载分区表...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-500">
            <HardDrive className="h-8 w-8 text-zinc-600" />
            <span className="text-sm">无分区数据</span>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-520px)] min-h-[280px] overflow-y-auto rounded-lg border border-zinc-800">
            <div className="sticky top-0 z-10 grid grid-cols-[1fr_100px_120px_100px_180px] gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur">
              <span>分区名</span>
              <span className="text-right">大小</span>
              <span>起始扇区</span>
              <span className="text-right">扇区数</span>
              <span className="text-center">操作</span>
            </div>
            {filtered.map((p) => {
              const critical = isCritical(p.label);
              return (
                <div
                  key={p.label}
                  className="grid grid-cols-[1fr_100px_120px_100px_180px] items-center gap-2 border-b border-zinc-800/60 px-3 py-2 text-xs last:border-0 hover:bg-zinc-900/40"
                >
                  <span className="flex items-center gap-2">
                    <HardDrive
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        critical ? 'text-amber-400' : 'text-zinc-500',
                      )}
                    />
                    <span className="font-mono text-zinc-300">{p.label}</span>
                    {critical && (
                      <span className="rounded bg-amber-900/40 px-1 py-0.5 text-xs text-amber-400">
                        关键
                      </span>
                    )}
                  </span>
                  <span className="text-right tabular-nums text-zinc-400">
                    {formatBytes(p.sizeBytes)}
                  </span>
                  <span className="font-mono text-zinc-500">{p.startSector}</span>
                  <span className="text-right font-mono tabular-nums text-zinc-500">
                    {p.numSectors}
                  </span>
                  <span className="flex items-center justify-center gap-1">
                    <ActionButton
                      icon={Download}
                      title="备份"
                      disabled={!inEdl || executing}
                      onClick={() => void handleBackup(p)}
                      variant="default"
                    />
                    <ActionButton
                      icon={Upload}
                      title="恢复"
                      disabled={!inEdl || executing}
                      onClick={() => {
                        setRestoreTarget(p);
                        setRestoreSelectedFile(null);
                        setRestoreBackupBefore(true);
                        setRestoreVerifyAfter(false);
                      }}
                      variant="default"
                    />
                    <ActionButton
                      icon={Trash2}
                      title={critical ? '关键分区,擦除需输入名称确认' : '擦除'}
                      disabled={!inEdl || executing}
                      onClick={() => {
                        setEraseTarget(p);
                        setEraseConfirmInput('');
                      }}
                      variant="danger"
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 操作历史(可折叠) */}
      <section>
        <button
          onClick={() => setHistoryExpanded(!historyExpanded)}
          className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:bg-zinc-900/50"
        >
          {historyExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <History className="h-3.5 w-3.5" />
          操作历史({history.length})
          {history.length > 0 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                void api.edlPartition.clearHistory().then(() => void refreshHistory());
              }}
              className="ml-auto rounded px-2 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
            >
              清空
            </span>
          )}
        </button>
        {historyExpanded && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-zinc-800">
            {history.length === 0 ? (
              <div className="py-6 text-center text-xs text-zinc-600">暂无操作记录</div>
            ) : (
              history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 border-b border-zinc-800/60 px-3 py-2 text-xs last:border-0"
                >
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 font-medium',
                      h.type === 'backup' && 'bg-blue-900/40 text-blue-300',
                      h.type === 'restore' && 'bg-purple-900/40 text-purple-300',
                      h.type === 'erase' && 'bg-red-900/40 text-red-300',
                      h.type === 'verify' && 'bg-cyan-900/40 text-cyan-300',
                      h.type === 'reset' && 'bg-zinc-700/40 text-zinc-300',
                    )}
                  >
                    {h.type}
                  </span>
                  <span className="shrink-0 font-mono text-zinc-400">{h.label}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{h.message}</span>
                  <span className="shrink-0 text-zinc-600">
                    {new Date(h.timestamp).toLocaleTimeString()}
                  </span>
                  {h.success ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* 擦除确认弹窗 */}
      {eraseTarget && (
        <ModalDialog
          title={`擦除分区: ${eraseTarget.label}`}
          onClose={() => {
            setEraseTarget(null);
            setEraseConfirmInput('');
          }}
        >
          <div className="space-y-3">
            <div className="rounded-md border border-red-800/50 bg-red-950/20 p-3 text-sm text-red-300">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                警告:此操作不可逆
              </div>
              <div className="mt-2 space-y-1 text-xs text-red-300/80">
                <div>分区名: <span className="font-mono font-bold">{eraseTarget.label}</span></div>
                <div>大小: {formatBytes(eraseTarget.sizeBytes)}</div>
                <div>起始扇区: {eraseTarget.startSector}</div>
                <div>擦除方式: 全零数据覆盖</div>
                {isCritical(eraseTarget.label) && (
                  <div className="mt-2 rounded bg-red-900/30 p-2 text-red-400">
                    这是关键分区,擦除后设备可能无法启动!如需继续,请在下方输入分区名 "{eraseTarget.label}" 确认。
                  </div>
                )}
              </div>
            </div>
            {isCritical(eraseTarget.label) ? (
              <div>
                <label className="mb-1 block text-sm text-zinc-400">
                  输入分区名确认(区分大小写):
                </label>
                <input
                  autoFocus
                  value={eraseConfirmInput}
                  onChange={(e) => setEraseConfirmInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && eraseConfirmInput === eraseTarget.label) {
                      void handleErase();
                    }
                    if (e.key === 'Escape') {
                      setEraseTarget(null);
                      setEraseConfirmInput('');
                    }
                  }}
                  placeholder={eraseTarget.label}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 font-mono text-sm text-zinc-200 focus:border-red-600 focus:outline-none"
                />
              </div>
            ) : (
              <p className="text-sm text-zinc-400">点击下方按钮确认擦除。</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setEraseTarget(null);
                  setEraseConfirmInput('');
                }}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              >
                取消
              </button>
              <button
                onClick={() => void handleErase()}
                disabled={
                  executing ||
                  (isCritical(eraseTarget.label) && eraseConfirmInput !== eraseTarget.label)
                }
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {executing ? '擦除中...' : '擦除'}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}

      {/* 恢复弹窗(含备份/校验选项) */}
      {restoreTarget && (
        <ModalDialog
          title={`恢复分区: ${restoreTarget.label}`}
          wide
          onClose={() => {
            setRestoreTarget(null);
            setRestoreSelectedFile(null);
          }}
        >
          <div className="space-y-3">
            {/* 分区信息 */}
            <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-3 text-xs">
              <div className="mb-2 font-medium text-zinc-300">目标分区信息</div>
              <div className="grid grid-cols-2 gap-2 text-zinc-500">
                <div>名称: <span className="font-mono text-zinc-300">{restoreTarget.label}</span></div>
                <div>大小: <span className="text-zinc-300">{formatBytes(restoreTarget.sizeBytes)}</span></div>
                <div>起始扇区: <span className="font-mono text-zinc-300">{restoreTarget.startSector}</span></div>
                <div>扇区数: <span className="font-mono text-zinc-300">{restoreTarget.numSectors}</span></div>
              </div>
            </div>

            {/* 文件选择 */}
            <div>
              <label className="mb-1 block text-sm text-zinc-400">镜像文件</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleSelectRestoreFile()}
                  disabled={executing}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" /> 选择文件
                </button>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                  {restoreSelectedFile ?? '未选择'}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                镜像大小不能超过分区大小({formatBytes(restoreTarget.sizeBytes)}),后端会校验。
              </p>
            </div>

            {/* 安全选项 */}
            <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
                安全选项
              </div>
              <label className="flex items-start gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={restoreBackupBefore}
                  onChange={(e) => setRestoreBackupBefore(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span>
                  恢复前先备份当前分区(推荐)
                  <span className="block text-xs text-zinc-600">恢复失败时可用备份还原,需选择备份目录</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={restoreVerifyAfter}
                  onChange={(e) => setRestoreVerifyAfter(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span>
                  恢复后读回校验(耗时)
                  <span className="block text-xs text-zinc-600">逐字节比对读回数据与镜像,确保写入正确</span>
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setRestoreTarget(null);
                  setRestoreSelectedFile(null);
                }}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              >
                取消
              </button>
              <button
                onClick={() => void handleRestore()}
                disabled={executing || !restoreSelectedFile}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {executing ? '恢复中...' : '开始恢复'}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}

// ========== 子组件 ==========

function ActionButton({
  icon: Icon,
  title,
  disabled,
  onClick,
  variant = 'default',
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  variant?: 'default' | 'danger';
}): JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30',
        variant === 'danger'
          ? 'text-red-400 hover:bg-red-950/40'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-blue-300',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function ModalDialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={cn(
          'max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-2xl',
          wide ? 'w-[560px]' : 'w-[420px]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">{title}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
