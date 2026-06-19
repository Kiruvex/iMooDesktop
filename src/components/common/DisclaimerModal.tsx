// src/components/common/DisclaimerModal.tsx - 启动免责声明
// 见 plan.md 17.2 免责声明(应用内置)

import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';

export function DisclaimerModal(): JSX.Element | null {
  const { showDisclaimerOnStart, loaded, update } = useSettingsStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (loaded && showDisclaimerOnStart) {
      setVisible(true);
    }
  }, [loaded, showDisclaimerOnStart]);

  if (!visible) return null;

  const handleAgree = async (): Promise<void> => {
    setVisible(false);
    // 用户同意后,本次不再显示(下次启动仍显示,除非在设置里关闭)
  };

  const handleDontShowAgain = async (): Promise<void> => {
    await update({ showDisclaimerOnStart: false });
    setVisible(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold">免责声明</h2>
          </div>
          <button
            onClick={() => setVisible(false)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="space-y-4 px-6 py-5 text-sm leading-relaxed text-zinc-300">
          <p className="font-medium text-amber-400">在使用 iMooDesktop 前,请仔细阅读以下声明:</p>

          <p>
            在使用 iMooDesktop 对 XTC
            电话手表系列进行 ROOT、刷机、解除安装限制、安装非官方应用等操作[统称"刷机"]前,您必须仔细阅读并完全理解本声明。一旦您实施或完成刷机行为,即视为您已充分知悉、同意并自愿承担本声明所述的全部风险及责任。
          </p>

          <ol className="list-decimal space-y-2 pl-5">
            <li>本工具仅供学习、交流使用,并非"破解"XTC 电话手表系列产品。严禁用于任何形式非法用途。</li>
            <li>
              <span className="font-medium text-red-400">本工具不能用于解绑手表</span>
              ,如您通过不正当手段获取的手表请联系公安机关归还失主。
            </li>
            <li>刷机后设备将脱离官方原厂固件,可能导致无法使用官方服务、系统不稳定、数据丢失或硬件损坏。</li>
            <li>设备自进入 9008 模式起即刻丧失官方保修资格。</li>
            <li>刷机属于您个人自愿行为,我们仅提供技术信息与文件资源,因刷机导致的直接或间接损失,我们不承担责任。</li>
            <li>请在刷机后 48 小时内恢复 XTC 官方系统。</li>
            <li>严禁代刷、强迫或教唆他人刷入非官方系统。</li>
            <li>获取 XTC 用户信息属违法行为,请立即卸载非法抓包工具。</li>
          </ol>

          <p className="rounded bg-zinc-900 p-3 text-zinc-400">
            使用本工具即表示您已阅读、理解并同意上述全部内容。
          </p>
        </div>

        {/* 按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-6 py-4">
          <button
            onClick={handleDontShowAgain}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            不再显示
          </button>
          <button
            onClick={handleAgree}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            我已阅读并同意
          </button>
        </div>
      </div>
    </div>
  );
}
