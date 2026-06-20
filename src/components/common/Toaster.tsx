// src/components/common/Toaster.tsx - 全局 toast 通知组件
//
// 订阅 toastStore,渲染在固定底部居中
// 替代各页面自己的 result state + setTimeout 消失
//
// 用法(任意代码):
//   import { toast } from '../../stores/toastStore';
//   toast.ok('成功'); toast.err('失败'); toast.info('提示');

import { useToastStore, type ToastKind } from '../../stores/toastStore';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

const KIND_STYLE: Record<ToastKind, { color: string; icon: typeof CheckCircle2 }> = {
  ok: {
    color: 'border-green-800/50 bg-green-950/20 text-green-300',
    icon: CheckCircle2,
  },
  err: {
    color: 'border-red-800/50 bg-red-950/20 text-red-300',
    icon: AlertTriangle,
  },
  info: {
    color: 'border-blue-800/50 bg-blue-950/20 text-blue-300',
    icon: Info,
  },
};

export function Toaster(): JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind];
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex max-w-[480px] items-center gap-2 rounded-md border px-4 py-2 text-sm shadow-lg',
              style.color,
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="break-all">{t.msg}</span>
            <button
              onClick={() => remove(t.id)}
              className="ml-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
              aria-label="关闭"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
