// src/hooks/useLogs.ts - 日志订阅
// 见 plan.md 9.4 LogConsole + 4.3 实时日志

import { useEffect } from 'react';
import { api } from '../lib/api';
import { useLogStore } from '../stores/logStore';

export function useLogs(): void {
  const addLog = useLogStore((s) => s.addLog);

  useEffect(() => {
    // 订阅
    api.log.subscribe().catch(() => {
      // ignore
    });
    const unsub = api.log.onLine((entry) => {
      addLog(entry);
    });
    return () => {
      unsub();
      api.log.unsubscribe().catch(() => {
        // ignore
      });
    };
  }, [addLog]);
}
