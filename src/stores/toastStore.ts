// src/stores/toastStore.ts - 全局 toast 通知(Zustand)
//
// 替代各页面自己的 result state + setTimeout 消失
// 用法:
//   import { toast } from '../stores/toastStore';
//   toast.ok('操作成功');
//   toast.err('操作失败');
//   toast.info('提示信息');
//
// Toaster 组件(src/components/common/Toaster.tsx)订阅 store,渲染在固定底部居中

import { create } from 'zustand';

export type ToastKind = 'ok' | 'err' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
  /** 自动消失时间(ms),0 = 不自动消失 */
  duration: number;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (kind: ToastKind, msg: string, duration?: number) => void;
  remove: (id: number) => void;
  clear: () => void;
}

let idCounter = 0;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  add: (kind, msg, duration = 3000) => {
    const id = ++idCounter;
    const item: ToastItem = { id, kind, msg, duration };
    set((state) => ({ toasts: [...state.toasts, item] }));
    // 自动消失
    if (duration > 0) {
      window.setTimeout(() => {
        get().remove(id);
      }, duration);
    }
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** 便捷 API(非 hook,可在任意代码调用) */
export const toast = {
  ok: (msg: string, duration?: number): void => useToastStore.getState().add('ok', msg, duration),
  err: (msg: string, duration?: number): void => useToastStore.getState().add('err', msg, duration ?? 5000),
  info: (msg: string, duration?: number): void => useToastStore.getState().add('info', msg, duration),
};
