// electron/lib/gbk.ts - GBK 编解码封装
// 见 plan.md 6.1 SubprocessPool(GBK 处理)
// 见 plan.md 核心约束"GBK 编码":与 .exe 交互时用 GBK 编解码

import iconv from 'iconv-lite';

/**
 * 将 Buffer 按 GBK 解码为字符串
 * 原 .bat 用 chcp 936(GBK),原 .exe 输出多为 GBK
 */
export function decodeGbk(buf: Buffer): string {
  return iconv.decode(buf, 'gbk');
}

/**
 * 将字符串按 GBK 编码为 Buffer
 */
export function encodeGbk(str: string): Buffer {
  return iconv.encode(str, 'gbk');
}

/**
 * 按指定编码解码
 */
export function decode(buf: Buffer, encoding: 'utf-8' | 'gbk' = 'gbk'): string {
  if (encoding === 'utf-8') {
    return buf.toString('utf-8');
  }
  return iconv.decode(buf, 'gbk');
}
