// src/components/common/EulaModal.tsx - EULA 首次启动弹窗
// 用户必须同意才能使用,不同意则退出应用

import { useEffect, useState } from 'react';
import { FileText, X, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

export function EulaModal(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [eulaText, setEulaText] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 检查是否已同意 EULA(复用 showDisclaimerOnStart 设置)
    // 如果 showDisclaimerOnStart=false,说明用户已同意过,不再显示 EULA
    // 如果 showDisclaimerOnStart=true(首次),显示 EULA
    api.system.getSettings().then((settings) => {
      if (settings.showDisclaimerOnStart) {
        setVisible(true);
        // 加载 EULA 文本
        fetch('resources/data/EULA.txt')
          .then((res) => res.text())
          .then((text) => {
            setEulaText(text);
            setLoading(false);
          })
          .catch(() => {
            setEulaText('EULA 文件加载失败');
            setLoading(false);
          });
      }
    });
  }, []);

  if (!visible) return null;

  const handleAgree = async (): Promise<void> => {
    // 用户同意,关闭 EULA 显示(后续不再弹)
    await api.system.setSettings({ showDisclaimerOnStart: false });
    setVisible(false);
  };

  const handleDisagree = (): void => {
    // 用户不同意,退出应用
    api.system.windowClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl">
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-semibold">最终用户许可协议</h2>
          </div>
          <span className="text-xs text-zinc-600">v1.1</span>
        </div>

        {/* EULA 正文(可滚动) */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-20 text-center text-zinc-500">加载中...</div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-zinc-400">
              {eulaText}
            </pre>
          )}
        </div>

        {/* 同意 checkbox + 按钮 */}
        <div className="shrink-0 border-t border-zinc-800 px-6 py-4">
          <label className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            <span>我已阅读并同意上述《最终用户许可协议及免责声明》的全部条款</span>
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleDisagree}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900"
            >
              <X className="h-4 w-4" />
              不同意,退出
            </button>
            <button
              onClick={handleAgree}
              disabled={!agreed}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
                agreed
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-600',
              )}
            >
              <Check className="h-4 w-4" />
              同意并继续
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
