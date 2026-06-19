// src/stores/logStore.ts - 日志环形缓冲(Zustand)
// 见 plan.md 9.2 状态分层 + 9.4 LogConsole(环形 5000 条)

import { create } from 'zustand';
import type { LogEntry } from '../../shared/types';

const MAX_LOGS = 5000;

interface LogStore {
  logs: LogEntry[];
  enabled: Record<string, boolean>; // 按级别过滤:debug/info/warn/error
  filterTaskId: string | null;
  autoScroll: boolean;
  addLog: (entry: LogEntry) => void;
  clear: () => void;
  toggleLevel: (level: keyof LogStore['enabled']) => void;
  setFilterTaskId: (taskId: string | null) => void;
  setAutoScroll: (auto: boolean) => void;
  getFiltered: () => LogEntry[];
}

export const useLogStore = create<LogStore>((set, get) => ({
  logs: [],
  enabled: { debug: false, info: true, warn: true, error: true },
  filterTaskId: null,
  autoScroll: true,
  addLog: (entry) => {
    set((state) => {
      const logs = [...state.logs, entry];
      // 环形缓冲:超出 5000 条丢弃最旧的
      if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
      }
      return { logs };
    });
  },
  clear: () => set({ logs: [] }),
  toggleLevel: (level) =>
    set((state) => ({
      enabled: { ...state.enabled, [level]: !state.enabled[level] },
    })),
  setFilterTaskId: (taskId) => set({ filterTaskId: taskId }),
  setAutoScroll: (autoScroll) => set({ autoScroll }),
  getFiltered: () => {
    const { logs, enabled, filterTaskId } = get();
    return logs.filter((l) => {
      if (!enabled[l.level]) return false;
      if (filterTaskId && l.taskId !== filterTaskId) return false;
      return true;
    });
  },
}));
