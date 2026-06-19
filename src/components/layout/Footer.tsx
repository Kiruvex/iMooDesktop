// src/components/layout/Footer.tsx - 页脚(版权/版本)
// sticky footer(见全局 UI 规则)

import { APP_META } from '../../../shared/types';

export function Footer(): JSX.Element {
  return (
    <footer className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-zinc-500">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span>iMooDesktop v{APP_META.version}</span>
          <span className="text-zinc-700">|</span>
          <span>by {APP_META.author}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>仅供学习交流</span>
          <span className="text-zinc-700">|</span>
          <span>严禁用于商业用途与手表强制解绑</span>
        </div>
      </div>
    </footer>
  );
}
