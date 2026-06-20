// electron/services/ApkParser.ts - APK 基础解析(纯 Node.js,无需 aapt)
//
// 解析能力:
//   - 包名(packageName)
//   - 版本名(versionName)/版本号(versionCode)
//   - 最低 SDK(minSdkVersion)/目标 SDK(targetSdkVersion)
//   - 权限列表(uses-permission)
//   - APK 文件大小 + dex/native 库大小
//   - 签名信息(META-INF 证书)
//
// 原理:
//   - APK 本质是 ZIP → 用 Node.js 解压
//   - AndroidManifest.xml 是二进制 XML(AXML 格式)→ 手写解析器
//   - resources.arsc 不解析(太复杂,版本名等从 manifest 直接读)

import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Logger } from './Logger';

const logger = Logger.instance.child('ApkParser');

/** APK 解析结果 */
export interface ApkInfo {
  packageName: string;
  versionName?: string;
  versionCode?: string;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  permissions: string[];
  /** APK 文件大小(字节) */
  apkSize: number;
  /** classes.dex 大小(字节) */
  dexSize?: number;
  /** native 库架构列表(如 armeabi-v7a, arm64-v8a) */
  abis: string[];
  /** 签名证书文件名(如 CERT.RSA) */
  signer?: string;
  /** 应用标签(应用名,可能为 @string 引用,无法解析时 undefined) */
  label?: string;
  /** 应用图标(base64 编码的 PNG/JPEG,前端直接用 data URI 显示) */
  iconBase64?: string;
  /** 图标 MIME 类型(如 image/png) */
  iconMime?: string;
}

// ========== ZIP 解析(读 central directory) ==========

interface ZipEntry {
  filename: string;
  /** 文件数据在 ZIP 中的偏移 */
  offset: number;
  /** 压缩大小 */
  compressedSize: number;
  /** 未压缩大小 */
  uncompressedSize: number;
  /** 压缩方法(0=stored, 8=deflated) */
  compressionMethod: number;
}

/**
 * 解析 ZIP 文件的 central directory
 * 不解压整个文件,只读目录结构 + 按需提取特定文件
 */
function parseZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  // 找 End of Central Directory Record(从尾部往前搜签名 0x06054b50)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65536); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('ZIP EOCD 未找到');
  }

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdCount = buffer.readUInt16LE(eocdOffset + 10);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break; // Central directory 签名

    const compressionMethod = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const filenameLength = buffer.readUInt16LE(pos + 28);
    const extraFieldLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);
    const filename = buffer.toString('utf8', pos + 46, pos + 46 + filenameLength);

    entries.push({
      filename,
      offset: localHeaderOffset,
      compressedSize,
      uncompressedSize,
      compressionMethod,
    });

    pos += 46 + filenameLength + extraFieldLength + commentLength;
  }

  return entries;
}

/** 从 ZIP 中提取指定文件的未压缩数据 */
function extractZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  // 读 local file header 获取实际数据偏移
  const localFilenameLength = buffer.readUInt16LE(entry.offset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.offset + 28);
  const dataOffset = entry.offset + 30 + localFilenameLength + localExtraLength;

  if (entry.compressionMethod === 0) {
    // Stored(无压缩)
    return buffer.subarray(dataOffset, dataOffset + entry.uncompressedSize);
  } else if (entry.compressionMethod === 8) {
    // Deflated
    const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
    return inflateSync(compressed);
  }
  throw new Error(`不支持的压缩方法: ${entry.compressionMethod}`);
}

// ========== AndroidManifest.xml 二进制解析(AXML) ==========

/**
 * Android 二进制 XML 解析器
 * 格式参考:https://justanapplication.wordpress.com/2011/09/22/android-internals-binary-xml-file-format/
 */
class AxmlParser {
  private buffer: Buffer;
  private pos = 0;
  /** 字符串池 */
  private strings: string[] = [];

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  parse(): Record<string, string | number | string[]> {
    // 读 XML header
    const magic = this.readUInt16(0);
    if (magic !== 0x0003) {
      throw new Error(`AXML magic 错误: 0x${magic.toString(16)}`);
    }
    this.pos = 8;

    const result: Record<string, string | number | string[]> = {
      permissions: [] as string[],
    };

    while (this.pos < this.buffer.length) {
      const chunkType = this.readUInt16(this.pos);
      const chunkSize = this.readUInt32(this.pos + 4);

      switch (chunkType) {
        case 0x0001: // StringPool
          this.parseStringPool();
          break;
        case 0x0180: // StartTag
          this.parseStartTag(result);
          break;
        default:
          this.pos += chunkSize;
          break;
      }
    }

    return result;
  }

