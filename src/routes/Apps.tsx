// src/routes/Apps.tsx - 应用管理页
// 对应原 appset.json:安装/卸载应用 + Z10 解除安装限制 + QQ/微信开机自启

import { useCallback, useEffect, useState } from 'react';
import {
  AppWindow,
  Upload,
  Trash2,
  Search,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  WifiOff,
  ToggleRight,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { api, type Z10UnlockResult, type AutoStartResult } from '../lib/api';
import { cn } from '../lib/utils';
import { useDeviceStore } from '../stores/deviceStore';
import { ApkPreviewDialog } from '../components/common/ApkPreviewDialog';

export function Apps(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [packages, setPackages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [thirdParty, setThirdParty] = useState(true);
  const [installResult, setInstallResult] = useState<{ success: boolean; message: string } | null>(null);
  const [uninstallResult, setUninstallResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadPackages = useCallback(async (): Promise<void> => {
    // 没设备或非 ADB 模式,不调用
    if (!device || device.type !== 'adb') {
      setPackages([]);
      return;
    }
    setLoading(true);
    try {
      const list = await api.app.list(thirdParty);
      setPackages(list);
    } finally {
      setLoading(false);
    }
  }, [device, thirdParty]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const [apkPreviewPath, setApkPreviewPath] = useState<string | null>(null);

  const handleInstall = async (): Promise<void> => {
    const files = await api.system.pickFile({
      kind: 'open',
      filter: 'APK 文件|*.apk;所有文件|*.*',
      multi: false,
    });
    if (!files) return;
    const apkPath = Array.isArray(files) ? files[0] : files;
    // 弹 APK 预览,确认后安装
    setApkPreviewPath(apkPath);
  };

  const handleConfirmInstall = async (apkPath: string): Promise<void> => {
    setApkPreviewPath(null);
    setInstallResult(null);
    const res = await api.app.install(apkPath);
    setInstallResult({
      success: res.success,
      message: res.success ? `安装成功: ${apkPath.split(/[\\/]/).pop()}` : `安装失败: ${res.error}`,
    });
    await loadPackages();
  };

  const handleUninstall = async (pkg: string): Promise<void> => {
    if (!window.confirm(`确定卸载 ${pkg}?`)) return;
    const res = await api.app.uninstall(pkg);
    setUninstallResult({
      success: res.success,
      message: res.success ? `已卸载: ${pkg}` : `卸载失败: ${res.error}`,
    });
    if (res.success) {
      await loadPackages();
    }
  };

  const filtered = packages.filter((p) => p.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          <AppWindow className="title-icon" />
          应用管理
        </h1>
        <p className="text-desc">安装/卸载应用</p>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleInstall}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Upload className="h-3.5 w-3.5" />
          安装应用
        </button>
        <button
          onClick={loadPackages}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          刷新
        </button>
        <button
          onClick={() => setThirdParty(!thirdParty)}
          className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          {thirdParty ? '显示全部' : '仅第三方'}
        </button>
      </div>

      {/* 安装结果 */}
      {installResult && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border p-3 text-sm',
            installResult.success
              ? 'alert-ok-color'
              : 'alert-err-color',
          )}
        >
          {installResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <span>{installResult.message}</span>
        </div>
      )}

      {/* 卸载结果 */}
      {uninstallResult && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border p-3 text-sm',
            uninstallResult.success
              ? 'alert-ok-color'
              : 'alert-err-color',
          )}
        >
          {uninstallResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <span>{uninstallResult.message}</span>
        </div>
      )}

      {/* 应用列表 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索包名..."
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <span className="text-xs text-zinc-500">共 {filtered.length} 个</span>
        </div>

        {!device || device.type !== 'adb' ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 py-16">
            <WifiOff className="h-10 w-10 text-zinc-600" />
            <div className="text-sm text-zinc-400">
              {!device ? '未检测到设备' : '应用管理需要 ADB 模式设备'}
            </div>
            <p className="max-w-md text-center text-xs text-zinc-500">
              请连接手表并开启 ADB 调试后查看应用列表
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-800">
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-zinc-500">无应用</div>
            ) : (
              filtered.map((pkg) => (
                <div
                  key={pkg}
                  className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2 last:border-0 hover:bg-zinc-900/40"
                >
                  <span className="font-mono text-xs text-zinc-300">{pkg}</span>
                  <button
                    onClick={() => handleUninstall(pkg)}
                    className="rounded p-1 text-zinc-500 hover:bg-red-600 hover:text-white"
                    title="卸载"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Z10 解除安装限制 + QQ/微信开机自启 */}
      <Z10Unlock />
      <AutoStart />

      {/* APK 预览弹窗 */}
      <ApkPreviewDialog
        apkPath={apkPreviewPath}
        onConfirm={(path) => void handleConfirmInstall(path)}
        onClose={() => setApkPreviewPath(null)}
      />
    </div>
  );
}

// ========== Z10 解除安装限制(对应 z10openinst.bat) ==========

