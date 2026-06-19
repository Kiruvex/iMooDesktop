// src/routes/Settings.tsx - 设置页
// 见 plan.md 5. src/routes/Settings.tsx
// 对应原 main.bat 的 settings 子菜单(见 plan.md 2.6.1)

import { useState } from 'react';
import { Settings as SettingsIcon, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { api } from '../lib/api';
import { APP_META } from '../../shared/types';

export function Settings(): JSX.Element {
  const settings = useSettingsStore();
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async (): Promise<void> => {
    setVerifying(true);
    try {
      const results = await api.system.verifyResources();
      const failed = results.filter((r) => !r.ok);
      if (results.length === 0) {
        setVerifyResult('manifest.json 不存在,跳过校验(开发模式正常)');
      } else if (failed.length === 0) {
        setVerifyResult(`校验通过(${results.length} 个文件)`);
      } else {
        setVerifyResult(`校验失败 ${failed.length}/${results.length}:${failed.map((f) => f.file).join(', ')}`);
      }
    } catch (e) {
      setVerifyResult(`校验异常: ${(e as Error).message}`);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <SettingsIcon className="h-5 w-5 text-blue-500" />
        设置
      </h1>

      {/* 工具箱设置 */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-medium">
          <ShieldCheck className="h-4 w-4 text-blue-500" />
          工具箱设置
        </h2>
        <div className="space-y-3">
          <ToggleRow
            label="快速启动"
            description="跳过启动时的更新检查和资源校验"
            checked={settings.speedStart}
            onChange={(v) => settings.update({ speedStart: v })}
          />
          <ToggleRow
            label="详细日志"
            description="记录更详细的调试日志(对应原 detailedlog.txt)"
            checked={settings.detailedLog}
            onChange={(v) => settings.update({ detailedLog: v })}
          />
          <ToggleRow
            label="启动时显示免责声明"
            description="每次启动显示免责声明弹窗"
            checked={settings.showDisclaimerOnStart}
            onChange={(v) => settings.update({ showDisclaimerOnStart: v })}
          />
        </div>
      </section>

      {/* 资源校验 */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-medium">
          <ShieldCheck className="h-4 w-4 text-blue-500" />
          资源完整性
        </h2>
        <div className="space-y-3">
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${verifying ? 'animate-spin' : ''}`} />
            {verifying ? '校验中...' : '校验资源完整性'}
          </button>
          {verifyResult && (
            <div className="rounded bg-zinc-900 p-3 font-mono text-sm text-zinc-300">
              {verifyResult}
            </div>
          )}
        </div>
      </section>

      {/* 关于 */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-medium">
          <Info className="h-4 w-4 text-blue-500" />
          关于
        </h2>
        <div className="space-y-2 text-sm">
          <Row label="应用名称" value={APP_META.name} />
          <Row label="版本" value={`v${APP_META.version} (${APP_META.buildDate})`} />
          <Row label="作者" value={APP_META.author} />
          <Row label="QQ" value={APP_META.authorQQ} />
          {APP_META.authorQQGroup && <Row label="交流 QQ 群" value={APP_META.authorQQGroup} />}
          {APP_META.authorWebsite && <Row label="项目仓库" value={APP_META.authorWebsite} />}
          <Row label="反馈邮箱" value={APP_META.authorEmail} />
          <Row label="基于" value={APP_META.basedOn} />
        </div>
        <div className="mt-4 rounded bg-amber-950/30 p-3 text-xs text-amber-300">
          本工具仅供学习交流,严禁用于商业用途与手表强制解绑。拾取他人手表请归还失主或联系 110。
        </div>
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-zinc-100">{label}</div>
        {description && <div className="text-xs text-zinc-500">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-100">{value}</span>
    </div>
  );
}
