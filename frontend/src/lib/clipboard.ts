/**
 * 跨平台剪贴板写入工具
 *
 * 优先使用现代 Clipboard API（需 secure context：https 或 localhost 或 file://），
 * 失败时降级到 execCommand('copy') 兜底（兼容非 secure context / 旧 Chromium）。
 *
 * 用法：
 *   import { copyText } from '../lib/clipboard';
 *   const ok = await copyText(text);
 *   if (ok) toast.success('已复制');
 *   else toast.danger('复制失败');
 */

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallthrough to execCommand
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
