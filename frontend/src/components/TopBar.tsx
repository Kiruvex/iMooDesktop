import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { onLogMessage } from '../lib/pyapi';
import { THEMES, THEME_META, type Theme } from '../lib/useTheme';
import { Menu, ScrollText } from '../lib/icons';

interface TopBarProps {
  version: string;
  deviceBound: boolean;
  deviceName?: string;
  /** 当前主题（light / dark / system） */
  theme?: Theme;
  /** 切换主题回调 */
  onThemeChange?: (t: Theme) => void;
  /** 移动端汉堡按钮回调（打开 sidebar 抽屉） */
  onMenuClick?: () => void;
}

interface LogEntry {
  level: string;
  msg: string;
  ts: number;
}

/**
 * ThemeToggle - 三段式主题切换按钮
 *
 * 浅色 / 深色 / 跟随系统 三段，当前选中段高亮为蓝色背景。
 * 移动端窄屏时仅显示图标。
 */
function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div
      class="flex items-center gap-0.5 rounded-lg bg-[var(--color-surface-2)] p-0.5"
      role="group"
      aria-label="主题切换"
    >
      {THEMES.map((t) => {
        const meta = THEME_META[t];
        const Icon = meta.icon;
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            aria-pressed={active}
            title={meta.title}
            aria-label={meta.title}
            class={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition-all ${
              active
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
            }`}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function TopBar({
  version,
  deviceBound,
  deviceName,
  theme = 'system',
  onThemeChange,
  onMenuClick,
}: TopBarProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  // 用于外部点击检测：toggle 按钮 + 面板容器
  const logToggleRef = useRef<HTMLButtonElement | null>(null);
  const logPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return onLogMessage((level, msg) => {
      setLogs((prev) => [
        ...prev.slice(-49),
        { level, msg, ts: Date.now() },
      ]);
    });
  }, []);

  // ESC 关闭 + 外部点击关闭
  useEffect(() => {
    if (!showLogs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowLogs(false);
      }
    };
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // 点击 toggle 按钮自身：交给按钮的 onClick 切换，不在这里二次处理
      if (logToggleRef.current?.contains(target)) return;
      // 点击面板内部：忽略
      if (logPanelRef.current?.contains(target)) return;
      // 其余视为外部点击 → 关闭
      setShowLogs(false);
    };
    window.addEventListener('keydown', onKey);
    // 用 setTimeout 延迟一帧注册 click，避免与打开按钮的 click 同一事件冒泡触发关闭
    const t = setTimeout(() => {
      document.addEventListener('click', onDocClick);
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      document.removeEventListener('click', onDocClick);
    };
  }, [showLogs]);

  const toggleLogs = useCallback(() => setShowLogs((v) => !v), []);

  return (
    <header
      class="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-white/80 px-4 backdrop-blur-md dark:bg-[#131c2e]/80 md:px-6"
    >
      <div class="flex items-center gap-2 text-sm md:gap-3">
        {/* 移动端汉堡按钮 */}
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="打开菜单"
            class="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] md:hidden"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        )}
        {/* 设备状态指示：圆点 + 文字 */}
        <span
          class={`inline-block h-2 w-2 rounded-full transition-colors ${
            deviceBound
              ? 'bg-[var(--color-success)] shadow-[0_0_0_3px_rgba(16,185,129,0.18)]'
              : 'bg-[var(--color-text-light)]'
          }`}
          title={deviceBound ? '设备已绑定' : '未绑定设备'}
          aria-hidden="true"
        />
        <span class="hidden text-[var(--color-text-muted)] sm:inline">
          {deviceBound ? `已绑定${deviceName ? ` · ${deviceName}` : ''}` : '未绑定设备'}
        </span>
        <span class="text-[var(--color-text-muted)] sm:hidden">
          {deviceBound ? '已绑定' : '未绑定'}
        </span>
      </div>

      <div class="flex items-center gap-2 md:gap-3">
        {/* 主题切换（仅当 App 提供回调时显示） */}
        {onThemeChange && <ThemeToggle theme={theme} onChange={onThemeChange} />}
        <button
          ref={logToggleRef}
          class="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          onClick={toggleLogs}
          aria-label={`Python 日志（${logs.length} 条）${showLogs ? '，已展开' : ''}`}
          aria-expanded={showLogs}
          title="Python 日志"
        >
          <ScrollText size={16} aria-hidden="true" />
          {logs.length > 0 && (
            <span class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[9px] font-bold text-white shadow-sm ring-2 ring-[var(--color-surface)]">
              {logs.length > 99 ? '99+' : logs.length}
            </span>
          )}
        </button>
        <div class="hidden text-xs text-[var(--color-text-light)] sm:block">{version}</div>
      </div>

      {showLogs && (
        <div
          ref={logPanelRef}
          class="absolute right-4 top-14 z-50 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
          style={{ boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 8px rgba(15, 23, 42, 0.06)' }}
          role="region"
          aria-label="Python 日志"
        >
          <div class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
            <span class="text-sm font-semibold">Python 日志</span>
            <button
              class="rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              onClick={() => setLogs([])}
            >
              清空
            </button>
          </div>
          <div class="max-h-80 overflow-y-auto p-2">
            {logs.length === 0 ? (
              <div class="py-6 text-center text-xs text-[var(--color-text-light)]">暂无日志</div>
            ) : (
              [...logs].reverse().map((l, i) => (
                <div
                  key={`${l.ts}-${i}`}
                  class={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs font-mono ${
                    l.level === 'ERROR'
                      ? 'text-[var(--color-danger)]'
                      : l.level === 'WARN'
                        ? 'text-[var(--color-warning-text)]'
                        : 'text-[var(--color-text-muted)]'
                  } transition-colors hover:bg-[var(--color-surface-2)]`}
                >
                  <span class="text-[10px] text-[var(--color-text-light)]">
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>
                  <span class="flex-1 break-all">{l.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </header>
  );
}
