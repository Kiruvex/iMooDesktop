// src/routes/Cloud.tsx - 资源下载页
// 对应原 cloud.bat + cloud.json
// 按分类展示资源,支持下载/批量下载/进度显示

import { useEffect, useState } from 'react';
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Package,
} from 'lucide-react';
import { api, type CloudResource } from '../lib/api';
import { cn } from '../lib/utils';

export function Cloud(): JSX.Element {
  const [grouped, setGrouped] = useState<Record<string, CloudResource[]>>({});
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, { success: boolean; message?: string }>>({});

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await api.cloud.listByCategory();
      setGrouped(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = api.cloud.onProgress((data) => {
      setProgress((prev) => ({ ...prev, [data.name]: data.percent }));
    });
    return unsub;
  }, []);

  const handleDownload = async (name: string): Promise<void> => {
    setDownloading(name);
    setProgress((prev) => ({ ...prev, [name]: 0 }));
    setResults((prev) => ({ ...prev, [name]: { success: false, message: undefined } }));
    try {
      const res = await api.cloud.download(name);
      setResults((prev) => ({ ...prev, [name]: { success: res.success, message: res.error } }));
      if (res.success) {
        // 刷新列表(更新本地版本)
        await load();
      }
    } catch (e) {
      setResults((prev) => ({ ...prev, [name]: { success: false, message: (e as Error).message } }));
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadCategory = async (category: string): Promise<void> => {
    const resources = grouped[category] ?? [];
    for (const r of resources) {
      await handleDownload(r.name);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>加载资源列表...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Download className="h-5 w-5 text-blue-500" />
            资源下载
          </h1>
          <p className="mt-1 text-sm text-zinc-500">从云端下载功能所需资源(4 镜像自适应)</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>

      {Object.entries(grouped).map(([category, resources]) => (
        <section key={category}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {category}
              <span className="ml-2 text-zinc-600">({resources.length})</span>
            </h2>
            <button
              onClick={() => handleDownloadCategory(category)}
              disabled={downloading !== null}
              className="rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
            >
              全部下载
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((r) => {
              const isDownloading = downloading === r.name;
              const pct = progress[r.name] ?? 0;
              const result = results[r.name];
              return (
                <div
                  key={r.name}
                  className={cn(
                    'flex flex-col rounded-lg border p-3',
                    result?.success
                      ? 'border-green-800/40 bg-green-950/10'
                      : result?.success === false
                        ? 'border-red-800/40 bg-red-950/10'
                        : 'border-zinc-800/80 bg-zinc-900/30',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Package
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        r.required ? 'text-blue-400' : 'text-zinc-500',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
                        {r.name}
                        {r.required && (
                          <span className="rounded bg-blue-500/15 px-1 py-0.5 text-[9px] text-blue-400">
                            必需
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-zinc-500">{r.description}</div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
                        {r.filename}
                      </div>
                    </div>
                  </div>

                  {/* 进度条 */}
                  {isDownloading && (
                    <div className="mt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full bg-blue-600 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 text-right text-[10px] text-zinc-500">{pct}%</div>
                    </div>
                  )}

                  {/* 结果 */}
                  {result?.success && !isDownloading && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>已下载</span>
                      {r.localVersion && (
                        <span className="text-zinc-600">· {r.localVersion}</span>
                      )}
                    </div>
                  )}
                  {result?.success === false && !isDownloading && result.message && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      <span className="truncate">{result.message}</span>
                    </div>
                  )}

                  {/* 下载按钮 */}
                  <button
                    onClick={() => handleDownload(r.name)}
                    disabled={isDownloading || downloading !== null}
                    className={cn(
                      'mt-2 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
                      isDownloading
                        ? 'bg-zinc-800 text-zinc-500'
                        : 'bg-blue-600/15 text-blue-400 hover:bg-blue-600 hover:text-white',
                    )}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {isDownloading ? `${pct}%` : '下载'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
