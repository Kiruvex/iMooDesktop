/**
 * 通用 UI 组件
 */

import type { ComponentChildren } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import { Inbox, X } from '../lib/icons';

// ===== Spinner =====
export function Spinner({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      class={`spinner ${size === 'lg' ? 'spinner-lg' : ''}`}
      role="status"
      aria-label="加载中"
    />
  );
}

// ===== Button =====
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  type?: 'button' | 'submit';
  children: ComponentChildren;
  class?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  children,
  class: extraClass = '',
}: ButtonProps) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  const variantClass = `btn-${variant}`;
  return (
    <button
      type={type}
      class={`btn ${variantClass} ${sizeClass} ${extraClass}`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

// ===== Loading 全屏遮罩 =====
export function LoadingOverlay({ message = '加载中...' }: { message?: string }) {
  return (
    <div
      class="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]"
      role="status"
      aria-live="polite"
    >
      <Spinner size="lg" />
      <div class="mt-3 text-sm">{message}</div>
    </div>
  );
}

// ===== Empty State =====
// icon 接受任意可渲染内容（lucide 组件 / 字符串 emoji / VNode）。
// 默认 <Inbox size={48} />，调用方传 lucide 组件获得统一观感：
//   <EmptyState icon={<Link2 size={48} />} ... />
// 旧调用方传字符串 emoji 仍然兼容（类型上允许 string），便于 pages 渐进迁移。
export function EmptyState({
  icon = <Inbox size={48} />,
  title,
  desc,
  action,
}: {
  icon?: ComponentChildren;
  title: string;
  desc?: string;
  action?: ComponentChildren;
}) {
  return (
    <div class="card flex flex-col items-center justify-center py-14 text-center">
      <div
        class="empty-state-icon mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-bg)] text-[var(--color-primary)] opacity-90"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 class="mb-1 font-semibold text-[var(--color-text)]">{title}</h3>
      {desc && <p class="max-w-sm text-sm text-[var(--color-text-muted)]">{desc}</p>}
      {action && <div class="mt-5">{action}</div>}
    </div>
  );
}

// ===== Skeleton =====
export function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: string | number }) {
  return (
    <span
      class="skeleton"
      style={{ width: typeof width === 'number' ? `${width}px` : width, height: typeof height === 'number' ? `${height}px` : height, display: 'block' }}
      aria-hidden="true"
    />
  );
}

// ===== Modal =====
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
  width?: number;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // 稳定的 titleId，用于 aria-labelledby
  const titleId = useMemo(() => `modal-title-${Math.random().toString(36).slice(2, 10)}`, []);

  // ESC 关闭 + 焦点陷阱
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !dialogRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    // open 时自动聚焦第一个可交互元素
    const focusTimer = setTimeout(() => {
      if (!dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0].focus();
      else dialogRef.current.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', handler);
      clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        class="modal-content"
        style={{ width: `${width}px`, maxWidth: '90vw' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="mb-5 flex items-center justify-between">
          <h3 id={titleId} class="text-lg font-bold tracking-tight text-[var(--color-text)]">{title}</h3>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-light)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div>{children}</div>
        {footer && <div class="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ===== ConfirmDialog =====
export function ConfirmDialog({
  open,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={400}
      footer={
        <>
          <button class="btn btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button class={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p class="text-sm text-[var(--color-text)]">{message}</p>
    </Modal>
  );
}

// ===== Progress Bar =====
export function ProgressBar({
  value,
  max = 100,
  striped = false,
}: {
  value: number;
  max?: number;
  striped?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  // 仅在结束时启用 transition，避免高频更新拖尾
  return (
    <div
      class="progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        class={`progress-bar ${striped ? 'progress-bar-striped' : ''}`}
        style={{ width: `${pct}%`, transition: pct === 100 ? 'width 0.3s ease' : 'none' }}
      />
    </div>
  );
}

// ===== PageHeader =====
export function PageHeader({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: string;
  actions?: ComponentChildren;
}) {
  return (
    <div class="mb-5 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-xl font-bold tracking-tight text-[var(--color-text)]">{title}</h1>
        {desc && <p class="mt-1 text-sm text-[var(--color-text-muted)]">{desc}</p>}
      </div>
      {actions && <div class="flex flex-none gap-2">{actions}</div>}
    </div>
  );
}

// ===== Alert =====
export function Alert({
  level = 'info',
  children,
}: {
  level?: 'success' | 'warning' | 'danger' | 'info';
  children: ComponentChildren;
}) {
  return <div class={`alert alert-${level}`} role="alert">{children}</div>;
}

// ===== Badge =====
export function Badge({
  level = 'gray',
  children,
}: {
  level?: 'success' | 'warning' | 'danger' | 'info' | 'gray';
  children: ComponentChildren;
}) {
  return <span class={`badge badge-${level}`}>{children}</span>;
}

// ===== Confirm Hook (命令式调用) =====
let confirmHolder: { show: (opts: ConfirmOpts) => Promise<boolean> } | null = null;

interface ConfirmOpts {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface QueueItem {
  opts: ConfirmOpts;
  resolve: (v: boolean) => void;
}

export function ConfirmHolder() {
  // 改为队列：并发 confirm() 排队展示，每个 Promise 都会被 resolve
  const [queue, setQueue] = useState<QueueItem[]>([]);

  useEffect(() => {
    confirmHolder = {
      show: (opts: ConfirmOpts) =>
        new Promise<boolean>((resolve) => {
          setQueue((prev) => [...prev, { opts, resolve }]);
        }),
    };
    return () => {
      confirmHolder = null;
    };
  }, []);

  const pop = useCallback((result: boolean) => {
    setQueue((prev) => {
      const [first, ...rest] = prev;
      first?.resolve(result);
      return rest;
    });
  }, []);

  const current = queue[0];

  if (!current) return null;

  return (
    <ConfirmDialog
      open={true}
      title={current.opts.title}
      message={current.opts.message ?? ''}
      confirmText={current.opts.confirmText}
      cancelText={current.opts.cancelText}
      danger={current.opts.danger}
      onConfirm={() => pop(true)}
      onCancel={() => pop(false)}
    />
  );
}

export function confirm(opts: ConfirmOpts | string): Promise<boolean> {
  if (!confirmHolder) {
    // 兜底：用 window.confirm
    const msg = typeof opts === 'string' ? opts : opts.message;
    return Promise.resolve(window.confirm(msg));
  }
  const o = typeof opts === 'string' ? { message: opts } : opts;
  return confirmHolder.show(o);
}