function Z10Unlock(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [executing, setExecuting] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [result, setResult] = useState<Z10UnlockResult | null>(null);

  const handleExecute = async (): Promise<void> => {
    if (!device || device.type !== 'adb') return;
    if (
      !window.confirm(
        '请确认手表已进入 QMMI 模式并已降级。\n\n本操作将:\n1. 推送 switch.db\n2. adb root\n3. 写入 setprop 解除限制\n4. 软重启 zygote\n5. 安装 z10apk.Apk + z10apk1.Apk\n\n是否继续?',
      )
    )
      return;
    setExecuting(true);
    setResult(null);
    try {
      const r = await api.app.unlockZ10();
      setResult(r);
    } catch (e) {
      setResult({
        success: false,
        steps: [],
        error: (e as Error).message,
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section>
      <h2 className="section-title">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 hover:text-zinc-300"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <ShieldCheck className="h-3.5 w-3.5" />
          Z10 解除安装限制
        </button>
      </h2>
      {expanded && (
        <div className="card">
          <p className="mb-3 text-xs text-zinc-400">
            对应 z10openinst.bat:推送 switch.db → adb root → setprop adb_port/adb.install=1
            → cp switch.db → 软重启 zygote → 安装 z10apk.Apk / z10apk1.Apk。
            <span className="mt-1 block text-amber-300">
              要求:手表已进 QMMI 并降级,否则 adb root 会失败。
            </span>
          </p>
          <button
            onClick={handleExecute}
            disabled={executing || !device || device.type !== 'adb'}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {executing ? '执行中...' : 'Z10 解除安装限制'}
          </button>

          {/* 步骤进度 */}
          {result && (
            <div className="mt-4 space-y-2">
              {result.error && !result.steps.length && (
                <div className="alert-err-sm">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{result.error}</span>
                </div>
              )}
              {result.steps.length > 0 && (
                <div className="rounded-md border border-zinc-800 p-2">
                  {result.steps.map((step) => (
                    <div
                      key={step.name}
                      className="flex items-center gap-2 border-b border-zinc-800/60 px-1 py-1.5 last:border-0"
                    >
                      <div className="shrink-0">
                        {step.status === 'success' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                        ) : step.status === 'failed' ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                        ) : step.status === 'running' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full border border-zinc-700" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-zinc-300">{step.name}</div>
                        {step.message && (
                          <div className="truncate text-[10px] text-zinc-500">{step.message}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {result.success && (
                <div className="alert-ok-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Z10 安装限制已解除</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ========== QQ/微信开机自启(对应 qqwxautestart.bat) ==========

function AutoStart(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [executing, setExecuting] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [result, setResult] = useState<AutoStartResult | null>(null);

  const handleExecute = async (): Promise<void> => {
    if (!device || device.type !== 'adb') return;
    setExecuting(true);
    setResult(null);
    try {
      // 默认包名:com.tencent.qqlite, com.tencent.qqwatch, com.tencent.wechatkids
      const r = await api.app.enableAutoStart();
      setResult(r);
    } catch (e) {
      setResult({
        success: false,
        results: [],
        error: (e as Error).message,
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section>
      <h2 className="section-title">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 hover:text-zinc-300"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <ToggleRight className="h-3.5 w-3.5" />
          QQ/微信开机自启
        </button>
      </h2>
      {expanded && (
        <div className="card">
          <p className="mb-3 text-xs text-zinc-400">
            对应 qqwxautestart.bat:调用 content call com.xtc.launcher.self.start,默认包名:
          </p>
          <ul className="mb-3 list-inside list-disc space-y-0.5 text-[11px] text-zinc-500">
            <li>com.tencent.qqlite(轻量 QQ)</li>
            <li>com.tencent.qqwatch(QQ 手表版)</li>
            <li>com.tencent.wechatkids(微信少儿版)</li>
          </ul>
          <button
            onClick={handleExecute}
            disabled={executing || !device || device.type !== 'adb'}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ToggleRight className="h-3.5 w-3.5" />}
            {executing ? '执行中...' : '设置开机自启'}
          </button>

          {result && (
            <div className="mt-4 space-y-2">
              {result.error && (
                <div className="alert-err-sm">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{result.error}</span>
                </div>
              )}
              {result.results.length > 0 && (
                <div className="rounded-md border border-zinc-800 p-2">
                  {result.results.map((r) => (
                    <div
                      key={r.pkg}
                      className="flex items-center justify-between border-b border-zinc-800/60 px-1 py-1.5 last:border-0"
                    >
                      <span className="font-mono text-[11px] text-zinc-300">{r.pkg}</span>
                      {r.success ? (
                        <span className="flex items-center gap-1 text-[10px] text-green-400">
                          <CheckCircle2 className="h-3 w-3" /> 成功
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-red-400">
                          <AlertTriangle className="h-3 w-3" /> {r.error ?? '失败'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {result.success && (
                <div className="alert-ok-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>操作完成!</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