  /** 解析字符串池 */
  private parseStringPool(): void {
    const startPos = this.pos;
    const stringCount = this.readUInt32(startPos + 8);
    const stringsStart = this.readUInt32(startPos + 12);

    // 读字符串偏移表
    const offsets: number[] = [];
    for (let i = 0; i < stringCount; i++) {
      offsets.push(this.readUInt32(startPos + 20 + i * 4));
    }

    // 读字符串(UTF-16LE 编码,每个字符串前有长度)
    this.strings = [];
    for (let i = 0; i < stringCount; i++) {
      const strOffset = startPos + stringsStart + offsets[i];
      // 字符串长度(2 字节,但有的版本用 1 字节,这里做兼容)
      let len = this.buffer.readUInt16LE(strOffset);
      if (len & 0x8000) {
        // 高位为 1 表示用 4 字节长度(大字符串)
        len = ((len & 0x7fff) << 16) | this.buffer.readUInt16LE(strOffset + 2);
        const strData = this.buffer.toString('utf16le', strOffset + 4, strOffset + 4 + len * 2);
        this.strings.push(strData);
      } else {
        const strData = this.buffer.toString('utf16le', strOffset + 2, strOffset + 2 + len * 2);
        this.strings.push(strData);
      }
    }

    // 跳过 StringPool chunk
    const chunkSize = this.readUInt32(startPos + 4);
    this.pos = startPos + chunkSize;
  }

  /** 解析 StartTag(提取属性) */
  private parseStartTag(result: Record<string, string | number | string[]>): void {
    const startPos = this.pos;
    // 读 attribute count
    const attrCount = this.readUInt16(startPos + 14);
    // 属性数据从 pos + 36 开始(每个属性 20 字节)
    const attrStart = startPos + 36;

    for (let i = 0; i < attrCount; i++) {
      const attrPos = attrStart + i * 20;
      if (attrPos + 20 > this.buffer.length) break;

      const nameIdx = this.readUInt32(attrPos + 4);
      const valueIdx = this.readUInt32(attrPos + 12);
      const attrName = nameIdx < this.strings.length ? this.strings[nameIdx] : '';
      const attrValue = valueIdx < this.strings.length ? this.strings[valueIdx] : '';

      // 提取关键属性
      if (attrName === 'package' && attrValue) {
        result.packageName = attrValue;
      } else if (attrName === 'versionName' && attrValue) {
        result.versionName = attrValue;
      } else if (attrName === 'versionCode') {
        // versionCode 可能是整数类型,读 raw value
        const rawValue = this.readUInt32(attrPos + 16);
        if (rawValue) {
          result.versionCode = String(rawValue);
        } else if (attrValue) {
          result.versionCode = attrValue;
        }
      } else if (attrName === 'minSdkVersion') {
        const rawValue = this.readUInt32(attrPos + 16);
        if (rawValue) {
          result.minSdkVersion = rawValue;
        }
      } else if (attrName === 'targetSdkVersion') {
        const rawValue = this.readUInt32(attrPos + 16);
        if (rawValue) {
          result.targetSdkVersion = rawValue;
        }
      } else if (attrName === 'name' && attrValue && attrValue.startsWith('android.permission.')) {
        // uses-permission 的 name 属性
        const perms = result.permissions as string[];
        perms.push(attrValue.replace('android.permission.', ''));
      } else if (attrName === 'label' && attrValue && !attrValue.startsWith('@')) {
        result.label = attrValue;
      }
    }

    // 跳过 chunk
    const chunkSize = this.readUInt32(startPos + 4);
    this.pos = startPos + chunkSize;
  }

  private readUInt16(offset: number): number {
    if (offset + 2 > this.buffer.length) return 0;
    return this.buffer.readUInt16LE(offset);
  }

  private readUInt32(offset: number): number {
    if (offset + 4 > this.buffer.length) return 0;
    return this.buffer.readUInt32LE(offset);
  }
}

// ========== 公开 API ==========

