import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api } from '../lib/pyapi';
import { PageHeader, Button, Alert, EmptyState, Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDevice } from '../lib/useDevice';
import type { LucideIcon } from '../lib/icons';
import {
  Activity, Timer, Dumbbell, BarChart3,
  Link2, Check, X, BookOpen, RotateCcw,
} from '../lib/icons';

type Tab = 'step' | 'fifty' | 'rope' | 'bm';

interface TabDef {
  id: Tab;
  label: string;
  icon: LucideIcon;
  unit: string;
  placeholder: string;
  min: number;
  max: number;
  hint: string;
  /** 详细说明（折叠区内容） */
  explanation: string;
}

const TABS: TabDef[] = [
  {
    id: 'step',
    label: '步数',
    icon: Activity,
    unit: '步',
    placeholder: '如 10000',
    min: 0,
    max: 98799,
    hint: '建议范围 0-98799 步',
    explanation:
      '步数会通过 sport.watch.okii.com 接口上传到云端并同步到手表运动记录。修改后手表 App 的"今日步数"会立即更新，历史运动记录也可能受影响。频繁修改可能触发服务端风控，建议两次提交间隔 5 分钟以上。',
  },
  // 五十米跑最小取 3s（世界纪录约 5.5s），避免误输入 0/1 这种无意义值
  {
    id: 'fifty',
    label: '50米跑',
    icon: Timer,
    unit: '秒',
    placeholder: '如 8.5（秒）',
    min: 3,
    max: 60,
    hint: '完成 50 米跑所需秒数（3-60）',
    explanation:
      '50 米跑成绩会作为一次运动记录上传到手表的运动 App，体现为一次"短跑"项目。数值越小代表成绩越好，请按真实成绩填写。',
  },
  // 跳绳最小取 1，0 没有意义
  {
    id: 'rope',
    label: '跳绳',
    icon: Dumbbell,
    unit: '个',
    placeholder: '如 100',
    min: 1,
    max: 9999,
    hint: '一分钟跳绳次数（1-9999）',
    explanation:
      '跳绳次数会作为一次"跳绳"运动项目记录到手表的运动 App。请输入一分钟内实际完成的次数。',
  },
  {
    id: 'bm',
    label: 'BMI',
    icon: BarChart3,
    unit: '',
    placeholder: '',
    min: 10,
    max: 50,
    hint: '由身高/体重自动计算，公式 BMI = 体重 / (身高/100)²',
    explanation:
      'BMI（身体质量指数）= 体重(kg) / (身高(m))²。该值会更新到手表的健康数据展示页，影响健康评分等展示项。参考范围：18.5 以下偏瘦，18.5-24 正常，24-28 偏胖，28 以上肥胖。',
  },
];

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface SportHistoryItem {
  tab: Tab;
  value: string;
  /** 用于展示的标签，如 "10000 步" / "BMI 22.5" */
  label: string;
  ts: number;
}

const HISTORY_KEY = 'imoo_sport_history';
const HISTORY_MAX = 5;

function loadHistory(): SportHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 仅保留结构合法的项
    return parsed
      .filter(
        (it): it is SportHistoryItem =>
          it &&
          typeof it.tab === 'string' &&
          typeof it.value === 'string' &&
          typeof it.label === 'string' &&
          typeof it.ts === 'number'
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(items: SportHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    /* localStorage 不可用（隐私模式）时静默降级 */
  }
}

/** 将时间戳格式化为 HH:MM:SS */
function fmtTime(ts: number): string {
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '';
  }
}

interface SuccessBanner {
  text: string;
  ts: number;
}

