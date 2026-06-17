/**
 * Toast 通知系统
 *
 * 使用：直接调用 toast.success('xxx') / toast.error('xxx') / toast.info('xxx') / toast.warning('xxx')
 * Toast 会自动消失，默认 3 秒。
 */

import { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'preact/hooks';
import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { CheckCircle2, AlertTriangle, XCircle, Info, X, type LucideIcon } from '../lib/icons';

export type ToastLevel = 'success' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  level: ToastLevel;
  message: string;
  detail?: string;
  duration: number;
}

interface ToastContextValue {
  show: (level: ToastLevel, message: string, detail?: string, duration?: number) => void;
  success: (msg: string, detail?: string) => void;
  warning: (msg: string, detail?: string) => void;
  error: (msg: string, detail?: string) => void;
  info: (msg: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastLevel, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 正在离场动画中的 toast id（配合 CSS .toast-leaving）
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  // 用 Map 管理 setTimeout id，remove/unmount 时 clearTimeout，避免泄漏
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const remove = useCallback((id: string) => {
    clearTimer(id);
    // 先标记为 leaving，等 CSS 动画（200ms）结束后再真正移除
    setLeavingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      setLeavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  }, [clearTimer]);

  const show = useCallback(
    (level: ToastLevel, message: string, detail?: string, duration = 3000) => {
      // 8 位随机 id
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      setToasts((prev) => [...prev, { id, level, message, detail, duration }]);
      if (duration > 0) {
        const t = setTimeout(() => remove(id), duration);
        timersRef.current.set(id, t);
      }
    },
    [remove]
  );

  // useMemo 缓存 ctx，避免每次 render 重建（success/warning/error/info 闭包稳定）
  const ctx = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m, d) => show('success', m, d),
      warning: (m, d) => show('warning', m, d),
      error: (m, d) => show('danger', m, d, 5000),
      info: (m, d) => show('info', m, d),
    }),
    [show]
  );

  // unmount 时清理所有定时器
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div class="toast-container" role="region" aria-label="通知" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`toast toast-${t.level} ${leavingIds.has(t.id) ? 'toast-leaving' : ''}`} role="alert">
            {(() => {
              const Icon = ICONS[t.level];
              return <Icon size={18} aria-hidden="true" />;
            })()}
            <div class="flex-1">
              <div class="font-medium">{t.message}</div>
              {t.detail && <div class="mt-1 text-xs text-[var(--color-text-muted)]">{t.detail}</div>}
            </div>
            <button
              class="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-light)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              onClick={() => remove(t.id)}
              aria-label="关闭通知"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 兜底：未在 Provider 内时降级到 console
    return {
      show: (level, message, detail) => console.log(`[toast:${level}]`, message, detail ?? ''),
      success: (m, d) => console.log('[toast:success]', m, d ?? ''),
      warning: (m, d) => console.warn('[toast:warning]', m, d ?? ''),
      error: (m, d) => console.error('[toast:error]', m, d ?? ''),
      info: (m, d) => console.info('[toast:info]', m, d ?? ''),
    };
  }
  return ctx;
}
