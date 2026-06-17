import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { api } from '../lib/pyapi';
import type { DeviceInfo } from '../lib/pyapi';
import { PageHeader, Button, Alert, Badge, Skeleton, EmptyState, confirm } from '../components/ui';
import { useToast } from '../components/Toast';
import {
  BatteryLow, BatteryMedium, BatteryFull,
  Watch, Link2, RefreshCw, ClipboardCopy, CircleDot, Circle,
} from '../lib/icons';

interface DeviceInfoPageProps {
  device?: DeviceInfo | null;
}

interface DeviceData {
  id: string;
  name: string;
  model: string;
  innerModel: string;
  firmware: string;
  battery: number;
  watchOnline: boolean;
  pushProvince: string;
  language: string;
  powerLowProtectSwitch: boolean;
  imAccountInfo: { imAccountId: string };
}

/** getyk 实际语义：用 response code 判云控状态（r.data 是点赞明细，不是云控状态字典）。
 *  - '000001' = 未云控（normal）
 *  - '000007' = 也许被云控（warning）
 *  - '000003' = 设备信息未刷新，请 refresh 后重试（danger）
 *  - 其他     = 无法获取云控状态（info）
 *  参考原项目 Apirequests.getyk 与 Task 9-C 审计报告 */
interface YkStatus {
  code: string;
  text: string;
  level: 'success' | 'warning' | 'danger' | 'info';
}

const AUTOREFRESH_KEY = 'imoo_device_autorefresh';
const AUTOREFRESH_INTERVAL_MS = 60_000;

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 电量级别 → 颜色类名 */
function batteryColorClass(battery: number): string {
  if (battery < 20) return 'text-[var(--color-danger)] font-bold';
  if (battery < 50) return 'text-[var(--color-warning)] font-semibold';
  return 'text-[var(--color-primary)]';
}

/** 电量级别 → 电池图标组件（颜色与 batteryColorClass 同步）。
 *  额外的 class 会被合并到颜色 class 之后，便于调用方加 mr-1 / align-middle 等。 */
function BatteryIcon({ level, size = 20, class: cls = '' }: { level: number; size?: number; class?: string }) {
  const Icon = level < 20 ? BatteryLow : level < 50 ? BatteryMedium : BatteryFull;
  const colorCls =
    level < 20 ? 'text-[var(--color-danger)]'
      : level < 50 ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-success)]';
  return <Icon size={size} class={`${colorCls} ${cls}`.trim()} />;
}

function loadAutoRefresh(): boolean {
  try {
    return localStorage.getItem(AUTOREFRESH_KEY) === '1';
  } catch {
    return false;
  }
}

function saveAutoRefresh(on: boolean) {
  try {
    localStorage.setItem(AUTOREFRESH_KEY, on ? '1' : '0');
  } catch {
    /* 静默 */
  }
}

