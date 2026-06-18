import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { api, cancelTask } from '../lib/pyapi';
import { PageHeader, Button, Alert, EmptyState, ProgressBar, Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDevice } from '../lib/useDevice';
import { confirm } from '../components/ui';
import { Link2, Check, X, CheckCircle2, ChevronUp, ChevronDown } from '../lib/icons';
import { copyText } from '../lib/clipboard';

// ===== 类型定义 =====

/** 单条进度事件 msg.detail 的结构（Task 4-A 增强后） */
interface LikeAllProgressDetail {
  friend: string;
  status: 'success' | 'error';
  error?: string | null;
  likes?: number;
}

/** 实时日志条目 */
interface LikeAllLogEntry {
  friend: string;
  status: 'success' | 'error';
  likes?: number;
  error?: string;
  ts: number;
}

/** task_done 返回的 JSON 结构 */
interface LikeAllResult {
  success: number;
  total: number;
  errors: number;
  cancelled: boolean;
  skipped?: number;
  /** 后端可选返回的失败详情；前端展示优先用日志（更全） */
  failedFriends?: Array<{ friend: string; error: string }>;
}

/** localStorage 中保存的历史项 */
interface LikeAllHistoryItem {
  ts: number;
  result: LikeAllResult;
}

// ===== 常量 =====
const HISTORY_KEY = 'imoo_likeall_history';
const TODAY_KEY = 'imoo_likeall_today';
const HISTORY_MAX = 5;
const MAX_LOGS = 100;

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ===== localStorage helpers =====
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getTodayCount(): number {
  try {
    const raw = localStorage.getItem(TODAY_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.date === todayStr()) return Number(parsed.count) || 0;
    return 0;
  } catch {
    return 0;
  }
}

function bumpTodayCount(): number {
  const count = getTodayCount() + 1;
  try {
    localStorage.setItem(TODAY_KEY, JSON.stringify({ date: todayStr(), count }));
  } catch {
    /* localStorage 不可用时静默降级 */
  }
  return count;
}

function loadHistory(): LikeAllHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (it): it is LikeAllHistoryItem =>
          it && typeof it.ts === 'number' && it.result && typeof it.result === 'object'
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(items: LikeAllHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

// ===== 工具函数 =====

/** 解析 task_progress 的 msg：可能是 JSON（{text, detail}）或纯文本 */
function parseProgressMsg(msg: string): { text: string; detail?: LikeAllProgressDetail } {
  if (!msg) return { text: '' };
  try {
    const parsed = JSON.parse(msg);
    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      return { text: parsed.text, detail: parsed.detail };
    }
  } catch {
    /* 不是 JSON，按纯文本处理 */
  }
  return { text: msg };
}

/** HH:MM:SS */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 历史 / 相对时间，今天/昨天/M/D HH:MM */
function fmtHistoryTime(ts: number): string {
  const d = new Date(ts);
  const today = todayStr();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dStr = d.toISOString().slice(0, 10);
  if (dStr === today) return `今天 ${time}`;
  const y = new Date(d);
  y.setDate(y.getDate() - 1);
  if (y.toISOString().slice(0, 10) === today) return `昨天 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/** 时长格式化：秒 / 分秒 */
function fmtDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 1) return '<1 秒';
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} 分 ${s} 秒`;
}

/** 速度格式化 */
function fmtSpeed(speed: number): string {
  if (!isFinite(speed) || speed <= 0) return '--';
  if (speed >= 10) return speed.toFixed(0);
  if (speed >= 1) return speed.toFixed(1);
  return speed.toFixed(2);
}