class ApkParserClass {
  /**
   * 解析 APK 文件
   * @param apkPath APK 文件路径
   * @returns 解析结果
   */
  async parse(apkPath: string): Promise<ApkInfo> {
    if (!fs.existsSync(apkPath)) {
      throw new Error(`文件不存在: ${apkPath}`);
    }

    const stat = fs.statSync(apkPath);
    const buffer = fs.readFileSync(apkPath);

    // 1. 解析 ZIP 结构
    const entries = parseZipEntries(buffer);
    logger.info(`APK 包含 ${entries.length} 个文件`);

    // 2. 提取 AndroidManifest.xml
    const manifestEntry = entries.find((e) => e.filename === 'AndroidManifest.xml');
    if (!manifestEntry) {
      throw new Error('AndroidManifest.xml 不存在');
    }
    const manifestData = extractZipEntry(buffer, manifestEntry);

    // 3. 解析二进制 XML
    const parser = new AxmlParser(manifestData);
    const parsed = parser.parse();

    // 4. 收集其他信息
    const abis: string[] = [];
    let dexSize: number | undefined;
    let signer: string | undefined;
    let iconEntry: ZipEntry | null = null;

    for (const entry of entries) {
      // native 库:lib/<abi>/*.so
      const libMatch = entry.filename.match(/^lib\/([^/]+)\//);
      if (libMatch && !abis.includes(libMatch[1])) {
        abis.push(libMatch[1]);
      }
      // dex 大小
      if (entry.filename === 'classes.dex' || entry.filename.match(/^classes\d+\.dex$/)) {
        dexSize = (dexSize ?? 0) + entry.uncompressedSize;
      }
      // 签名
      if (entry.filename.match(/^META-INF\/.*\.(RSA|DSA|EC)$/)) {
        signer = entry.filename.split('/').pop();
      }
    }

    // 5. 提取应用图标
    // 不解析 resources.arsc(太复杂),直接找常见图标路径
    // 优先级:mipmap-xxxhdpi > mipmap-xxhdpi > mipmap-xhdpi > mipmap-hdpi > mipmap-mdpi > drawable
    const iconPatterns = [
      /^res\/mipmap-xxxhdpi-v?\d*\/ic_launcher\.png$/i,
      /^res\/mipmap-xxhdpi-v?\d*\/ic_launcher\.png$/i,
      /^res\/mipmap-xhdpi-v?\d*\/ic_launcher\.png$/i,
      /^res\/mipmap-hdpi-v?\d*\/ic_launcher\.png$/i,
      /^res\/mipmap-mdpi-v?\d*\/ic_launcher\.png$/i,
      /^res\/mipmap-[^/]+\/ic_launcher\.png$/i,
      /^res\/drawable-[^/]+\/ic_launcher\.png$/i,
      /^res\/drawable\/ic_launcher\.png$/i,
      // Adaptive icon(前景层,可能不够好看但能用)
      /^res\/mipmap-xxxhdpi-v?\d*\/ic_launcher_foreground\.png$/i,
      /^res\/mipmap-xxhdpi-v?\d*\/ic_launcher_foreground\.png$/i,
      /^res\/mipmap-[^/]+\/ic_launcher_foreground\.png$/i,
      // 通用:任何 mipmap 下的 PNG(最后兜底)
      /^res\/mipmap-xxxhdpi\/[^/]+\.png$/i,
      /^res\/mipmap-xxhdpi\/[^/]+\.png$/i,
      /^res\/mipmap-[^/]+\/[^/]+\.png$/i,
    ];

    for (const pattern of iconPatterns) {
      iconEntry = entries.find((e) => pattern.test(e.filename)) ?? null;
      if (iconEntry) break;
    }

    let iconBase64: string | undefined;
    let iconMime: string | undefined;
    if (iconEntry) {
      try {
        const iconData = extractZipEntry(buffer, iconEntry);
        // 限制图标大小(超过 512KB 不提取,防恶意 APK)
        if (iconData.length < 512 * 1024) {
          iconBase64 = iconData.toString('base64');
          iconMime = iconEntry.filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        }
      } catch {
        // 图标提取失败不阻塞
      }
    }

    const info: ApkInfo = {
      packageName: parsed.packageName as string,
      versionName: parsed.versionName as string,
      versionCode: parsed.versionCode as string,
      minSdkVersion: parsed.minSdkVersion as number,
      targetSdkVersion: parsed.targetSdkVersion as number,
      permissions: (parsed.permissions as string[]) ?? [],
      apkSize: stat.size,
      dexSize,
      abis,
      signer,
      label: parsed.label as string,
      iconBase64,
      iconMime,
    };

    logger.info(`解析成功: ${info.packageName} v${info.versionName ?? '?'}(${info.permissions.length} 权限, 图标: ${iconBase64 ? '有' : '无'})`);
    return info;
  }
}

export const ApkParser = new ApkParserClass();
