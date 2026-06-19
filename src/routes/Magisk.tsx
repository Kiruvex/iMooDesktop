// src/routes/Magisk.tsx - Magisk 模块管理页
// 对应原 magisk.json:模块列表/安装/卸载/启用禁用/刷新
// 对应原 userinstmodule/instmodule/userunmodule/unmodule/magisklist 系列 .bat
// 业务逻辑见 plan.md 6.9 MagiskService

import { useCallback, useEffect, useState } from 'react';
import {
  Boxes,
  Upload,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  Power,
  Ban,
  ChevronDown,
  ChevronRight,
  Package,
  Store,
  Search,
  Download,
  ExternalLink,
} from 'lucide-react';
import {
  api,
  type InstallMethod,
  type UninstallMethod,
  type MagiskModule,
  type StoreModule,
} from '../lib/api';
import { cn } from '../lib/utils';
import { useDeviceStore } from '../stores/deviceStore';

// 安装方式选项(对应原 instmodule.bat 的 magisk / shinst / peremptory)
const INSTALL_METHODS: { value: InstallMethod; label: string; description: string }[] = [
  { value: 'magisk', label: 'Magisk 安装', description: '调用 magisk --install-module(官方)' },
  { value: 'shinst', label: '脚本安装', description: '调用 module_installer.sh(Magisk util_functions)' },
  { value: 'peremptory', label: '强制安装', description: '调用 magisk_force_install.sh(强制解压,禁 exit/abort)' },
];

// 卸载方式选项(对应原 unmodule.bat 的 mark / direct / script)
const UNINSTALL_METHODS: { value: UninstallMethod; label: string; description: string }[] = [
  { value: 'mark', label: '标记卸载', description: 'touch remove,重启后清除' },
  { value: 'direct', label: '直接卸载', description: 'touch disable + sleep 1 + rm -rf' },
  { value: 'script', label: '脚本卸载', description: '执行 uninstall.sh + rm -rf' },
];