export function DeviceInfoPage({ device }: DeviceInfoPageProps) {
  const [info, setInfo] = useState<DeviceData | null>(null);
  const [ykStatus, setYkStatus] = useState<YkStatus | null>(null);
  const [ykError, setYkError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => loadAutoRefresh());
  const toast = useToast();
  // 区分初次加载与手动刷新：初次加载不弹 toast，避免页面进入即提示
  const isInitialMount = useRef(true);
  const mountedRef = useRef(true);
  // 持有最新的 fetchInfo，避免 effect 闭包捕获旧值
  const fetchInfoRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * 拉取设备信息。
   * @param silent 静默模式：不弹 toast（用于自动刷新）
   */
  const fetchInfo = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      if (!silent) setError('');
      try {
        const result = await api.getInfo();
        if (!mountedRef.current) return;
        if (result.code === '000001' && result.data) {
          setInfo(result.data as DeviceData);
          if (isInitialMount.current) {
            isInitialMount.current = false;
          } else if (!silent) {
            toast.success('设备信息已刷新');
          }
        } else {
          if (!silent) {
            setError(`获取失败: ${result.desc ?? '未知错误'}`);
            toast.error('获取设备信息失败', result.desc);
          }
        }
      } catch (e: unknown) {
        if (!mountedRef.current) return;
        if (!silent) {
          setError(errMsg(e) || '请求失败');
          toast.error('请求异常', errMsg(e));
        } else {
          console.warn('auto-refresh getInfo failed', e);
        }
      } finally {
        if (mountedRef.current && !silent) setLoading(false);
      }
    },
    [toast]
  );

  // 保持 fetchInfoRef 始终指向最新的 fetchInfo
  useEffect(() => {
    fetchInfoRef.current = fetchInfo;
  }, [fetchInfo]);

  /**
   * 拉取云控状态。
   * getyk 实际语义：用 response code 判云控状态，r.data 是点赞明细（不展示）。
   * @param silent 静默模式：不弹 toast（与 fetchInfo 行为一致）
   */
  const fetchYK = useCallback(async (silent = false) => {
    setYkError(false);
    try {
      const r = await api.getyk();
      if (!mountedRef.current) return;
      // 用 response code 判云控状态
      let text = '无法获取云控状态';
      let level: 'success' | 'warning' | 'danger' | 'info' = 'info';
      switch (r.code) {
        case '000001':
          text = '未云控';
          level = 'success';
          break;
        case '000007':
          text = '也许被云控';
          level = 'warning';
          break;
        case '000003':
          text = '设备信息未刷新，请刷新后重试';
          level = 'danger';
          break;
        default:
          text = `无法获取云控状态（${r.code}）`;
          level = 'info';
      }
      setYkStatus({ code: r.code, text, level });
      setYkError(false);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      // 不阻断主流程，仅记录失败状态供 UI 显示
      setYkError(true);
      console.warn('getyk failed', e);
      if (!silent) toast.error('云控状态获取失败', errMsg(e));
    }
  }, [toast]);

  useEffect(() => {
    if (device) {
      fetchInfo();
      fetchYK();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.watchid]);

  // 自动刷新 + visibilitychange 暂停
  useEffect(() => {
    if (!autoRefresh) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        // 页面不可见时跳过这次刷新（但保持 interval，等可见时再恢复）
        if (document.hidden) return;
        // 静默刷新
        fetchInfoRef.current(true).catch(() => {});
      }, AUTOREFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [autoRefresh]);

  const handleManualRefresh = () => fetchInfo(false);

  const toggleAutoRefresh = () => {
    const next = !autoRefresh;
    setAutoRefresh(next);
    saveAutoRefresh(next);
    toast.info(next ? '已开启自动刷新（每 60 秒）' : '已关闭自动刷新');
  };

  /** 导出设备信息 + 云控状态为 JSON 到剪贴板 */
  const handleExport = async () => {
    if (!info) {
      toast.warning('暂无设备信息可导出');
      return;
    }
    const ok = await confirm({
      title: '导出设备信息',
      message: '将把当前设备信息与云控状态以 JSON 格式复制到剪贴板，确认继续？',
      confirmText: '复制',
    });
    if (!ok) return;

    const payload = {
      exported_at: new Date().toISOString(),
      device: device ?? null,
      info,
      yk_status: ykStatus ?? null,
    };

    let text: string;
    try {
      text = JSON.stringify(payload, null, 2);
    } catch (e: unknown) {
      toast.error('序列化失败', errMsg(e));
      return;
    }

    let copied = false;
    // 优先走现代 Clipboard API
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (e) {
      console.warn('clipboard API failed, fallback', e);
    }
    // fallback: execCommand('copy')
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        const ok2 = document.execCommand('copy');
        document.body.removeChild(ta);
        copied = ok2;
      } catch (e) {
        console.warn('execCommand copy failed', e);
      }
    }

    if (copied) {
      toast.success('设备信息已复制到剪贴板', `${text.length} 字节`);
    } else {
      toast.error('复制失败', '请检查浏览器剪贴板权限或手动复制');
    }
  };

  if (!device) {
    return (
      <EmptyState
        icon={<Link2 size={48} />}
        title="尚未绑定设备"
        desc="请前往设置页面绑定您的手表设备"
      />
    );
  }

  // 电量派生数据
  const battery = info?.battery;
  const lowBattery = typeof battery === 'number' && battery < 20;
  // 在线态：getyk 不再提供 online/lastSeen 字段（r.data 是点赞明细），
  // 仅使用 info.watchOnline 作为唯一来源
  const watchOnline = info?.watchOnline ?? false;

  return (
    <div class="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="设备信息"
        desc="查看手表当前状态、电量、机型等信息"
        actions={
          <>
            <button
              type="button"
              class={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`}
              onClick={toggleAutoRefresh}
              aria-pressed={autoRefresh}
              aria-label={autoRefresh ? '关闭自动刷新' : '开启自动刷新'}
              title={autoRefresh ? '自动刷新已开启（每 60 秒）' : '开启自动刷新（每 60 秒）'}
            >
              <RefreshCw size={14} class={autoRefresh ? 'animate-spin' : ''} aria-hidden="true" />
              <span class="ml-1">自动刷新</span>
            </button>
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={!info}>
              <ClipboardCopy size={14} aria-hidden="true" />
              <span class="ml-1">导出</span>
            </Button>
            <Button variant="primary" onClick={handleManualRefresh} loading={loading}>
              刷新
            </Button>
          </>
        }
      />

      {error && <Alert level="danger">{error}</Alert>}
      {lowBattery && (
        <Alert level="warning">
          <strong>电量较低</strong>，建议及时充电以避免手表关机。
        </Alert>
      )}

      {loading && !info ? (
        <div class="grid grid-cols-2 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} class="card card-compact">
              <Skeleton width="40%" height={12} />
              <div class="mt-2">
                <Skeleton height={18} />
              </div>
            </div>
          ))}
        </div>
      ) : info ? (
        <>
          {/* 设备摘要卡片 */}
          <div class="card bg-gradient-to-br from-[var(--color-primary-bg)] to-[var(--color-surface)]">
            <div class="flex flex-wrap items-center gap-4">
              <div class="text-[var(--color-primary)]" aria-hidden="true">
                <Watch size={64} />
              </div>
              <div class="flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xl font-semibold">{info.name}</h2>
                  {watchOnline ? (
                    <Badge level="success">
                      <span class="inline-flex items-center gap-1">
                        <CircleDot size={10} aria-hidden="true" />
                        在线中
                      </span>
                    </Badge>
                  ) : (
                    <Badge level="gray">
                      <span class="inline-flex items-center gap-1">
                        <Circle size={10} aria-hidden="true" />
                        离线
                      </span>
                    </Badge>
                  )}
                </div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">
                  {info.model} {info.innerModel !== info.model ? `(${info.innerModel})` : ''} · 固件 {info.firmware}
                </div>
              </div>
              <div class="text-right" aria-label={`电量 ${info.battery}%`}>
                <div class={`text-3xl ${batteryColorClass(info.battery)}`}>
                  <BatteryIcon level={info.battery} size={24} class="mr-1 inline-block align-middle" />
                  {info.battery}%
                </div>
                <div class="text-xs text-[var(--color-text-muted)]">电量</div>
              </div>
            </div>
          </div>

          {/* 详细字段 */}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InfoItem label="手表名称" value={info.name} />
            <InfoItem label="机型" value={`${info.model} (${info.innerModel})`} />
            <InfoItem label="Watch ID" value={info.id} mono />
            <InfoItem label="IM Account ID" value={info.imAccountInfo?.imAccountId ?? '-'} mono />
            <InfoItem label="系统版本" value={info.firmware} />
            <InfoItem label="语言" value={info.language || '-'} />
            <InfoItem label="属地" value={info.pushProvince || '-'} />
            <InfoItem
              label="低电量保护"
              value={
                <Badge level={info.powerLowProtectSwitch ? 'success' : 'gray'}>
                  {info.powerLowProtectSwitch ? '已开启' : '已关闭'}
                </Badge>
              }
            />
            <InfoItem
              label="电量"
              value={
                <span class={batteryColorClass(info.battery)}>
                  <BatteryIcon level={info.battery} size={14} class="mr-1 inline-block align-middle" />
                  {info.battery}%
                </span>
              }
            />
            <InfoItem
              label="在线状态"
              value={
                watchOnline ? (
                  <Badge level="success">在线中</Badge>
                ) : (
                  <Badge level="gray">离线</Badge>
                )
              }
            />
          </div>

          {/* 云控状态 — getyk 实际用 response code 判云控，r.data 是点赞明细（不展示） */}
          <div class="card">
            <h3 class="mb-3 font-semibold">云控状态 (getyk)</h3>
            {ykStatus ? (
              <div class="space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm text-[var(--color-text-muted)]">云控状态</span>
                  <Badge level={ykStatus.level}>{ykStatus.text}</Badge>
                </div>
                <div class="text-xs text-[var(--color-text-light)]">
                  响应码：<code class="font-mono">{ykStatus.code}</code>
                </div>
                {ykStatus.level === 'danger' && (
                  <div class="text-xs text-[var(--color-danger)]">
                    提示：请点击右上角"刷新"按钮重新拉取设备信息后再查询云控状态。
                  </div>
                )}
              </div>
            ) : ykError ? (
              <div class="py-3 text-xs text-[var(--color-text-muted)]">
                云控状态获取失败，请稍后重试
              </div>
            ) : (
              <div class="py-3">
                <Skeleton width="60%" height={14} />
              </div>
            )}
          </div>

          {/* 本地绑定信息 */}
          <div class="card">
            <h3 class="mb-3 font-semibold">本地绑定信息</h3>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <InfoItem label="chipid" value={device.chipid} mono />
              <InfoItem label="bindnumber" value={device.bindnumber} mono />
              <InfoItem label="绑定时间" value={device.bound_at || '-'} />
              <InfoItem label="imaccountid" value={device.imaccountid || '-'} mono />
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<RefreshCw size={48} />}
          title="点击刷新按钮获取设备信息"
          desc="将从 okii.com 拉取手表最新状态"
          action={
            <Button variant="primary" onClick={handleManualRefresh} loading={loading}>
              立即获取
            </Button>
          }
        />
      )}
    </div>
  );
}

function InfoItem({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div class="card card-compact">
      <div class="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div class={`mt-1 font-medium ${mono ? 'text-mono text-xs break-all' : ''}`}>
        {value === undefined || value === null || value === '' ? '-' : value}
      </div>
    </div>
  );
}
