// src/lib/utils.ts - 通用工具

/** className 合并 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** 格式化时间戳为 HH:MM:SS.mmm */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, l = 2): string => n.toString().padStart(l, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 格式化字节大小 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 格式化设备类型为中文 */
export function formatDeviceType(type: string): string {
  const map: Record<string, string> = {
    adb: 'ADB',
    fastboot: 'Fastboot',
    qcom_edl: '9008 (EDL)',
    sprd_edl: '展锐 EDL',
    emulator: '模拟器',
    unauthorized: '未授权',
    offline: '离线',
  };
  return map[type] ?? type;
}
