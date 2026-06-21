// src/components/layout/LogConsole.tsx - 右侧日志面板
// 见 plan.md 9.4 LogConsole
// 布局:右侧侧栏,高度撑满,宽度可拖拽(从左边缘拖)
// - 等宽字体,按级别染色
// - 自动滚动到底
// - 日志级别过滤(debug/info/warn/error)
// - 清空/导出

import { useEffect, useRef, useState } from 'react';
import {
  Terminal,
  ChevronLeft,
  ChevronRight,
  Trash2,
  ArrowDownToLine,
  Download,
} from 'lucide-react';
import { useLogStore } from '../../stores/logStore';
import { formatTime } from '../../lib/utils';
import { cn } from '../../lib/utils';
import type { LogLevel } from '../../../shared/types';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-zinc-500',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

export function LogConsole(): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [width, setWidth] = useState(420);
  const logs = useLogStore((s) => s.logs);
  const enabled = useLogStore((s) => s.enabled);
  const autoScroll = useLogStore((s) => s.autoScroll);
  const toggleLevel = useLogStore((s) => s.toggleLevel);
  const clear = useLogStore((s) => s.clear);
  const setAutoScroll = useLogStore((s) => s.setAutoScroll);

  const containerRef = useRef<HTMLDivElement>(null);
  const filteredLogs = logs.filter((l) => enabled[l.level]);

  // 自动滚动到底
  useEffect(() => {
    if (autoScroll && expanded && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll, expanded]);

  // 拖拽调整宽度(从左边缘拖)
  const onResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent): void => {
      // 向左拖增大宽度
      const delta = startX - ev.clientX;
      setWidth(Math.max(240, Math.min(640, startWidth + delta)));
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleExport = (): void => {
    const text = filteredLogs
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

  // 收起状态:只显示一个窄条
  if (!expanded) {
    return (
      <div className="relative flex h-full w-10 shrink-0 flex-col items-center gap-3 border-l border-zinc-800/80 bg-zinc-950/50 py-3 backdrop-blur">
        <button
          onClick={() => setExpanded(true)}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-blue-400"
          title="展开日志"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-600 [writing-mode:vertical-lr]">
          <Terminal className="mb-2 h-3.5 w-3.5" />
          日志 {filteredLogs.length}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-l border-zinc-800/80 bg-zinc-950/50 backdrop-blur"
      style={{ width }}
    >
      {/* 拖拽手柄(左边缘) */}
      <div
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-600"
        onMouseDown={onResizeStart}
      />

      {/* 标题栏 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800/80 px-3">
        <Terminal className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-medium text-zinc-300">日志</span>
        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {filteredLogs.length}/{logs.length}
        </span>

        <div className="flex-1" />

        {/* 自动滚动开关 */}
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={cn(
            'rounded p-1 transition-colors',
            autoScroll
              ? 'bg-blue-500/15 text-blue-400'
              : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
          )}
          title={autoScroll ? '自动滚动:开' : '自动滚动:关'}
        >
          <ArrowDownToLine className="h-3 w-3" />
        </button>

        {/* 导出 */}
        <button
          onClick={handleExport}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          title="导出日志"
        >
          <Download className="h-3 w-3" />
        </button>

        {/* 清空 */}
        <button
          onClick={clear}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          title="清空日志"
        >
          <Trash2 className="h-3 w-3" />
        </button>

        {/* 收起 */}
        <button
          onClick={() => setExpanded(false)}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          title="收起日志"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {/* 级别过滤 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800/80 px-3 py-1.5">
        {(Object.keys(enabled) as LogLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => toggleLevel(level)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
              enabled[level]
                ? LEVEL_COLORS[level] + ' bg-zinc-800/80'
                : 'text-zinc-600 hover:bg-zinc-900',
            )}
          >
            {LEVEL_LABELS[level]}
          </button>
        ))}
      </div>

      {/* 日志内容 */}
      <div
        ref={containerRef}
        className="log-console flex-1 overflow-y-auto px-2 py-1.5 font-mono text-[11px] leading-relaxed"
      >
        {filteredLogs.length === 0 ? (
          <div className="py-10 text-center text-zinc-600">暂无日志</div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.ts} className="flex gap-1.5 py-0.5 hover:bg-zinc-900/40">
              <span className={cn('shrink-0 font-semibold', LEVEL_COLORS[log.level])}>
                [{LEVEL_LABELS[log.level]}]
              </span>
              <span className="break-all text-zinc-300">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
