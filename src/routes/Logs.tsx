// src/routes/Logs.tsx - 日志查看器(全屏版)
// 见 plan.md 5. src/routes/Logs.tsx

import { Trash2, Download } from 'lucide-react';
import { useLogStore } from '../stores/logStore';
import { formatTime } from '../lib/utils';
import { cn } from '../lib/utils';
import type { LogLevel } from '../../shared/types';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-zinc-500',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

export function Logs(): JSX.Element {
  const logs = useLogStore((s) => s.logs);
  const clear = useLogStore((s) => s.clear);

  const handleExport = (): void => {
    const text = logs
      .map((l) => `[${formatTime(l.ts)}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `imoodesktop-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">日志查看器</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            <Download className="h-4 w-4" />
            导出
          </button>
          <button
            onClick={clear}
            className="flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            <Trash2 className="h-4 w-4" />
            清空
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="py-20 text-center text-zinc-600">暂无日志</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-2 py-0.5 hover:bg-zinc-900/50">
              <span className="shrink-0 text-zinc-600">{formatTime(log.ts)}</span>
              <span className={cn('shrink-0 font-semibold', LEVEL_COLORS[log.level])}>
                {log.level.toUpperCase().padEnd(5)}
              </span>
              <span className="shrink-0 text-zinc-500">[{log.source}]</span>
              <span className="break-all text-zinc-300">{log.message}</span>
            </div>
          ))
        )}
      </div>

      <div className="text-xs text-zinc-500">共 {logs.length} 条日志</div>
    </div>
  );
}