export function Magisk(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [modules, setModules] = useState<MagiskModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [installMethod, setInstallMethod] = useState<InstallMethod>('magisk');
  const [uninstallMethod, setUninstallMethod] = useState<UninstallMethod>('mark');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    type: 'install' | 'uninstall' | 'enable' | 'disable';
    moduleId?: string;
    moduleName?: string;
  } | null>(null);

  const loadModules = useCallback(async (): Promise<void> => {
    if (!device || device.type !== 'adb') {
      setModules([]);
      return;
    }
    setLoading(true);
    try {
      const r = await api.magisk.list();
      if (r.success && r.modules) {
        setModules(r.modules);
      } else {
        setModules([]);
        if (r.error) {
          setResult({ success: false, message: r.error });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [device]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const handleInstall = async (): Promise<void> => {
    const files = await api.system.pickFile({
      kind: 'open',
      filter: 'Magisk 模块|*.zip;所有文件|*.*',
      multi: false,
    });
    if (!files) return;
    const zip = Array.isArray(files) ? files[0] : files;
    setPendingAction({ type: 'install' });
    setExecuting(true);
    setResult(null);
    try {
      const r = await api.magisk.install(zip, installMethod);
      setResult({
        success: r.success,
        message: r.success
          ? `模块安装成功(${installMethod}): ${zip}`
          : `安装失败: ${r.error ?? '未知错误'}`,
      });
      if (r.success) {
        await loadModules();
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
      setPendingAction(null);
    }
  };

  const handleUninstall = async (mod: MagiskModule): Promise<void> => {
    if (!window.confirm(`确认卸载模块「${mod.name || mod.id}」(方式: ${uninstallMethod})?`)) {
      return;
    }
    setPendingAction({ type: 'uninstall', moduleId: mod.id, moduleName: mod.name });
    setExecuting(true);
    setResult(null);
    try {
      const r = await api.magisk.uninstall(mod.id, uninstallMethod);
      setResult({
        success: r.success,
        message: r.success
          ? `模块已卸载(${uninstallMethod}): ${mod.name || mod.id}`
          : `卸载失败: ${r.error ?? '未知错误'}`,
      });
      if (r.success) {
        await loadModules();
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
      setPendingAction(null);
    }
  };

  const handleToggle = async (mod: MagiskModule, enable: boolean): Promise<void> => {
    setPendingAction({
      type: enable ? 'enable' : 'disable',
      moduleId: mod.id,
      moduleName: mod.name,
    });
    setExecuting(true);
    setResult(null);
    try {
      const r = enable
        ? await api.magisk.enable(mod.id)
        : await api.magisk.disable(mod.id);
      setResult({
        success: r.success,
        message: r.success
          ? `${enable ? '启用' : '禁用'}成功: ${mod.name || mod.id}`
          : `${enable ? '启用' : '禁用'}失败: ${r.error ?? '未知错误'}`,
      });
      if (r.success) {
        await loadModules();
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
      setPendingAction(null);
    }
  };

  const isDisabled = (status: string): boolean => {
    return status.includes('禁用') || status.toLowerCase().includes('disabled');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Boxes className="h-5 w-5 text-blue-500" />
            Magisk 模块管理
          </h1>
          <p className="mt-1 text-sm text-zinc-500">模块安装/卸载/启用/禁用/列表/商店</p>
        </div>
        <button
          onClick={loadModules}
          disabled={loading || !device || device.type !== 'adb'}
          className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      {/* 模块商店(M5 新增) */}
      <ModuleStore />

      {/* 安装方式选择 + 安装按钮 */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <Upload className="h-3.5 w-3.5" />
          安装模块
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="mb-3">
            <div className="mb-2 text-[10px] text-zinc-500">安装方式(对应 instmodule.bat)</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {INSTALL_METHODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setInstallMethod(m.value)}
                  disabled={executing}
                  className={cn(
                    'rounded-md border p-2 text-left text-xs transition-colors',
                    installMethod === m.value
                      ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                      : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-blue-600/40 hover:bg-zinc-900/50',
                  )}
                >
                  <div className="font-medium">{m.label}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">{m.description}</div>
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleInstall}
            disabled={executing || !device || device.type !== 'adb'}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {executing && pendingAction?.type === 'install' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {executing && pendingAction?.type === 'install' ? '安装中...' : '选择 zip 安装'}
          </button>
        </div>
      </section>

      {/* 卸载方式选择 */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <Trash2 className="h-3.5 w-3.5" />
          卸载方式(应用于下方模块列表)
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {UNINSTALL_METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setUninstallMethod(m.value)}
                disabled={executing}
                className={cn(
                  'rounded-md border p-2 text-left text-xs transition-colors',
                  uninstallMethod === m.value
                    ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                    : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-blue-600/40 hover:bg-zinc-900/50',
                )}
              >
                <div className="font-medium">{m.label}</div>
                <div className="mt-0.5 text-[10px] text-zinc-500">{m.description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 操作结果 */}
      {result && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border p-3 text-sm',
            result.success
              ? 'border-green-800/50 bg-green-950/20 text-green-300'
              : 'border-red-800/50 bg-red-950/20 text-red-300',
          )}
        >
          {result.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span className="truncate">{result.message}</span>
        </div>
      )}

      {/* 模块列表 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <Package className="h-3.5 w-3.5" />
            已安装模块
            <span className="text-zinc-600">({modules.length})</span>
          </h2>
        </div>

        {!device || device.type !== 'adb' ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 py-16">
            <WifiOff className="h-10 w-10 text-zinc-600" />
            <div className="text-sm text-zinc-400">需要 ADB 模式设备</div>
            <p className="max-w-md text-center text-xs text-zinc-500">
              请连接手表并开启 ADB 调试,且设备需已 Root
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">加载模块列表...</span>
          </div>
        ) : modules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
            无已安装模块
          </div>
        ) : (
          <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-lg border border-zinc-800 p-2">
            {modules.map((mod) => {
              const expanded = expandedId === mod.id;
              const disabled = isDisabled(mod.status);
              return (
                <div
                  key={mod.id}
                  className={cn(
                    'rounded-md border bg-zinc-900/30 transition-colors',
                    expanded ? 'border-blue-600/40' : 'border-zinc-800/60',
                  )}
                >
                  {/* 模块摘要行 */}
                  <button
                    onClick={() => setExpandedId(expanded ? null : mod.id)}
                    disabled={executing}
                    className="flex w-full items-center gap-3 p-3 text-left"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    )}
                    <div
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                        disabled
                          ? 'bg-zinc-800 text-zinc-500'
                          : 'bg-blue-600/15 text-blue-400',
                      )}
                    >
                      <Package className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-zinc-100">
                          {mod.name || mod.id}
                        </span>
                        {mod.version && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            v{mod.version}
                          </span>
                        )}
                        {disabled && (
                          <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
                            已禁用
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                        ID: {mod.id}
                        {mod.author && ` · 作者: ${mod.author}`}
                      </div>
                    </div>
                  </button>

                  {/* 展开详情 */}
                  {expanded && (
                    <div className="border-t border-zinc-800/60 px-3 py-3">
                      {mod.description && (
                        <div className="mb-2 text-xs text-zinc-400">
                          <span className="text-zinc-600">描述:</span> {mod.description}
                        </div>
                      )}
                      <div className="mb-3 grid grid-cols-2 gap-1 text-[10px] text-zinc-500 sm:grid-cols-4">
                        <div>
                          <span className="text-zinc-600">状态:</span>{' '}
                          <span className="text-zinc-400">{mod.status || '未知'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-600">版本:</span>{' '}
                          <span className="text-zinc-400">{mod.version || '未知'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-600">内部版本:</span>{' '}
                          <span className="text-zinc-400">{mod.versionCode || '未知'}</span>
                        </div>
                        <div className="truncate">
                          <span className="text-zinc-600">作者:</span>{' '}
                          <span className="text-zinc-400">{mod.author || '未知'}</span>
                        </div>
                      </div>
                      {mod.updateJson && (
                        <div className="mb-3 truncate text-[10px] text-zinc-500">
                          <span className="text-zinc-600">更新地址:</span> {mod.updateJson}
                        </div>
                      )}

                      {/* 操作按钮 */}
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleToggle(mod, disabled)}
                          disabled={
                            executing ||
                            (pendingAction?.type === 'enable' &&
                              pendingAction.moduleId === mod.id) ||
                            (pendingAction?.type === 'disable' &&
                              pendingAction.moduleId === mod.id)
                          }
                          className={cn(
                            'flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors',
                            disabled
                              ? 'border-blue-600/60 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white'
                              : 'border-amber-700/60 bg-amber-900/10 text-amber-400 hover:bg-amber-700 hover:text-white',
                          )}
                        >
                          {executing &&
                            (pendingAction?.type === 'enable' ||
                              pendingAction?.type === 'disable') &&
                            pendingAction.moduleId === mod.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : disabled ? (
                              <Power className="h-3 w-3" />
                            ) : (
                              <Ban className="h-3 w-3" />
                            )}
                          {disabled ? '启用' : '禁用'}
                        </button>
                        <button
                          onClick={() => handleUninstall(mod)}
                          disabled={
                            executing ||
                            (pendingAction?.type === 'uninstall' &&
                              pendingAction.moduleId === mod.id)
                          }
                          className="flex items-center gap-1 rounded-md border border-red-700/60 bg-red-900/10 px-2.5 py-1 text-xs text-red-400 hover:bg-red-700 hover:text-white disabled:opacity-50"
                        >
                          {executing &&
                            pendingAction?.type === 'uninstall' &&
                            pendingAction.moduleId === mod.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          卸载({uninstallMethod})
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ========== 模块商店(M5 新增) ==========

function ModuleStore(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [modules, setModules] = useState<StoreModule[]>([]);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (): Promise<void> => {
    if (!query.trim()) return;
    setSearching(true);
    setResult(null);
    try {
      const r = await api.magisk.storeSearch(query);
      setModules(r.modules);
      setSearched(true);
      if (!r.success) {
        setResult({ success: false, message: r.modules.length === 0 ? '搜索失败或无结果' : '' });
      } else if (r.modules.length === 0) {
        setResult({ success: true, message: '未找到匹配模块(API 可能不可用)' });
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
      setModules([]);
    } finally {
      setSearching(false);
    }
  };

  const handleInstall = async (mod: StoreModule): Promise<void> => {
    if (!device || device.type !== 'adb') {
      setResult({ success: false, message: '需要 ADB 模式设备' });
      return;
    }
    if (!window.confirm(`确认从商店安装模块「${mod.name || mod.id}」?`)) return;
    setInstallingId(mod.id);
    setResult(null);
    try {
      const r = await api.magisk.storeInstall(mod);
      setResult({
        success: r.success,
        message: r.success
          ? `模块安装成功: ${mod.name || mod.id}`
          : `安装失败: ${r.error ?? '未知错误'}`,
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setInstallingId(null);
    }
  };

  const noDevice = !device || device.type !== 'adb';

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Store className="h-3.5 w-3.5" />
        模块商店
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">M5</span>
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        {noDevice && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>模块商店安装需要 ADB 模式设备(搜索可离线)</span>
          </div>
        )}

        {/* 搜索框 */}
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索模块名称/描述/作者..."
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 py-2 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            搜索
          </button>
        </div>

        {/* 操作结果 */}
        {result && (
          <div
            className={cn(
              'mt-3 flex items-center gap-2 rounded-md border p-2.5 text-xs',
              result.success
                ? 'border-green-800/50 bg-green-950/20 text-green-300'
                : 'border-red-800/50 bg-red-950/20 text-red-300',
            )}
          >
            {result.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{result.message}</span>
          </div>
        )}

        {/* 搜索结果列表 */}
        {searched && modules.length === 0 && !searching ? (
          <div className="mt-3 py-6 text-center text-xs text-zinc-500">
            未找到匹配模块。模块商店 API 可能不可用,可尝试用关键词搜索或改用本地 zip 安装。
          </div>
        ) : modules.length > 0 ? (
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto rounded-md border border-zinc-800 p-2">
            {modules.map((mod) => (
              <div
                key={mod.id || mod.downloadUrl}
                className="rounded-md border border-zinc-800/60 bg-zinc-900/40 p-3 hover:border-blue-600/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                      <span className="truncate text-sm font-medium text-zinc-100">
                        {mod.name || mod.id || '(未命名)'}
                      </span>
                      {mod.version && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          v{mod.version}
                        </span>
                      )}
                    </div>
                    {mod.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{mod.description}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
                      {mod.author && <span>作者: {mod.author}</span>}
                      {mod.id && <span className="font-mono">ID: {mod.id}</span>}
                      {mod.lastUpdate && <span>更新: {mod.lastUpdate}</span>}
                      {mod.homepage && (
                        <a
                          href={mod.homepage}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-blue-400 hover:underline"
                        >
                          主页 <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleInstall(mod)}
                    disabled={noDevice || installingId === mod.id}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {installingId === mod.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    安装
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
