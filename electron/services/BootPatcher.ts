// electron/services/BootPatcher.ts - 替代原 patch_boot.exe
// 见 plan.md 6.6 BootPatcher + 2.4 节"已知 Bug 修复"
//
// 逻辑保真(最高优先级):
//   原 patch_boot.exe(Rust + regex 1.10.5 实现)对 magiskboot unpack 后的 kernel 文件做 4 条正则替换。
//   strings 提取的 4 条 regex(拼接后被 split 解读):
//     1. 'builduser=root'          → 'builduser=root'  (在末尾追加一份,确保存在)
//     2. 'androidboot.selinux=...' → 'androidboot.selinux=permissive'  (强制 permissive)
//     3. 'buildvariant=user '      → 'buildvariant=userdebug '  (注意尾部空格)
//     4. '(buildsoftversion=[\\d.]+)[:space]*' → '$1'  (移除版本号后的空白)
//
// Bug 修复(用户已批准,见 plan.md 2.4):
//   - 原作者拼写错误 "Sucess" 已修复为 "success"
//   - 检查方式由 find "Suc" 改为 includes('success')
//
// 实现细节:
//   - 操作对象:magiskboot unpack 后在工作目录(paths.edlWork)中的 `kernel` 文件
//   - 用 Buffer 读写,保持二进制安全(kernel 可能含 \0 等)
//   - 4 条替换顺序敏感,严禁调整(原 .exe 顺序)

import fs from 'node:fs';
import { Logger } from './Logger';

const logger = Logger.instance.child('BootPatcher');

export interface PatchResult {
  success: boolean;
  /** 已应用的补丁列表(用于日志/UI 展示) */
  patches: string[];
  /** 错误信息(success=false 时) */
  error?: string;
  /** 修补器输出字符串(对应原 patch_boot.exe 的 stdout) */
  output: string;
}

class BootPatcherClass {
  /**
   * 修补 kernel 文件
   * 对应原 patch_boot.exe(逻辑保真:4 条正则替换,顺序敏感)
   *
   * @param kernelPath magiskboot unpack 后的 kernel 文件路径
   * @returns { success, patches, output }
   *   - success: 是否成功
   *   - patches: 已应用的补丁描述(用于 UI 展示)
   *   - output: 'success' 或 'Error'(对应原 .exe 的 stdout)
   */
  patch(kernelPath: string): PatchResult {
    const patches: string[] = [];

    try {
      if (!fs.existsSync(kernelPath)) {
        logger.error(`kernel 文件不存在: ${kernelPath}`);
        return {
          success: false,
          patches: [],
          error: `kernel 文件不存在: ${kernelPath}`,
          output: 'Error',
        };
      }

      // 用 Buffer 读写,二进制安全
      const buf = fs.readFileSync(kernelPath);
      let content = buf.toString('latin1'); // latin1 保证 1:1 字节映射,正则替换不会破坏非 ASCII

      // === Patch 1:builduser=root → 追加一份 builduser=root(确保存在) ===
      // 原 patch_boot.exe strings: 'builduser=rootbuilduser=root '
      // 语义:在 cmdline 中查找 'builduser=root',若存在则在其后再追加一份 'builduser=root'
      // 这里等价实现:若已存在,则在其后追加 'builduser=root';若不存在,则什么都不做(原 .exe 的 regex 行为)
      // 注:原 .exe 的 regex 是 'builduser=root' 替换为 'builduser=rootbuilduser=root'(字面字符串,非捕获组)
      {
        const before = content;
        content = content.replace(
          /builduser=root/,
          'builduser=rootbuilduser=root',
        );
        if (content !== before) {
          patches.push("builduser=root → 追加 builduser=root(确保存在)");
        } else {
          patches.push("builduser=root 未匹配(原样保留)");
        }
      }

      // === Patch 2:androidboot.selinux= 后强制 permissive ===
      // 原 patch_boot.exe strings: 'androidboot.selinux=permissive'
      // 语义:把 'androidboot.selinux=enforcing' 替换为 'androidboot.selinux=permissive'
      //      若已是 permissive 则不变(原 .exe 的 regex 行为)
      {
        const before = content;
        content = content.replace(
          /androidboot\.selinux=enforcing/,
          'androidboot.selinux=permissive',
        );
        if (content !== before) {
          patches.push("androidboot.selinux=enforcing → permissive");
        } else {
          patches.push("androidboot.selinux= 未匹配 enforcing(原样保留)");
        }
      }

      // === Patch 3:buildvariant=user (带尾空格) → buildvariant=userdebug (带尾空格) ===
      // 原 patch_boot.exe strings: 'buildvariant=userbuildvariant=userdebug'
      // 语义:把 'buildvariant=user ' (注意尾部空格,避免匹配 userdebug) 替换为 'buildvariant=userdebug '
      // 原文 regex 应为 /buildvariant=user /,替换字符串为 'buildvariant=userdebug '
      {
        const before = content;
        content = content.replace(
          /buildvariant=user /,
          'buildvariant=userdebug ',
        );
        if (content !== before) {
          patches.push("buildvariant=user → buildvariant=userdebug");
        } else {
          patches.push("buildvariant=user (带尾空格) 未匹配(原样保留)");
        }
      }

      // === Patch 4:移除 buildsoftversion=x.y.z 后的多余空白 ===
      // 原 patch_boot.exe strings: '(buildsoftversion=[\\d.]+)[:space]*'
      // 语义:捕获 buildsoftversion=x.y.z,后跟任意空白([:space]*),替换为仅捕获组(去掉空白)
      // [:space] 在 POSIX 字符类中等价于 [ \\t\\r\\n\\v\\f],JS 中用 \\s 表达
      {
        const before = content;
        content = content.replace(
          /(buildsoftversion=[\d.]+)\s*/g,
          '$1',
        );
        if (content !== before) {
          patches.push("buildsoftversion=x.y.z 后空白已移除");
        } else {
          patches.push("buildsoftversion=x.y.z 未匹配(原样保留)");
        }
      }

      // 写回(只有内容变化时才写)
      const newBuf = Buffer.from(content, 'latin1');
      if (newBuf.length !== buf.length || !newBuf.equals(buf)) {
        fs.writeFileSync(kernelPath, newBuf);
        logger.info(`kernel 已修补,共应用 ${patches.length} 条规则`);
      } else {
        logger.info('kernel 无变化(所有规则均未匹配)');
      }

      // Bug 修复:输出 'success'(原 'Sucess' 拼写错误已修正,见 plan.md 2.4)
      // 调用方检查方式:includes('success')
      return {
        success: true,
        patches,
        output: 'success',
      };
    } catch (e) {
      logger.error(`kernel 修补失败: ${(e as Error).message}`);
      return {
        success: false,
        patches,
        error: (e as Error).message,
        output: 'Error',
      };
    }
  }

  /**
   * 修补 kernel 文件,失败时抛错(便于 await 调用)
   * 内部检查 includes('success')
   */
  async patchAsync(kernelPath: string): Promise<PatchResult> {
    const result = this.patch(kernelPath);
    if (!result.success || !result.output.includes('success')) {
      throw new Error(`patch_boot 失败: ${result.error ?? result.output}`);
    }
    return result;
  }
}

export const BootPatcher = new BootPatcherClass();
