// src/components/common/SplashScreen.tsx - 启动 Banner
// 应用加载时显示,1.5 秒后淡出

import { useEffect, useState } from 'react';
import iconUrl from '../../assets/icon.svg';

export function SplashScreen(): JSX.Element | null {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // 1.2 秒后开始淡出
    const fadeTimer = setTimeout(() => setFading(true), 1200);
    // 1.7 秒后完全隐藏(淡出动画 500ms)
    const hideTimer = setTimeout(() => setVisible(false), 1700);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-zinc-950 transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* 光晕背景 */}
      <div className="absolute h-64 w-64 rounded-full bg-blue-600/10 blur-3xl" />

      {/* Logo */}
      <div className="relative mb-6">
        <img src={iconUrl} alt="iMooDesktop" className="h-20 w-20 rounded-2xl shadow-2xl shadow-blue-900/40" />
      </div>

      {/* 应用名 */}
      <h1 className="relative text-xl font-bold tracking-tight text-zinc-100">
        iMooDesktop
      </h1>
      <p className="relative mt-1 text-xs text-zinc-500">
        XTC 电话手表工具箱
      </p>

      {/* 加载指示器 */}
      <div className="relative mt-6 h-1 w-32 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full w-1/2 animate-[splash_1.2s_ease-in-out_infinite] rounded-full bg-blue-500" />
      </div>

      {/* 版本号 */}
      <p className="relative mt-4 text-[10px] text-zinc-700">
        v1.0.0
      </p>

      {/* 动画定义 */}
      <style>{`
        @keyframes splash {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
