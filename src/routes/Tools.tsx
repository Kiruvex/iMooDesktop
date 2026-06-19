// src/routes/Tools.tsx - 其他工具页(含 scrcpy + 充电 + 设备信息 + 无线 ADB + OTA + 驱动 + atbmod)
// 对应原 commonly.json + scripttool.json

import { useEffect, useState } from 'react';
import {
  Wrench,
  MonitorSmartphone,
  Play,
  Square,
  BatteryCharging,
  Network,
  Info,
  HardDriveDownload,
  Loader2,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Search,
  Cpu,
  Usb,
  Package,
  Upload,
  Trash2,
  RefreshCw,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { api, type ScrcpyOptions } from '../lib/api';
import { cn } from '../lib/utils';
import { useDeviceStore } from '../stores/deviceStore';

export function Tools(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Wrench className="h-5 w-5 text-blue-500" />
          其他工具
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          scrcpy 投屏、充电、无线 ADB、设备信息、OTA 升级、驱动检测、.atbmod 模块
        </p>
      </div>

      <ScrcpyLauncher />
      <OpenCharge />
      <WifiAdb />
      <ReadBuildProps />
      <OtaUpgrade />
      <DriverCheck />
      <AtbmodManager />
      <RootProOptimize />
    </div>
  );
}

// ========== 充电可用 ==========

