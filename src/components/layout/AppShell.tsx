// src/components/layout/AppShell.tsx - 整体布局
// 见 plan.md 9.4 AppShell
// 布局:TopBar sticky top + (Sidebar | Main | LogConsole) + Footer
// 日志放右侧(比底部更利用横屏空间,日志行更长不被截断)
// 分区域滚动:外层 h-screen 固定高度,中间区 flex-1 overflow-hidden,只有 main 内部 overflow-y-auto

import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { Footer } from './Footer';
import { LogConsole } from './LogConsole';

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-[10px] bg-zinc-950 text-zinc-200">
      <TopBar />
      <div className="flex flex-1 overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-950 to-blue-950/20">
        <Sidebar />
        <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
        <LogConsole />
      </div>
      <Footer />
    </div>
  );
}