export function SportPage() {
  const device = useDevice();
  const [tab, setTab] = useState<Tab>('step');
  // 每个 Tab 独立保存输入值，切换 Tab 不清空
  const [values, setValues] = useState<Record<Tab, string>>({ step: '', fifty: '', rope: '', bm: '' });
  const [errors, setErrors] = useState<Record<Tab, string>>({ step: '', fifty: '', rope: '', bm: '' });
  // BMI 专用：身高/体重，自动计算 BMI 值
  const [bmHeight, setBmHeight] = useState('');
  const [bmWeight, setBmWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const mountedRef = useRef(true);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 历史记录
  const [history, setHistory] = useState<SportHistoryItem[]>(() => loadHistory());
  // 历史筛选 Tab：'all' 或具体 tab
  const [historyFilter, setHistoryFilter] = useState<Tab | 'all'>('all');
  // 顶部成功 banner
  const [successBanner, setSuccessBanner] = useState<SuccessBanner | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, []);

  /** 显示成功 banner，3 秒后自动消失 */
  const showSuccessBanner = (text: string) => {
    if (!mountedRef.current) return;
    setSuccessBanner({ text, ts: Date.now() });
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setSuccessBanner(null);
      successTimerRef.current = null;
    }, 3000);
  };

  const dismissSuccessBanner = () => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setSuccessBanner(null);
  };

  if (!device) {
    return <EmptyState icon={<Link2 size={48} />} title="尚未绑定设备" desc="请先在设置中绑定设备" />;
  }

  const currentTab = TABS.find((t) => t.id === tab)!;
  const currentValue = values[tab];

  // 实时计算 BMI（双输入场景）
  const computedBmi = (() => {
    const h = Number(bmHeight);
    const w = Number(bmWeight);
    if (!h || !w || h <= 0) return null;
    return w / Math.pow(h / 100, 2);
  })();

  const setFieldValue = (v: string) => {
    setValues((prev) => ({ ...prev, [tab]: v }));
    setErrors((prev) => ({ ...prev, [tab]: '' }));
  };

  /** 把当前提交成功的内容追加到历史记录 */
  const pushHistory = (item: SportHistoryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  };

  /** 重发：直接用历史值重新提交，逻辑与对应 tab 的提交一致 */
  const handleResubmit = async (item: SportHistoryItem) => {
    if (loading) return;
    // 切到对应 Tab，让用户看到上下文
    setTab(item.tab);
    const def = TABS.find((t) => t.id === item.tab)!;
    setLoading(true);
    try {
      let r;
      if (item.tab === 'bm') {
        r = await api.sport_bm(item.value);
      } else if (item.tab === 'step') {
        r = await api.step(Number(item.value));
      } else if (item.tab === 'fifty') {
        r = await api.sport_fifty(item.value);
      } else {
        r = await api.sport_rope(Number(item.value));
      }
      if (!mountedRef.current) return;
      if (r?.code === '000001') {
        const label = item.tab === 'bm' ? `BMI ${item.value}` : `${item.value} ${def.unit}`.trim();
        toast.success(`${def.label} 已更新`, label);
        showSuccessBanner(`${def.label} 已更新到 ${label}`);
        pushHistory({ tab: item.tab, value: item.value, label, ts: Date.now() });
      } else {
        toast.error(`${def.label} 重发失败`, r?.desc);
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      toast.error('请求异常', errMsg(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleSubmit = async () => {
    const err = errors[tab];
    if (err) return;

    if (tab === 'bm') {
      // BMI 双输入校验
      const h = Number(bmHeight);
      const w = Number(bmWeight);
      if (!bmHeight.trim() || !bmWeight.trim() || Number.isNaN(h) || Number.isNaN(w)) {
        setErrors((prev) => ({ ...prev, bm: '请输入身高和体重' }));
        return;
      }
      if (h < 50 || h > 250) {
        setErrors((prev) => ({ ...prev, bm: '身高应在 50-250 cm' }));
        return;
      }
      if (w < 10 || w > 300) {
        setErrors((prev) => ({ ...prev, bm: '体重应在 10-300 kg' }));
        return;
      }
      if (computedBmi === null) {
        setErrors((prev) => ({ ...prev, bm: 'BMI 计算失败' }));
        return;
      }
      const bmiValue = computedBmi;
      const bmiStr = bmiValue.toFixed(1);
      setLoading(true);
      try {
        const r = await api.sport_bm(bmiStr);
        if (!mountedRef.current) return;
        if (r?.code === '000001') {
          const label = `BMI ${bmiStr}`;
          toast.success('BMI 已更新', `BMI = ${bmiStr}`);
          showSuccessBanner(`BMI 已更新到 ${bmiStr}`);
          pushHistory({ tab: 'bm', value: bmiStr, label, ts: Date.now() });
          // 清空 BMI 输入
          setBmHeight('');
          setBmWeight('');
          setValues((prev) => ({ ...prev, bm: '' }));
        } else {
          setErrors((prev) => ({ ...prev, bm: `提交失败: ${r?.desc ?? '未知错误'}` }));
          toast.error('BMI 提交失败', r?.desc);
        }
      } catch (e: unknown) {
        if (!mountedRef.current) return;
        setErrors((prev) => ({ ...prev, bm: errMsg(e) }));
        toast.error('请求异常', errMsg(e));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
      return;
    }

    // 单输入 Tab
    const v = currentValue.trim();
    if (!v) {
      setErrors((prev) => ({ ...prev, [tab]: '请输入数值' }));
      return;
    }
    const num = Number(v);
    if (Number.isNaN(num)) {
      setErrors((prev) => ({ ...prev, [tab]: '请输入有效数字' }));
      return;
    }
    if (num < currentTab.min || num > currentTab.max) {
      setErrors((prev) => ({ ...prev, [tab]: `数值应在 ${currentTab.min} - ${currentTab.max} 范围内` }));
      return;
    }

    setLoading(true);
    try {
      let r;
      let submittedValue = v;
      switch (tab) {
        case 'step': {
          // 步数需为整数；若用户输入小数，向下取整并提示
          let n = num;
          if (!Number.isInteger(n)) {
            toast.info('步数已向下取整');
            n = Math.floor(n);
            submittedValue = String(n);
          }
          r = await api.step(n);
          break;
        }
        case 'fifty':
          r = await api.sport_fifty(num.toString());
          submittedValue = num.toString();
          break;
        case 'rope': {
          // 跳绳次数同样需为整数
          let n = num;
          if (!Number.isInteger(n)) {
            toast.info('跳绳次数已向下取整');
            n = Math.floor(n);
            submittedValue = String(n);
          }
          r = await api.sport_rope(n);
          break;
        }
        default:
          return;
      }
      if (!mountedRef.current) return;
      if (r?.code === '000001') {
        const label = `${submittedValue} ${currentTab.unit}`.trim();
        toast.success(`${currentTab.label} 已更新`, `数值：${submittedValue}${currentTab.unit}`);
        showSuccessBanner(`${currentTab.label} 已更新到 ${label}`);
        pushHistory({ tab, value: submittedValue, label, ts: Date.now() });
        setValues((prev) => ({ ...prev, [tab]: '' }));
      } else {
        setErrors((prev) => ({ ...prev, [tab]: `提交失败: ${r?.desc ?? '未知错误'}` }));
        toast.error(`${currentTab.label} 提交失败`, r?.desc);
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setErrors((prev) => ({ ...prev, [tab]: errMsg(e) }));
      toast.error('请求异常', errMsg(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleReset = () => {
    if (tab === 'bm') {
      setBmHeight('');
      setBmWeight('');
    }
    setValues((prev) => ({ ...prev, [tab]: '' }));
    setErrors((prev) => ({ ...prev, [tab]: '' }));
  };

  // 历史筛选
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return history;
    return history.filter((h) => h.tab === historyFilter);
  }, [history, historyFilter]);

  return (
    <div class="mx-auto max-w-2xl space-y-5">
      <PageHeader title="运动数据" desc="修改手表的运动数据：步数、50米跑、跳绳、BMI" />

      {/* 顶部成功 banner */}
      {successBanner && (
        <Alert level="success">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-1">
              <Check size={14} class="flex-none" aria-hidden="true" />
              <strong>{successBanner.text}</strong>
              <span class="ml-2 text-xs text-[var(--color-text-muted)]">{fmtTime(successBanner.ts)}</span>
            </div>
            <button
              class="text-[var(--color-text-light)] hover:text-[var(--color-text)]"
              onClick={dismissSuccessBanner}
              aria-label="关闭提示"
            >
              <X size={16} />
            </button>
          </div>
        </Alert>
      )}

      {/* Tab 切换 */}
      <div class="flex gap-2" role="tablist" aria-label="运动数据类型">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            class={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-3 py-2 transition-colors ${
              tab === t.id
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'
            }`}
          >
            <span class="inline-flex" aria-hidden="true"><t.icon size={22} /></span>
            <span class="text-xs font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div class="card space-y-4" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'bm' ? (
          // BMI 双输入
          <div class="space-y-3">
            <div>
              <label htmlFor="bm-height" class="label">
                身高
                <span class="ml-2 text-xs text-[var(--color-text-light)]">范围 50-250 cm</span>
              </label>
              <div class="flex gap-2">
                <input
                  id="bm-height"
                  type="number"
                  class="input"
                  value={bmHeight}
                  onInput={(e) => setBmHeight((e.target as HTMLInputElement).value)}
                  placeholder="如 170"
                  min={50}
                  max={250}
                  step="0.1"
                  inputMode="decimal"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !(e as KeyboardEvent).isComposing && e.keyCode !== 229) handleSubmit();
                  }}
                />
                <span class="flex items-center px-2 text-sm text-[var(--color-text-muted)]">cm</span>
              </div>
            </div>
            <div>
              <label htmlFor="bm-weight" class="label">
                体重
                <span class="ml-2 text-xs text-[var(--color-text-light)]">范围 10-300 kg</span>
              </label>
              <div class="flex gap-2">
                <input
                  id="bm-weight"
                  type="number"
                  class="input"
                  value={bmWeight}
                  onInput={(e) => setBmWeight((e.target as HTMLInputElement).value)}
                  placeholder="如 65"
                  min={10}
                  max={300}
                  step="0.1"
                  inputMode="decimal"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !(e as KeyboardEvent).isComposing && e.keyCode !== 229) handleSubmit();
                  }}
                />
                <span class="flex items-center px-2 text-sm text-[var(--color-text-muted)]">kg</span>
              </div>
            </div>
            <div class="rounded-lg bg-[var(--color-surface-2)] p-3 text-sm">
              {computedBmi !== null ? (
                <span>
                  计算 BMI = <span class="text-mono font-medium">{computedBmi.toFixed(1)}</span>
                  <span class="ml-2 text-xs text-[var(--color-text-muted)]">
                    ({computedBmi < 18.5 ? '偏瘦' : computedBmi < 24 ? '正常' : computedBmi < 28 ? '偏胖' : '肥胖'})
                  </span>
                </span>
              ) : (
                <span class="text-[var(--color-text-muted)]">填写身高和体重后自动计算</span>
              )}
            </div>
            <p class="text-xs text-[var(--color-text-muted)]">{currentTab.hint}</p>
          </div>
        ) : (
          // 单输入 Tab
          <div>
            <label htmlFor="sport-input" class="label">
              {currentTab.label}
              <span class="ml-2 text-xs text-[var(--color-text-light)]">
                范围 {currentTab.min} - {currentTab.max} {currentTab.unit}
              </span>
            </label>
            <div class="flex gap-2">
              <input
                id="sport-input"
                type="number"
                class="input"
                value={currentValue}
                onInput={(e) => setFieldValue((e.target as HTMLInputElement).value)}
                placeholder={currentTab.placeholder}
                min={currentTab.min}
                max={currentTab.max}
                step={tab === 'fifty' ? '0.1' : '1'}
                inputMode={tab === 'fifty' ? 'decimal' : 'numeric'}
                pattern={tab === 'fifty' ? '[0-9]*\\.?[0-9]*' : '[0-9]*'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !(e as KeyboardEvent).isComposing && e.keyCode !== 229) handleSubmit();
                }}
              />
              {currentTab.unit && (
                <span class="flex items-center px-2 text-sm text-[var(--color-text-muted)]">
                  {currentTab.unit}
                </span>
              )}
            </div>
            <p class="mt-1 text-xs text-[var(--color-text-muted)]">{currentTab.hint}</p>
          </div>
        )}

        {errors[tab] && <Alert level="danger">{errors[tab]}</Alert>}

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleReset} disabled={loading || (!currentValue && (tab !== 'bm' || (!bmHeight && !bmWeight)))}>
            重置
          </Button>
          <Button onClick={handleSubmit} loading={loading}>
            提交到手表
          </Button>
        </div>

        {/* 运动数据说明折叠区 */}
        <details class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
          <summary
            class="flex cursor-pointer items-center gap-1.5 font-medium text-[var(--color-text)]"
            aria-label={`展开${currentTab.label}说明`}
          >
            <BookOpen size={14} aria-hidden="true" />
            {currentTab.label} 说明
          </summary>
          <p class="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">{currentTab.explanation}</p>
        </details>
      </div>

      {/* 快捷预设 */}
      {tab === 'step' && (
        <div class="card">
          <h3 class="mb-2 font-medium">快捷预设</h3>
          <div class="flex flex-wrap gap-2">
            {[3000, 6000, 8000, 10000, 15000, 20000, 50000, 98799].map((v) => (
              <button
                key={v}
                class="badge badge-gray cursor-pointer hover:badge-info"
                onClick={() => setValues((prev) => ({ ...prev, step: String(v) }))}
              >
                {v.toLocaleString()} 步
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 最近提交历史 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">最近提交</h3>
          {history.length > 0 && (
            <div class="flex flex-wrap gap-1" role="group" aria-label="历史筛选">
              <FilterChip active={historyFilter === 'all'} onClick={() => setHistoryFilter('all')}>
                全部
              </FilterChip>
              {TABS.map((t) => {
                const count = history.filter((h) => h.tab === t.id).length;
                if (count === 0) return null;
                return (
                  <FilterChip key={t.id} active={historyFilter === t.id} onClick={() => setHistoryFilter(t.id)}>
                    {t.label}
                  </FilterChip>
                );
              })}
            </div>
          )}
        </div>
        {history.length === 0 ? (
          <p class="py-2 text-sm text-[var(--color-text-muted)]">暂无提交记录</p>
        ) : filteredHistory.length === 0 ? (
          <p class="py-2 text-sm text-[var(--color-text-muted)]">当前 Tab 暂无记录</p>
        ) : (
          <ul class="divide-y divide-[var(--color-border)]" aria-label="提交历史列表">
            {filteredHistory.map((item, idx) => {
              const def = TABS.find((t) => t.id === item.tab)!;
              return (
                <li key={`${item.ts}-${idx}`} class="flex items-center justify-between gap-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="inline-flex flex-none text-[var(--color-text-muted)]" aria-hidden="true">
                      <def.icon size={14} />
                    </span>
                    <span class="truncate text-sm font-medium">{item.label}</span>
                    <Badge level="gray">{def.label}</Badge>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-[var(--color-text-muted)]">{fmtTime(item.ts)}</span>
                    <button
                      class="btn btn-sm btn-ghost inline-flex items-center gap-1"
                      onClick={() => handleResubmit(item)}
                      disabled={loading}
                      aria-label={`重发 ${item.label}`}
                      title="重发"
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      重发
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Alert level="info">
        <strong>注意：</strong>运动数据修改后，手表 App 上的运动记录会同步更新。频繁修改可能触发风控，建议间隔 5 分钟以上。
      </Alert>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      class={`rounded-full px-3 py-1 text-xs transition-colors ${
        active
          ? 'bg-[var(--color-primary)] text-white'
          : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'
      }`}
    >
      {children}
    </button>
  );
}