function OpenCharge(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleExecute = async (): Promise<void> => {
    setExecuting(true);
    setResult(null);
    try {
      const res = await api.tools.openCharge();
      setResult({
        success: res.success,
        message: res.success ? '充电可用已开启' : res.error ?? '失败',
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <BatteryCharging className="h-3.5 w-3.5" />
        充电可用
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <p className="mb-3 text-xs text-zinc-400">
          开启后设备可在充电时使用(需 root 权限)。对应 setprop persist.sys.charge.usable true
        </p>
        <button
          onClick={handleExecute}
          disabled={executing || !device || device.type !== 'adb'}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BatteryCharging className="h-3.5 w-3.5" />}
          {executing ? '执行中...' : '开启充电可用'}
        </button>
        {result && (
          <div
            className={cn(
              'mt-3 flex items-center gap-2 text-xs',
              result.success ? 'text-green-400' : 'text-red-400',
            )}
          >
            {result.success ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ========== 无线 ADB ==========

function WifiAdb(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('5555');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleEnable = async (): Promise<void> => {
    setExecuting(true);
    setResult(null);
    try {
      const res = await api.tools.wifiEnable();
      setResult({
        success: res.success,
        message: res.success ? '已切换到无线模式(端口 5555),请拔掉 USB 后用 IP 连接' : res.error ?? '失败',
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
    }
  };

  const handleConnect = async (): Promise<void> => {
    if (!ip) {
      setResult({ success: false, message: '请输入设备 IP' });
      return;
    }
    setExecuting(true);
    setResult(null);
    try {
      const res = await api.tools.wifiConnect(ip, Number(port) || 5555);
      setResult({
        success: res.success,
        message: res.success ? `已连接 ${ip}:${port}` : res.error ?? `连接 ${ip}:${port} 失败`,
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    if (!ip) return;
    setExecuting(true);
    try {
      await api.tools.wifiDisconnect(ip, Number(port) || 5555);
      setResult({ success: true, message: `已断开 ${ip}:${port}` });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Network className="h-3.5 w-3.5" />
        无线调试 (ADB)
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[10px] text-zinc-500">设备 IP</label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="如 192.168.1.100"
              className="w-40 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-zinc-500">端口</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
            />
          </div>
          <button
            onClick={handleConnect}
            disabled={executing || !ip}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            连接
          </button>
          <button
            onClick={handleDisconnect}
            disabled={executing || !ip}
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            断开
          </button>
        </div>
        <button
          onClick={handleEnable}
          disabled={executing || !device || device.type !== 'adb'}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {executing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Network className="h-3 w-3" />}
          切换到无线模式(需 USB 连接)
        </button>
        {result && (
          <div
            className={cn(
              'mt-3 flex items-center gap-2 text-xs',
              result.success ? 'text-green-400' : 'text-red-400',
            )}
          >
            {result.success ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ========== 读取设备信息 ==========

function ReadBuildProps(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [loading, setLoading] = useState(false);
  const [props, setProps] = useState<{ key: string; label: string; value: string }[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.tools.readBuildProps();
      if (res.success) {
        setProps(res.props);
      } else {
        setError(res.error ?? '读取失败');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (device?.type === 'adb') {
      load();
    } else {
      setProps([]);
    }
  }, [device]);

  const filtered = props.filter(
    (p) =>
      p.label.toLowerCase().includes(search.toLowerCase()) ||
      p.key.toLowerCase().includes(search.toLowerCase()) ||
      p.value.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <Info className="h-3.5 w-3.5" />
          设备信息
        </h2>
        <button
          onClick={load}
          disabled={loading || !device || device.type !== 'adb'}
          className="rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-900 disabled:opacity-50"
        >
          刷新
        </button>
      </div>
      {!device || device.type !== 'adb' ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 py-10">
          <WifiOff className="h-8 w-8 text-zinc-600" />
          <div className="text-xs text-zinc-500">需要 ADB 模式设备</div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">读取中...</span>
        </div>
      ) : (
        <>
          <div className="mb-2 relative max-w-xs">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索属性..."
              className="w-full rounded border border-zinc-800 bg-zinc-900/50 py-1 pl-7 pr-2 text-xs text-zinc-200 placeholder-zinc-600"
            />
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-800">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-xs text-zinc-500">无数据</div>
            ) : (
              filtered.map((p) => (
                <div
                  key={p.key}
                  className="border-b border-zinc-800/60 px-3 py-1.5 last:border-0 hover:bg-zinc-900/40"
                >
                  <div className="text-[10px] text-zinc-500">{p.label}</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-600">{p.key}</span>
                    <span className="truncate font-mono text-xs text-zinc-200">{p.value}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ========== scrcpy 启动器 ==========

function ScrcpyLauncher(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [opts, setOpts] = useState<ScrcpyOptions>({
    noControl: false,
    turnScreenOff: false,
    stayAwake: true,
    noAudio: false,
    showTouches: false,
    fullscreen: false,
    alwaysOnTop: false,
  });
  const [launching, setLaunching] = useState(false);
  const [running, setRunning] = useState<{ pid: number; opts: ScrcpyOptions; startedAt: number }[]>([]);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const refreshRunning = async (): Promise<void> => {
    setRunning(await api.scrcpy.list());
  };

  useEffect(() => {
    refreshRunning();
    const timer = setInterval(refreshRunning, 2000);
    return () => clearInterval(timer);
  }, []);

  const handleLaunch = async (): Promise<void> => {
    if (!device || device.type !== 'adb') {
      setResult({ success: false, message: '投屏需要 ADB 模式设备' });
      return;
    }
    setLaunching(true);
    setResult(null);
    try {
      const res = await api.scrcpy.launch(opts);
      if (res.success && res.pid) {
        setResult({ success: true, message: `已启动 (pid=${res.pid})` });
        await refreshRunning();
      } else {
        setResult({ success: false, message: res.error ?? '启动失败' });
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setLaunching(false);
    }
  };

  const handleStop = async (pid: number): Promise<void> => {
    await api.scrcpy.stop(pid);
    await refreshRunning();
  };

  const toggle = (key: keyof ScrcpyOptions): void => {
    setOpts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const checkboxes: { key: keyof ScrcpyOptions; label: string }[] = [
    { key: 'noControl', label: '禁用控制(仅观看)' },
    { key: 'turnScreenOff', label: '关闭屏幕' },
    { key: 'stayAwake', label: '保持唤醒' },
    { key: 'noAudio', label: '禁用音频' },
    { key: 'audio', label: '启用音频(实验)' },
    { key: 'showTouches', label: '显示触摸' },
    { key: 'alwaysOnTop', label: '窗口置顶' },
    { key: 'fullscreen', label: '全屏' },
    { key: 'windowBorderless', label: '无边框' },
    { key: 'noClipboardAutosync', label: '禁用剪贴板同步' },
    { key: 'legacyPaste', label: '旧版粘贴' },
  ];

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <MonitorSmartphone className="h-3.5 w-3.5" />
        scrcpy 投屏
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        {(!device || device.type !== 'adb') && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>
              {!device ? '未检测到设备' : '投屏需要 ADB 模式设备'}。请连接手表并开启 ADB 调试。
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {checkboxes.map(({ key, label }) => (
            <label
              key={String(key)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={Boolean(opts[key])}
                onChange={() => toggle(key)}
                className="h-3 w-3 accent-blue-600"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumInput
            label="最大帧率"
            value={opts.maxFps}
            onChange={(v) => setOpts((prev) => ({ ...prev, maxFps: v }))}
            placeholder="如 60"
          />
          <NumInput
            label="比特率(Kbps)"
            value={opts.bitRate}
            onChange={(v) => setOpts((prev) => ({ ...prev, bitRate: v }))}
            placeholder="如 8000"
          />
          <NumInput
            label="最大尺寸"
            value={opts.maxSize}
            onChange={(v) => setOpts((prev) => ({ ...prev, maxSize: v }))}
            placeholder="如 1024"
          />
          <div>
            <label className="mb-1 block text-[10px] text-zinc-500">录屏格式</label>
            <select
              value={opts.recordFormat ?? ''}
              onChange={(e) =>
                setOpts((prev) => ({
                  ...prev,
                  recordFormat: (e.target.value || undefined) as 'mp4' | 'mkv' | undefined,
                }))
              }
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="">不录屏</option>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleLaunch}
            disabled={launching}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {launching ? '启动中...' : '启动投屏'}
          </button>
          {result && (
            <span className={cn('text-xs', result.success ? 'text-green-400' : 'text-red-400')}>
              {result.message}
            </span>
          )}
        </div>
        {running.length > 0 && (
          <div className="mt-4 border-t border-zinc-800 pt-3">
            <div className="mb-2 text-[10px] text-zinc-500">运行中 ({running.length})</div>
            <div className="space-y-1">
              {running.map((r) => (
                <div
                  key={r.pid}
                  className="flex items-center justify-between rounded bg-zinc-900/50 px-3 py-1.5 text-xs"
                >
                  <span className="font-mono text-zinc-400">pid={r.pid}</span>
                  <button
                    onClick={() => handleStop(r.pid)}
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-red-400 hover:bg-red-600 hover:text-white"
                  >
                    <Square className="h-3 w-3" />
                    停止
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function NumInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-[10px] text-zinc-500">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        placeholder={placeholder}
        className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600"
      />
    </div>
  );
}

// ========== 离线 OTA 升级(对应 ota.bat,M5 新增) ==========

function OtaUpgrade(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [executing, setExecuting] = useState(false);
  const [zipPath, setZipPath] = useState<string | null>(null);
  const [steps, setSteps] = useState<{ name: string; status: string; message?: string }[]>([]);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handlePick = async (): Promise<void> => {
    const files = await api.system.pickFile({
      kind: 'open',
      filter: 'OTA 包|*.zip;所有文件|*.*',
      multi: false,
    });
    if (!files) return;
    setZipPath(Array.isArray(files) ? files[0] : files);
  };

  const handleExecute = async (): Promise<void> => {
    if (!zipPath) {
      setResult({ success: false, message: '请先选择 OTA zip' });
      return;
    }
    setExecuting(true);
    setResult(null);
    setSteps([]);
    try {
      const r = await api.tools.otaStart(zipPath);
      setSteps(r.steps);
      setResult({
        success: r.success,
        message: r.success
          ? r.scrcpyStarted
            ? 'OTA 已推送,请在手表上点击"开始升级"(已启动 scrcpy 投屏)'
            : 'OTA 已推送,请在手表上点击"开始升级"'
          : r.error ?? '失败',
      });
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <HardDriveDownload className="h-3.5 w-3.5" />
        离线 OTA 升级
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">M5</span>
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <p className="mb-3 text-xs text-zinc-400">
          对应 ota.bat:检测 ADB 设备 → 读 innermodel/softversion → isv3 检测(V3 不支持离线 OTA)
          → adb root(必须含 "restarting",否则不在 QMMI)→ rm -rf /data/ota* → 推送 OTA zip 到
          /sdcard/xtc/ota_f_vota.zip → am start OfflineOtaActivity → 启动 scrcpy 引导点击"开始升级"。
        </p>

        {/* 选择 OTA zip */}
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={handlePick}
            disabled={executing}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            选择 OTA zip
          </button>
          {zipPath && (
            <span className="truncate text-xs text-zinc-500" title={zipPath}>
              {zipPath}
            </span>
          )}
        </div>

        <button
          onClick={handleExecute}
          disabled={executing || !zipPath || !device || device.type !== 'adb'}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
          {executing ? '执行中...' : '开始 OTA 升级'}
        </button>

        {/* 步骤进度 */}
        {steps.length > 0 && (
          <div className="mt-4 rounded-md border border-zinc-800 p-2">
            {steps.map((step, i) => (
              <div
                key={i}
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

        {result && (
          <div
            className={cn(
              'mt-3 flex items-center gap-2 rounded-md border p-3 text-xs',
              result.success
                ? 'border-green-800/50 bg-green-950/20 text-green-300'
                : 'border-red-800/50 bg-red-950/20 text-red-300',
            )}
          >
            {result.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ========== Android 8.1 Root 后优化(对应 rootpro.bat,M5 新增) ==========

function RootProOptimize(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [executing, setExecuting] = useState(false);
  const [opts, setOpts] = useState({ installApks: false, installDesktop: false, installMods: false });
  const [result, setResult] = useState<{
    success: boolean;
    supported: boolean;
    steps: { name: string; status: string; message?: string }[];
    error?: string;
    innermodel?: string;
    sdkVersion?: string;
    isV3?: boolean;
    haveSystemUI?: boolean;
  } | null>(null);

  const handleExecute = async (): Promise<void> => {
    setExecuting(true);
    setResult(null);
    try {
      const r = await api.tools.rootpro(opts);
      setResult(r);
    } catch (e) {
      setResult({
        success: false,
        supported: false,
        steps: [],
        error: (e as Error).message,
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <ShieldCheck className="h-3.5 w-3.5" />
        Android 8.1 Root 后优化
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">M5</span>
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <p className="mb-3 text-xs text-zinc-400">
          对应 rootpro.bat:仅支持 SDK=27(Android 8.1)。读取 innermodel/softversion → isv3 检测
          → pm path com.android.systemui → 可选安装拓展应用包/禁用模式切换桌面/拓展 magisk 模块。
        </p>

        {/* 选项 */}
        <div className="mb-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={opts.installApks}
              onChange={(e) => setOpts({ ...opts, installApks: e.target.checked })}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            安装拓展应用包(读 rootproapks/rootproapks.txt)
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={opts.installDesktop}
              onChange={(e) => setOpts({ ...opts, installDesktop: e.target.checked })}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            安装禁用模式切换桌面(isv3+havesystemui → 130510_D;isv3+!havesystemui → 121750_D;!isv3 → 116100_D)
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={opts.installMods}
              onChange={(e) => setOpts({ ...opts, installMods: e.target.checked })}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            刷拓展 magisk 模块(读 magiskmod/rootpromods.txt)
          </label>
        </div>

        <button
          onClick={handleExecute}
          disabled={executing || !device || device.type !== 'adb'}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {executing ? '执行中...' : '开始 Root 后优化'}
        </button>

        {/* 设备信息 */}
        {result && (result.innermodel || result.sdkVersion) && (
          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-400">
            <div>innermodel: <span className="font-mono text-zinc-200">{result.innermodel || '未知'}</span></div>
            <div>SDK: <span className="font-mono text-zinc-200">{result.sdkVersion || '未知'}</span></div>
            <div>isV3: <span className="font-mono text-zinc-200">{String(result.isV3)}</span></div>
            <div>haveSystemUI: <span className="font-mono text-zinc-200">{String(result.haveSystemUI)}</span></div>
          </div>
        )}

        {/* 步骤进度 */}
        {result && result.steps.length > 0 && (
          <div className="mt-3 rounded-md border border-zinc-800 p-2">
            {result.steps.map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-2 border-b border-zinc-800/60 px-1 py-1.5 last:border-0"
              >
                <div className="shrink-0">
                  {step.status === 'success' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  ) : step.status === 'failed' ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  ) : step.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                  ) : step.status === 'skipped' ? (
                    <div className="h-3.5 w-3.5 rounded-full bg-zinc-700" />
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

        {result && (
          <div
            className={cn(
              'mt-3 flex items-center gap-2 rounded-md border p-3 text-xs',
              result.success
                ? 'border-green-800/50 bg-green-950/20 text-green-300'
                : 'border-red-800/50 bg-red-950/20 text-red-300',
            )}
          >
            {result.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            <span>
              {result.success
                ? '优化全部完成'
                : result.error ?? '优化失败'}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

// ========== 驱动检测(对应 checkdriver.bat,M5 新增) ==========

function DriverCheck(): JSX.Element {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<{ qualcomm: boolean; adb: boolean; vcRuntime: boolean } | null>(null);
  const [installSteps, setInstallSteps] = useState<{ name: string; status: string; message?: string }[]>([]);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleCheck = async (): Promise<void> => {
    setChecking(true);
    setResult(null);
    try {
      const r = await api.tools.checkDrivers();
      if (r.success) {
        setStatus(r.status);
        if (r.allInstalled) {
          setResult({ success: true, message: '所有驱动已安装' });
        }
      } else {
        setResult({ success: false, message: r.error ?? '检测失败' });
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async (): Promise<void> => {
    setInstalling(true);
    setResult(null);
    setInstallSteps([]);
    try {
      const r = await api.tools.installDrivers();
      setInstallSteps(r.steps);
      setResult({
        success: r.success,
        message: r.success
          ? '驱动和环境配置完毕,部分更改可能需要重启电脑以完成安装'
          : r.error ?? '安装过程出错',
      });
      // 重新检查
      await handleCheck();
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Cpu className="h-3.5 w-3.5" />
        驱动检测
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">M5</span>
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <p className="mb-3 text-xs text-zinc-400">
          对应 checkdriver.bat:检查 Qualcomm 9008 / ADB / VC 运行库驱动是否已安装,缺失时自动安装。
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={handleCheck}
            disabled={checking || installing}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            检测驱动
          </button>
          <button
            onClick={handleInstall}
            disabled={checking || installing}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            下载并安装缺失驱动
          </button>
        </div>

        {/* 驱动状态卡片 */}
        {status && (
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <DriverCard
              label="Qualcomm 9008"
              desc="EDL 模式驱动"
              icon={<Cpu className="h-4 w-4" />}
              ok={status.qualcomm}
            />
            <DriverCard
              label="ADB"
              desc="通用 ADB 驱动"
              icon={<Usb className="h-4 w-4" />}
              ok={status.adb}
            />
            <DriverCard
              label="VC 运行库"
              desc="mfc100/110/120"
              icon={<Package className="h-4 w-4" />}
              ok={status.vcRuntime}
            />
          </div>
        )}

        {/* 安装步骤 */}
        {installSteps.length > 0 && (
          <div className="mb-3 rounded-md border border-zinc-800 p-2">
            {installSteps.map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-2 border-b border-zinc-800/60 px-1 py-1.5 last:border-0"
              >
                <div className="shrink-0">
                  {step.status === 'success' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  ) : step.status === 'failed' ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  ) : step.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                  ) : step.status === 'skipped' ? (
                    <div className="h-3.5 w-3.5 rounded-full bg-zinc-700" />
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

        {result && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border p-3 text-xs',
              result.success
                ? 'border-green-800/50 bg-green-950/20 text-green-300'
                : 'border-red-800/50 bg-red-950/20 text-red-300',
            )}
          >
            {result.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function DriverCard({
  label,
  desc,
  icon,
  ok,
}: {
  label: string;
  desc: string;
  icon: React.ReactNode;
  ok: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-md border p-3',
        ok ? 'border-green-800/50 bg-green-950/10' : 'border-red-800/50 bg-red-950/10',
      )}
    >
      <div className="flex items-center justify-between">
        <div
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md',
            ok ? 'bg-green-600/15 text-green-400' : 'bg-red-600/15 text-red-400',
          )}
        >
          {icon}
        </div>
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        )}
      </div>
      <div className="mt-2 text-sm font-medium text-zinc-200">{label}</div>
      <div className="text-[10px] text-zinc-500">{desc}</div>
      <div className={cn('mt-1 text-[10px]', ok ? 'text-green-400' : 'text-red-400')}>
        {ok ? '已安装' : '未安装'}
      </div>
    </div>
  );
}

// ========== .atbmod 模块(对应 Loadatbmod.bat,M5 新增) ==========

function AtbmodManager(): JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<{ path: string; filename: string; size: number }[]>([]);
  const [installingFile, setInstallingFile] = useState<string | null>(null);
  const [installed, setInstalled] = useState<{
    modid: string;
    dir: string;
    hasProp: boolean;
    prop?: {
      modid: string;
      modname: string;
      modversion: string;
      modversioncode: string;
      modtype: string;
    };
  }[]>([]);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadFiles = async (): Promise<void> => {
    setScanning(true);
    try {
      const r = await api.tools.atbmodScan();
      if (r.success) setFiles(r.files);
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setScanning(false);
    }
  };

  const loadInstalled = async (): Promise<void> => {
    try {
      const r = await api.tools.atbmodList();
      if (r.success) setInstalled(r.installed);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadFiles();
    loadInstalled();
  }, []);

  const handleInstall = async (file: { path: string; filename: string }): Promise<void> => {
    if (!window.confirm(`确认安装 atbmod 模块「${file.filename}」?`)) return;
    setInstallingFile(file.path);
    setResult(null);
    try {
      const r = await api.tools.atbmodInstall(file.path);
      setResult({
        success: r.success,
        message: r.success
          ? `模块安装成功: ${r.modid ?? file.filename}`
          : `安装失败: ${r.error ?? '未知错误'}`,
      });
      // 安装后刷新列表
      await loadFiles();
      await loadInstalled();
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setInstallingFile(null);
    }
  };

  const handleUninstall = async (modid: string): Promise<void> => {
    if (!window.confirm(`确认卸载 atbmod 模块「${modid}」?`)) return;
    try {
      const r = await api.tools.atbmodUninstall(modid);
      setResult({
        success: r.success,
        message: r.success ? `已卸载: ${modid}` : `卸载失败: ${r.error ?? '未知错误'}`,
      });
      await loadInstalled();
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    }
  };

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Package className="h-3.5 w-3.5" />
        .atbmod 模块
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">M5</span>
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <p className="mb-3 text-xs text-zinc-400">
          对应 Loadatbmod.bat:扫描 resources/bin/*.atbmod 文件 → 7z 解压 → 读 atbmod.prop
          → 执行 install.bat/install.exe → 重命名为 mod/&lt;modid&gt;/。
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={loadFiles}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            重新扫描
          </button>
        </div>

        {result && (
          <div
            className={cn(
              'mb-3 flex items-center gap-2 rounded-md border p-2.5 text-xs',
              result.success
                ? 'border-green-800/50 bg-green-950/20 text-green-300'
                : 'border-red-800/50 bg-red-950/20 text-red-300',
            )}
          >
            {result.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            <span>{result.message}</span>
          </div>
        )}

        {/* 待安装 .atbmod 文件 */}
        <div className="mb-4">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
            待安装文件 ({files.length})
          </div>
          {files.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-500">
              无 .atbmod 文件(请将 .atbmod 包放入 resources/bin/ 目录)
            </div>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-zinc-800 p-2">
              {files.map((f) => (
                <div
                  key={f.path}
                  className="flex items-center justify-between rounded bg-zinc-900/40 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-zinc-200">{f.filename}</div>
                    <div className="text-[10px] text-zinc-500">
                      {(f.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    onClick={() => handleInstall(f)}
                    disabled={installingFile === f.path}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {installingFile === f.path ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    安装
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 已安装模块 */}
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
            已安装模块 ({installed.length})
          </div>
          {installed.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-800 py-4 text-center text-xs text-zinc-500">
              暂无已安装的 atbmod 模块
            </div>
          ) : (
            <div className="space-y-1">
              {installed.map((mod) => (
                <div
                  key={mod.modid}
                  className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/40 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-zinc-200">
                      {mod.prop?.modname || mod.modid}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">
                      <span className="font-mono">{mod.modid}</span>
                      {mod.prop?.modversion && ` · v${mod.prop.modversion}`}
                      {mod.prop?.modtype && ` · ${mod.prop.modtype}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUninstall(mod.modid)}
                    className="rounded p-1 text-zinc-500 hover:bg-red-600 hover:text-white"
                    title="卸载"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
