// src/routes/Placeholder.tsx - 未实现路由的占位页

import { Construction } from 'lucide-react';

export function Placeholder({ title, milestone }: { title: string; milestone: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <Construction className="h-16 w-16 text-blue-500" />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-zinc-400">
        该功能将在 <span className="font-medium text-blue-400">{milestone}</span> 阶段实现
      </p>
      <p className="max-w-md text-sm text-zinc-500">
        当前为 M2 阶段,其他功能尚未实现。请参考 map.md 了解完整路线图。
      </p>
    </div>
  );
}
