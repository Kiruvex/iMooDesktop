// src/components/layout/WindowControls.tsx - 窗口控制按钮(macOS 红绿灯风格)
// 自定义标题栏用(无边框窗口,见 electron/core/windows.ts frame:false)
// 设计:三个圆形按钮,按 Windows 习惯顺序:最小化(黄)- 最大化(绿)- 关闭(红)
// 未 hover 时三个圆点是半透明,hover 整组后变实色 + 显示图标

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    api.system.windowIsMaximized().then(setMaximized).catch(() => {
      // ignore
    });
    const timer = setInterval(() => {
      api.system.windowIsMaximized().then(setMaximized).catch(() => {
        // ignore
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="group flex items-center gap-3 ml-4">
      {/* 最小化:黄色 */}
      <button
        onClick={() => api.system.windowMinimize().catch(() => {})}
        className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full border border-traffic-yellow/40 bg-traffic-yellow/20 transition-colors hover:bg-traffic-yellow hover:border-traffic-yellow"
        title="最小化"
        aria-label="最小化"
      >
        <svg
          className="absolute h-2 w-2 opacity-0 transition-opacity group-hover:opacity-100"
          viewBox="0 0 8 8"
          fill="none"
        >
          <line x1="1.5" y1="4" x2="6.5" y2="4" stroke="#4d3500" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* 最大化/还原:绿色 */}
      <button
        onClick={() => api.system.windowToggleMaximize().catch(() => {})}
        className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full border border-traffic-green/40 bg-traffic-green/20 transition-colors hover:bg-traffic-green hover:border-traffic-green"
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
      >
        {maximized ? (
          /* 还原:两个对角三角形(Mac 风格) */
          <svg
            className="absolute h-2 w-2 opacity-0 transition-opacity group-hover:opacity-100"
            viewBox="0 0 8 8"
            fill="none"
          >
            <path d="M2 2 L6 2 L2 6 Z" fill="#0a3d0a" />
            <path d="M6 6 L2 6 L6 2 Z" fill="#0a3d0a" opacity="0.7" />
          </svg>
        ) : (
          /* 最大化:左上+右下两个三角形(Mac 风格) */
          <svg
            className="absolute h-2 w-2 opacity-0 transition-opacity group-hover:opacity-100"
            viewBox="0 0 8 8"
            fill="none"
          >
            <path d="M2 2 L2 5 L5 2 Z" fill="#0a3d0a" />
            <path d="M6 6 L6 3 L3 6 Z" fill="#0a3d0a" />
          </svg>
        )}
      </button>

      {/* 关闭:红色 */}
      <button
        onClick={() => api.system.windowClose().catch(() => {})}
        className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full border border-traffic-red/40 bg-traffic-red/20 transition-colors hover:bg-traffic-red hover:border-traffic-red"
        title="关闭"
        aria-label="关闭"
      >
        <svg
          className="absolute h-2 w-2 opacity-0 transition-opacity group-hover:opacity-100"
          viewBox="0 0 8 8"
          fill="none"
        >
          <line x1="2" y1="2" x2="6" y2="6" stroke="#4d0000" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="6" y1="2" x2="2" y2="6" stroke="#4d0000" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
