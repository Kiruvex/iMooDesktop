// src/components/common/ApkPreviewDialog.tsx - APK 安装前预览弹窗
//
// 选 APK 后先解析显示包名/版本/权限/大小,确认后安装
// 用于文件管理(双击 APK)和应用管理(选文件安装)

import { useEffect, useState } from 'react';
import { Package, Loader2, CheckCircle2, AlertTriangle, Shield, X, Cpu, HardDrive } from 'lucide-react';
import type { ApkInfo } from '../../lib/api';
import { api } from '../../lib/api';
import { cn, formatBytes } from '../../lib/utils';

interface ApkPreviewDialogProps {
  /** APK 文件路径(null=关闭) */
  apkPath: string | null;
  /** 确认安装回调 */
  onConfirm: (apkPath: string) => void;
  /** 关闭回调 */
  onClose: () => void;
}

export function ApkPreviewDialog({ apkPath, onConfirm, onClose }: ApkPreviewDialogProps): JSX.Element | null {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apkPath) {
      setInfo(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    api.file
      .parseApk(apkPath)
      .then((result) => setInfo(result))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [apkPath]);

  if (!apkPath) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[85vh] w-[480px] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Package className="h-4 w-4 text-blue-400" />
            APK 信息
          </h3>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 应用图标 + 应用名(解析成功后显示) */}
        {info && !loading && (
          <div className="mb-3 flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800">
              {info.iconBase64 ? (
                <img
                  src={`data:${info.iconMime ?? 'image/png'};base64,${info.iconBase64}`}
                  alt="应用图标"
                  className="h-16 w-16 object-contain"
                  onError={(e) => {
                    // 图标加载失败时显示 fallback
                    (e.target as HTMLImageElement).style.display = 'none';
                    const fallback = (e.target as HTMLImageElement).nextElementSibling;
                    if (fallback) (fallback as HTMLElement).style.display = 'flex';
                  }}
                />
              ) : null}
              {/* Fallback:Package 图标 */}
              <Package
                className={cn('h-8 w-8 text-zinc-500', info.iconBase64 && 'hidden')}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium text-zinc-100">
                {info.label ?? info.packageName}
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-zinc-500" title={info.packageName}>
                {info.packageName}
              </div>
              {info.versionName && (
                <div className="mt-0.5 text-xs text-zinc-400">
                  v{info.versionName}
                  {info.versionCode ? ` (${info.versionCode})` : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 文件名(加载中/失败时显示) */}
        {(!info || loading) && (
          <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
            <div className="text-xs text-zinc-500">文件</div>
            <div className="mt-0.5 truncate text-sm text-zinc-300" title={apkPath}>
              {apkPath.split(/[\\/]/).pop()}
            </div>
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>解析中...</span>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-800/50 bg-red-950/20 p-3 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>解析失败: {error}</span>
          </div>
        )}

        {/* 解析结果 */}
        {info && !loading && (
          <div className="space-y-3">
            {/* SDK 信息(header 已显示包名/版本/应用名) */}
            <div className="grid grid-cols-2 gap-2">
              <InfoCell
                label="最低 SDK"
                value={info.minSdkVersion ? `API ${info.minSdkVersion}` : '-'}
              />
              <InfoCell
                label="目标 SDK"
                value={info.targetSdkVersion ? `API ${info.targetSdkVersion}` : '-'}
              />
            </div>

            {/* 文件信息 */}
            <div className="flex items-center gap-4 rounded-md border border-zinc-800 bg-zinc-900/30 p-3 text-xs">
              <div className="flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-zinc-500" />
                <span className="text-zinc-500">APK 大小:</span>
                <span className="font-mono text-zinc-300">{formatBytes(info.apkSize)}</span>
              </div>
              {info.dexSize !== undefined && (
                <div className="flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-zinc-500">DEX:</span>
                  <span className="font-mono text-zinc-300">{formatBytes(info.dexSize)}</span>
                </div>
              )}
              {info.signer && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  <span className="text-zinc-500">已签名:</span>
                  <span className="font-mono text-zinc-300">{info.signer}</span>
                </div>
              )}
            </div>

            {/* CPU 架构 */}
            {info.abis.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Cpu className="h-3.5 w-3.5 text-zinc-500" />
                <span className="text-zinc-500">CPU 架构:</span>
                <span className="font-mono text-zinc-300">{info.abis.join(', ')}</span>
              </div>
            )}

            {/* 权限列表 */}
            {info.permissions.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                  <Shield className="h-3.5 w-3.5 text-amber-400" />
                  权限({info.permissions.length})
                </div>
                <div className="max-h-40 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
                  <div className="flex flex-wrap gap-1">
                    {info.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 底部按钮 */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-800 px-4 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(apkPath)}
            disabled={loading || !!error}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Package className="h-3.5 w-3.5" />
            安装
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={cn('mt-0.5 truncate text-xs text-zinc-200', mono && 'font-mono')} title={value}>
        {value}
      </div>
    </div>
  );
}