export function LikeAllPage() {
  const device = useDevice();
  const toast = useToast();

  // 任务执行状态
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<LikeAllResult | null>(null);

  // 实时日志
  const [logs, setLogs] = useState<LikeAllLogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // 单好友进度
  const [currentFriend, setCurrentFriend] = useState<string | null>(null);
  const [currentFriendLikes, setCurrentFriendLikes] = useState<number | null>(null);

  // 速度统计
  const startTimeRef = useRef<number>(0);
  const peakSpeedRef = useRef<number>(0);
  const [peakSpeed, setPeakSpeed] = useState(0);
  const [finalDuration, setFinalDuration] = useState(0);
  // 每秒 tick 一次以刷新 ETA
  const [nowTick, setNowTick] = useState(0);

  // 高级选项折叠
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 历史与今日次数
  const [todayCount, setTodayCount] = useState<number>(() => getTodayCount());
  const [history, setHistory] = useState<LikeAllHistoryItem[]>(() => loadHistory());

  // 引用：onDone 中读取最新进度（避免闭包过期）
  const currentRef = useRef(0);
  const totalRef = useRef(0);

  const taskIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // 卸载时清理：阻止后续 setState，并取消正在运行的任务
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (taskIdRef.current) {
        cancelTask(taskIdRef.current).catch(() => {});
        taskIdRef.current = null;
      }
    };
  }, []);

  // 日志自动滚到底
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs]);

  // 执行期间每秒 tick 一次以刷新 ETA
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // 派生：当前速度 / 剩余时间（nowTick 触发每秒刷新）
  const { speed, eta } = useMemo(() => {
    if (startTimeRef.current === 0 || current <= 0) {
      return { speed: 0, eta: 0 };
    }
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    if (elapsed <= 0) return { speed: 0, eta: 0 };
    const spd = current / elapsed;
    const remaining = Math.max(0, total - current);
    const e = spd > 0 ? remaining / spd : 0;
    return { speed: spd, eta: e };
    // nowTick 作为依赖以触发每秒刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, total, nowTick]);

  if (!device) {
    return <EmptyState icon={<Link2 size={48} />} title="尚未绑定设备" desc="请先在设置中绑定设备" />;
  }

  const handleStart = async () => {
    if (running || taskIdRef.current) return;  // 防双击并发
    const riskHigh = todayCount >= 1;
    const ok = await confirm({
      title: '开始批量点赞',
      message: riskHigh
        ? `今日已执行 ${todayCount} 次，频繁操作可能触发风控导致账号受限。仍然继续？`
        : '将为好友圈所有动态点赞。这可能需要几分钟时间，且无法撤销。确认开始？',
      confirmText: '开始',
      danger: riskHigh,
    });
    if (!ok) return;

    setRunning(true);
    setResult(null);
    setLogs([]);
    setCurrentFriend(null);
    setCurrentFriendLikes(null);
    setPeakSpeed(0);
    setFinalDuration(0);
    peakSpeedRef.current = 0;
    startTimeRef.current = 0;
    currentRef.current = 0;
    totalRef.current = 0;
    setCurrent(0);
    setTotal(0);
    setMsg('正在启动...');

    taskIdRef.current = await api.likeall({
      onProgress: (c, t, m) => {
        if (!mountedRef.current) return;
        // 首次进度：记录起始时间
        if (startTimeRef.current === 0 && c > 0) {
          startTimeRef.current = Date.now();
        }
        currentRef.current = c;
        totalRef.current = t;
        setCurrent(c);
        setTotal(t);
        setMsg(m);

        // 解析详情：单好友 + 日志
        const parsed = parseProgressMsg(m);
        if (parsed.detail) {
          const d = parsed.detail;
          setCurrentFriend(d.friend);
          if (typeof d.likes === 'number') {
            setCurrentFriendLikes(d.likes);
          }
          setLogs((prev) => {
            const entry: LikeAllLogEntry = {
              friend: d.friend,
              status: d.status,
              likes: typeof d.likes === 'number' ? d.likes : undefined,
              error: d.error ?? undefined,
              ts: Date.now(),
            };
            const next = [...prev, entry];
            if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
            return next;
          });
        }

        // 峰值速度
        if (startTimeRef.current > 0 && c > 0) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          if (elapsed > 0) {
            const spd = c / elapsed;
            if (spd > peakSpeedRef.current) {
              peakSpeedRef.current = spd;
              setPeakSpeed(spd);
            }
          }
        }
      },
      onDone: (success, doneMsg) => {
        if (!mountedRef.current) return;
        setRunning(false);
        taskIdRef.current = null;
        setCurrentFriend(null);
        setCurrentFriendLikes(null);

        // 记录总耗时
        if (startTimeRef.current > 0) {
          setFinalDuration((Date.now() - startTimeRef.current) / 1000);
        }

        let finalResult: LikeAllResult | null = null;

        if (success) {
          try {
            const r = JSON.parse(doneMsg) as LikeAllResult;
            finalResult = r;
            if (r.cancelled) {
              toast.warning('任务已取消', `已完成 ${r.success}/${r.total}`);
            } else {
              toast.success('批量点赞完成', `成功 ${r.success}/${r.total}，失败 ${r.errors}`);
            }
          } catch {
            toast.success('批量点赞完成', doneMsg);
          }
        } else {
          // 失败/取消：保留当前进度作为部分结果（用 ref 读取最新值，避免闭包过期）
          const cancelled = doneMsg === 'cancelled';
          const doneTotal = totalRef.current > 0 ? totalRef.current : currentRef.current;
          const doneSuccess = cancelled ? currentRef.current : 0;
          finalResult = {
            success: doneSuccess,
            total: doneTotal,
            errors: Math.max(0, doneTotal - doneSuccess),
            cancelled,
          };
          if (cancelled) {
            toast.warning('任务已取消', `已完成 ${doneSuccess}/${doneTotal}`);
          } else {
            toast.error('批量点赞失败', doneMsg);
          }
        }

        setResult(finalResult);

        // 写入历史 + 今日次数（只要有实际进度）
        if (finalResult && (finalResult.success > 0 || finalResult.errors > 0)) {
          setHistory((prev) => {
            const newHistory = [
              { ts: Date.now(), result: finalResult! },
              ...prev,
            ].slice(0, HISTORY_MAX) as LikeAllHistoryItem[];
            saveHistory(newHistory);
            return newHistory;
          });
          const newCount = bumpTodayCount();
          setTodayCount(newCount);
        }
      },
    });
  };

  const handleCancel = async () => {
    if (taskIdRef.current) {
      try {
        await cancelTask(taskIdRef.current);
        toast.info('已请求取消任务');
      } catch (e: unknown) {
        toast.error('取消失败', errMsg(e));
      }
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleClearHistory = () => {
    setHistory([]);
    saveHistory([]);
    toast.info('历史已清空');
  };

  const handleExport = async () => {
    if (!result) return;
    const failedFromLogs = logs
      .filter((l) => l.status === 'error')
      .map((l) => ({ friend: l.friend, error: l.error || '未知错误' }));
    const exportData = {
      exportedAt: new Date().toISOString(),
      result,
      failedFriends: result.failedFriends?.length ? result.failedFriends : failedFromLogs,
      peakSpeed: peakSpeed > 0 ? Number(peakSpeed.toFixed(3)) : null,
      durationSec: finalDuration > 0 ? Number(finalDuration.toFixed(1)) : null,
      logs,
    };
    const json = JSON.stringify(exportData, null, 2);
    const ok = await copyText(json);
    if (ok) {
      toast.success('已复制', '结果 JSON 已复制到剪贴板');
    } else {
      toast.error('复制失败', '请检查浏览器剪贴板权限或手动复制');
    }
  };

  // ===== 派生展示数据 =====
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const failedFriends = logs
    .filter((l) => l.status === 'error')
    .map((l) => ({ friend: l.friend, error: l.error || '未知错误' }));
  const successCount = logs.filter((l) => l.status === 'success').length;
  const errorCount = logs.filter((l) => l.status === 'error').length;
  const riskHigh = todayCount >= 1;

  return (
    <div class="mx-auto max-w-2xl space-y-5">
      <PageHeader title="批量点赞" desc="一键给好友圈所有动态点赞" />

      {/* 风险提示（含今日执行次数） */}
      <Alert level={riskHigh ? 'danger' : 'warning'}>
        <div>
          <strong>风险提示：</strong>
          {riskHigh ? (
            <>
              今日已执行 <strong>{todayCount}</strong> 次，频繁批量点赞极易触发风控导致账号受限。
              <strong>建议明天再试。</strong>
            </>
          ) : (
            <>
              频繁批量点赞可能被风控系统识别为异常行为，导致账号暂时受限。建议每天执行不超过 1 次。
            </>
          )}
        </div>
      </Alert>

      {/* 控制区卡片 */}
      <div class="card space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">任务状态</h3>
            <p class="text-xs text-[var(--color-text-muted)]">
              {running ? '正在执行...' : result ? '已完成' : '未启动'}
            </p>
          </div>
          <div class="flex gap-2">
            {running ? (
              <Button variant="danger" onClick={handleCancel}>
                取消任务
              </Button>
            ) : (
              <Button onClick={handleStart}>开始点赞</Button>
            )}
          </div>
        </div>

        {/* 进度条 */}
        {(running || result) && total > 0 && (
          <div class="space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-truncate max-w-[60%]">
                {msg || (running ? '执行中...' : '完成')}
              </span>
              <span class="text-mono">
                {current} / {total} ({pct}%)
              </span>
            </div>
            <ProgressBar value={current} max={total} />

            {/* 单好友进度 + 速度 + ETA + 峰值 */}
            {running && (
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                {currentFriend && (
                  <span>
                    当前：<strong class="text-[var(--color-text)]">{currentFriend}</strong>
                    {currentFriendLikes !== null && (
                      <span class="ml-1">· 已点赞 {currentFriendLikes} 次</span>
                    )}
                  </span>
                )}
                {speed > 0 && (
                  <span>
                    · 速度{' '}
                    <strong class="text-mono text-[var(--color-info)]">{fmtSpeed(speed)}</strong>{' '}
                    好友/秒
                  </span>
                )}
                {eta > 0 && <span>· 预估剩余 {fmtDuration(eta)}</span>}
                {peakSpeed > 0 && <span>· 峰值 {fmtSpeed(peakSpeed)}</span>}
              </div>
            )}
          </div>
        )}

        {/* 实时日志 */}
        {(running || logs.length > 0) && (
          <div class="space-y-2 border-t border-[var(--color-border)] pt-3">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-medium">
                实时日志
                <span class="ml-1 text-xs text-[var(--color-text-muted)]">({logs.length})</span>
              </h4>
              <div class="flex items-center gap-3 text-xs">
                <span class="inline-flex items-center gap-1 text-[var(--color-success)]">
                  <Check size={14} /> {successCount}
                </span>
                <span class="inline-flex items-center gap-1 text-[var(--color-danger)]">
                  <X size={14} /> {errorCount}
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onClick={handleClearLogs}
                  disabled={logs.length === 0}
                >
                  清空
                </button>
              </div>
            </div>
            <div class="max-h-64 overflow-y-auto rounded bg-[var(--color-surface-2)] p-2">
              {logs.length === 0 ? (
                <div class="py-6 text-center text-xs text-[var(--color-text-light)]">
                  {running ? '等待进度事件...' : '暂无日志'}
                </div>
              ) : (
                <ul class="space-y-0.5 text-xs">
                  {logs.map((l, i) => (
                    <li
                      key={`${l.ts}-${i}`}
                      class="flex items-center gap-2 rounded px-1 py-0.5 font-mono"
                    >
                      <span
                        class={
                          l.status === 'success'
                            ? 'text-[var(--color-success)]'
                            : 'text-[var(--color-danger)]'
                        }
                      >
                        {l.status === 'success' ? <Check size={12} /> : <X size={12} />}
                      </span>
                      <span class="max-w-[6rem] truncate font-medium text-[var(--color-text)]">
                        {l.friend}
                      </span>
                      <span class="text-[var(--color-text-light)]">·</span>
                      <span class="truncate text-[var(--color-text-muted)]">
                        {l.status === 'success'
                          ? `${l.likes ?? '?'} 赞`
                          : l.error || '未知错误'}
                      </span>
                      <span class="ml-auto text-[var(--color-text-light)]">{fmtClock(l.ts)}</span>
                    </li>
                  ))}
                  <div ref={logEndRef} />
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 结果统计卡片 */}
      {result && (
        <div class="card space-y-3">
          <div class="grid grid-cols-3 gap-3">
            <StatCard label="成功" value={result.success} level="success" />
            <StatCard
              label="失败"
              value={result.errors}
              level={result.errors > 0 ? 'danger' : 'gray'}
            />
            <StatCard label="总计" value={result.total} level="info" />
          </div>

          <div class="flex items-center justify-between rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm">
            <span>执行状态</span>
            <Badge level={result.cancelled ? 'warning' : 'success'}>
              <span class="inline-flex items-center gap-1">
                {result.cancelled ? '已取消' : (
                  <>
                    正常完成 <CheckCircle2 size={14} />
                  </>
                )}
              </span>
            </Badge>
          </div>

          {/* 性能数据：峰值速度 / 总耗时 */}
          {(peakSpeed > 0 || finalDuration > 0) && (
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              {finalDuration > 0 && <span>总耗时 {fmtDuration(finalDuration)}</span>}
              {peakSpeed > 0 && (
                <span>
                  峰值速度{' '}
                  <strong class="text-mono text-[var(--color-info)]">{fmtSpeed(peakSpeed)}</strong>{' '}
                  好友/秒
                </span>
              )}
              {typeof result.skipped === 'number' && result.skipped > 0 && (
                <span>跳过 {result.skipped}</span>
              )}
            </div>
          )}

          <div class="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={handleExport}>
              导出结果
            </Button>
          </div>

          {result.cancelled && (
            <Alert level="warning">
              <strong>已取消：</strong>任务在执行过程中被用户中断，已完成部分点赞。
            </Alert>
          )}
        </div>
      )}

      {/* 失败详情卡片 */}
      {result && failedFriends.length > 0 && (
        <div class="card space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="font-medium">失败详情</h3>
            <Badge level="danger">{failedFriends.length}</Badge>
          </div>
          <ul class="space-y-1">
            {failedFriends.map((f, i) => (
              <li key={i} class="flex items-start gap-2 text-sm">
                <span class="mt-0.5 text-[var(--color-danger)]"><X size={14} /></span>
                <span class="min-w-0 flex-1">
                  <strong class="text-[var(--color-text)]">{f.friend}</strong>
                  <span class="text-[var(--color-text-muted)]">：</span>
                  <span class="text-[var(--color-danger-text)]">{f.error}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 历史记录卡片 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">历史记录</h3>
          {history.length > 0 && (
            <button type="button" class="btn btn-ghost btn-sm" onClick={handleClearHistory}>
              清空历史
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p class="text-xs text-[var(--color-text-muted)]">暂无历史记录</p>
        ) : (
          <ul class="space-y-1.5 text-sm">
            {history.map((h, i) => (
              <li
                key={i}
                class="flex items-center gap-2 rounded bg-[var(--color-surface-2)] px-3 py-2"
              >
                <span class="w-28 text-xs text-[var(--color-text-muted)]">
                  {fmtHistoryTime(h.ts)}
                </span>
                <span class="text-mono">
                  <span class="text-[var(--color-success)]">{h.result.success}</span>
                  <span class="text-[var(--color-text-muted)]"> / {h.result.total}</span>
                </span>
                <span class="text-[var(--color-text-muted)]">成功</span>
                <span class="ml-auto">
                  <Badge level={h.result.cancelled ? 'warning' : 'success'}>
                    {h.result.cancelled ? '已取消' : '正常完成'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 高级选项（折叠） */}
      <div class="card">
        <button
          type="button"
          class="flex w-full items-center justify-between text-left"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          <span class="font-medium">高级选项</span>
          <span class="text-[var(--color-text-muted)] flex items-center">
            {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>
        {showAdvanced && (
          <div class="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-text-muted)]">
            <div>
              <strong class="text-[var(--color-text)]">点赞间隔：</strong>
              每个点赞间隔 <span class="text-mono">0.6-0.9</span> 秒（由后端控制，防止风控）。
            </div>
            <div>
              <strong class="text-[var(--color-text)]">单好友次数：</strong>
              每位好友点赞 20 次，全部好友共约{' '}
              <span class="text-mono">20 × N</span> 次 HTTP 请求。
            </div>
            <div class="text-xs text-[var(--color-text-light)]">
              注：前端不直接控制间隔参数，此处信息仅供了解后端行为。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  level,
}: {
  label: string;
  value: number;
  level: 'success' | 'danger' | 'info' | 'gray';
}) {
  return (
    <div
      class={`rounded-lg p-3 text-center ${
        level === 'success'
          ? 'bg-[var(--color-success-bg)]'
          : level === 'danger'
            ? 'bg-[var(--color-danger-bg)]'
            : level === 'info'
              ? 'bg-[var(--color-info-bg)]'
              : 'bg-[var(--color-surface-2)]'
      }`}
    >
      <div
        class={`text-2xl font-bold ${
          level === 'success'
            ? 'text-[var(--color-success)]'
            : level === 'danger'
              ? 'text-[var(--color-danger)]'
              : level === 'info'
                ? 'text-[var(--color-info)]'
                : 'text-[var(--color-text-muted)]'
        }`}
      >
        {value}
      </div>
      <div class="text-xs text-[var(--color-text-muted)]">{label}</div>
    </div>
  );
}
