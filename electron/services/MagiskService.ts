// electron/services/MagiskService.ts - Magisk 模块管理
// 见 plan.md 6.9 MagiskService
// 对应原 instmodule.bat / unmodule.bat / magisklist.bat / setmagisk.bat
// 设备端 .sh 改名:见 plan.md 2.5.2
//   magisklistmod.sh → list_modules.sh
//   sh_module_installer.sh → module_installer.sh
//   magiskperinster.sh → magisk_force_install.sh
//
// M5:模块商店(对应原项目未直接提供,plan.md M5 新增)
//   storeSearch(query): 对接 https://api.magiskmodule.com/v1/modules?search=
//   若 API 不可用,返回空数组(不抛错)
//   installFromStore(module): 下载 zip → 调用 install(zip, 'magisk')

import { AdbService } from './AdbService';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('MagiskService');

export type InstallMethod = 'magisk' | 'shinst' | 'peremptory';
export type UninstallMethod = 'mark' | 'direct' | 'script';

export interface MagiskModule {
  id: string;
  name: string;
  version: string;
  versionCode: string;
  author: string;
  status: string;
  description: string;
  updateJson: string;
}

class MagiskServiceClass {
  /**
   * 列出已安装模块
   * 对应 magisklist.bat:push list_modules.sh → su -c sh → 解析输出
   */
  async list(): Promise<MagiskModule[]> {
    // 检查 root
    const rootResult = await AdbService.root();
    if (!rootResult.granted) {
      throw new Error('没有 root 权限');
    }

    // push list_modules.sh(原名 magisklistmod.sh,改名见 plan.md 2.5.2)
    const scriptPath = paths.scriptFile('list_modules.sh');
    await AdbService.push(scriptPath, '/data/local/tmp/list_modules.sh');

    // 执行(原:adb shell "su -c sh /data/local/tmp/magisklistmod.sh")
    const output = await AdbService.shell('sh /data/local/tmp/list_modules.sh', {
      timeout: 15000,
      root: true,
    });

    // 解析输出(格式见 list_modules.sh:每行 "键: 值",模块间用 === 分隔)
    return this.parseModuleList(output);
  }

  /** 解析 list_modules.sh 的输出 */
  private parseModuleList(output: string): MagiskModule[] {
    const modules: MagiskModule[] = [];
    const blocks = output.split(/={40,}/).filter((b) => b.trim());

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const mod: Partial<MagiskModule> = {};
      for (const line of lines) {
        const m = line.match(/^(.+?):\s*(.*)$/);
        if (!m) continue;
        const [, key, value] = m;
        const val = value.trim();
        switch (key.trim()) {
          case '模块ID':
            mod.id = val;
            break;
          case '名称':
            mod.name = val;
            break;
          case '版本':
            mod.version = val;
            break;
          case '内部版本':
            mod.versionCode = val;
            break;
          case '作者':
            mod.author = val;
            break;
          case '状态':
            mod.status = val;
            break;
          case '描述':
            mod.description = val;
            break;
          case '更新地址':
            mod.updateJson = val;
            break;
        }
      }
      if (mod.id) {
        modules.push(mod as MagiskModule);
      }
    }

    return modules;
  }

  /**
   * 安装模块
   * 对应 instmodule.bat:magisk / shinst / peremptory 三种方式
   */
  async install(zipPath: string, method: InstallMethod): Promise<{ success: boolean; error?: string }> {
    // 检查 root
    const rootResult = await AdbService.root();
    if (!rootResult.granted) {
      return { success: false, error: '没有 root 权限' };
    }

    switch (method) {
      case 'magisk':
        return this.installMagisk(zipPath);
      case 'shinst':
        return this.installShinst(zipPath);
      case 'peremptory':
        return this.installPeremptory(zipPath);
    }
  }

  // 对应 instmodule.bat :magisk
  // adb push zip → su -c 'magisk --install-module /sdcard/temp_module.zip' → rm
  private async installMagisk(zipPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 原:adb push %args1% /sdcard/temp_module.zip
      await AdbService.push(zipPath, '/sdcard/temp_module.zip');
      // 原:adb shell "su -c 'magisk --install-module /sdcard/temp_module.zip'; exit $?"
      await AdbService.shell('magisk --install-module /sdcard/temp_module.zip', {
        timeout: 60000,
        root: true,
      });
      // 原:adb shell rm /sdcard/temp_module.zip
      await AdbService.shell('rm /sdcard/temp_module.zip', { timeout: 5000 });
      logger.info(`模块安装成功(magisk): ${zipPath}`);
      return { success: true };
    } catch (e) {
      // 清理(对应 instmodule.bat :error)
      try {
        await AdbService.shell('rm /sdcard/temp_module.zip', { timeout: 5000 });
      } catch {
        // ignore
      }
      return { success: false, error: (e as Error).message };
    }
  }

  // 对应 instmodule.bat :shinst
  // adb push zip + module_installer.sh → su -c 'sh /sdcard/module_installer.sh' → rm
  private async installShinst(zipPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 原:adb push %args1% /sdcard/temp_module.zip
      await AdbService.push(zipPath, '/sdcard/temp_module.zip');
      // 原:adb push sh_module_installer.sh /sdcard/sh_module_installer.sh(改名见 plan.md 2.5.2)
      const scriptPath = paths.scriptFile('module_installer.sh');
      await AdbService.push(scriptPath, '/sdcard/module_installer.sh');
      // 原:adb shell "su -c 'sh /sdcard/sh_module_installer.sh'; exit $?"
      await AdbService.shell('sh /sdcard/module_installer.sh', {
        timeout: 60000,
        root: true,
      });
      // 清理
      await AdbService.shell('rm /sdcard/temp_module.zip /sdcard/module_installer.sh', {
        timeout: 5000,
      });
      logger.info(`模块安装成功(shinst): ${zipPath}`);
      return { success: true };
    } catch (e) {
      try {
        await AdbService.shell('rm /sdcard/temp_module.zip /sdcard/module_installer.sh', {
          timeout: 5000,
        });
      } catch {
        // ignore
      }
      return { success: false, error: (e as Error).message };
    }
  }

  // 对应 instmodule.bat :peremptory
  // adb push magisk_force_install.sh + zip → su -c 'sh /sdcard/magisk_force_install.sh' → rm
  private async installPeremptory(zipPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 原:adb push magiskperinster.sh /sdcard/magiskperinster.sh(改名见 plan.md 2.5.2)
      const scriptPath = paths.scriptFile('magisk_force_install.sh');
      await AdbService.push(scriptPath, '/sdcard/magisk_force_install.sh');
      // 原:adb push %args1% /sdcard/temp_module.zip
      await AdbService.push(zipPath, '/sdcard/temp_module.zip');
      // 原:adb shell "su -c 'sh /sdcard/magiskperinster.sh'; exit $?"
      await AdbService.shell('sh /sdcard/magisk_force_install.sh', {
        timeout: 60000,
        root: true,
      });
      // 清理
      await AdbService.shell('rm /sdcard/temp_module.zip /sdcard/magisk_force_install.sh', {
        timeout: 5000,
      });
      logger.info(`模块安装成功(peremptory): ${zipPath}`);
      return { success: true };
    } catch (e) {
      try {
        await AdbService.shell('rm /sdcard/temp_module.zip /sdcard/magisk_force_install.sh', {
          timeout: 5000,
        });
      } catch {
        // ignore
      }
      return { success: false, error: (e as Error).message };
    }
  }

  /**
   * 卸载模块
   * 对应 unmodule.bat:mark / direct / script 三种方式
   */
  async uninstall(moduleId: string, method: UninstallMethod): Promise<{ success: boolean; error?: string }> {
    // 检查 root(对应:call adbdevice root)
    const rootResult = await AdbService.root();
    if (!rootResult.granted) {
      return { success: false, error: '没有 root 权限' };
    }

    // 检查模块是否存在(对应:adb shell "%suroot% '[ -d /data/adb/modules/%MODULE_ID% ] && echo EXISTS'")
    const existsCheck = await AdbService.shell(
      `[ -d /data/adb/modules/${moduleId} ] && echo EXISTS`,
      { timeout: 5000, root: true },
    );
    if (!existsCheck.includes('EXISTS')) {
      return { success: false, error: `模块不存在: ${moduleId}` };
    }

    switch (method) {
      case 'mark':
        return this.uninstallMark(moduleId);
      case 'direct':
        return this.uninstallDirect(moduleId);
      case 'script':
        return this.uninstallScript(moduleId);
    }
  }

  // 对应 unmodule.bat :MarkRemove
  // touch /data/adb/modules/<id>/remove
  private async uninstallMark(moduleId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 原:adb shell "%suroot% 'touch /data/adb/modules/%MODULE_ID%/remove'"
      await AdbService.shell(`touch /data/adb/modules/${moduleId}/remove`, {
        timeout: 5000,
        root: true,
      });
      // 验证(对应:[ -f remove ] && echo OK)
      const check = await AdbService.shell(
        `[ -f /data/adb/modules/${moduleId}/remove ] && echo OK`,
        { timeout: 5000, root: true },
      );
      if (!check.includes('OK')) {
        return { success: false, error: '创建标记卸载文件失败' };
      }
      logger.info(`模块标记卸载成功: ${moduleId}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  // 对应 unmodule.bat :DirectRemove
  // touch disable && sleep 1 && rm -rf
  private async uninstallDirect(moduleId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 原:adb shell "%suroot% 'touch disable && sleep 1 && rm -rf /data/adb/modules/%MODULE_ID%'"
      await AdbService.shell(
        `touch /data/adb/modules/${moduleId}/disable && sleep 1 && rm -rf /data/adb/modules/${moduleId}`,
        { timeout: 10000, root: true },
      );
      // 验证
      const check = await AdbService.shell(
        `[ ! -d /data/adb/modules/${moduleId} ] && echo OK`,
        { timeout: 5000, root: true },
      );
      if (!check.includes('OK')) {
        return { success: false, error: '删除模块目录失败' };
      }
      logger.info(`模块直接卸载成功: ${moduleId}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  // 对应 unmodule.bat :ScriptRemove
  // 执行 uninstall.sh + rm -rf
  private async uninstallScript(moduleId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 原:adb shell "%suroot% 'if [ -f uninstall.sh ]; then sh uninstall.sh; fi; rm -rf %MODULE_ID%'"
      await AdbService.shell(
        `if [ -f /data/adb/modules/${moduleId}/uninstall.sh ]; then sh /data/adb/modules/${moduleId}/uninstall.sh; else echo NO_SCRIPT; fi; rm -rf /data/adb/modules/${moduleId}`,
        { timeout: 15000, root: true },
      );
      // 验证
      const check = await AdbService.shell(
        `[ ! -d /data/adb/modules/${moduleId} ] && echo OK`,
        { timeout: 5000, root: true },
      );
      if (!check.includes('OK')) {
        return { success: false, error: '删除模块目录失败' };
      }
      logger.info(`模块脚本卸载成功: ${moduleId}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /** 启用模块(touch disable 的反操作:rm disable) */
  async enable(moduleId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await AdbService.shell(`rm /data/adb/modules/${moduleId}/disable`, {
        timeout: 5000,
        root: true,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /** 禁用模块(touch disable) */
  async disable(moduleId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await AdbService.shell(`touch /data/adb/modules/${moduleId}/disable`, {
        timeout: 5000,
        root: true,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  // ========== 模块商店(M5 新增) ==========

  /** 商店模块类型 */
  async storeSearch(query: string): Promise<StoreModule[]> {
    if (!query || !query.trim()) {
      return [];
    }
    const url = `https://api.magiskmodule.com/v1/modules?search=${encodeURIComponent(query)}`;
    logger.info(`搜索 Magisk 模块: ${query}`);

    try {
      const data = await this.httpsGetJson(url);
      if (!Array.isArray(data)) {
        return [];
      }
      // 字段映射(模块商店 API 的常见字段)
      return data.map((m: Record<string, unknown>) => ({
        id: String(m.id ?? m.module_id ?? ''),
        name: String(m.name ?? m.title ?? ''),
        description: String(m.description ?? ''),
        author: String(m.author ?? ''),
        version: String(m.version ?? ''),
        versionCode: String(m.version_code ?? m.versionCode ?? ''),
        downloadUrl: String(m.zip_url ?? m.download_url ?? m.link ?? ''),
        homepage: String(m.homepage ?? m.url ?? ''),
        lastUpdate: String(m.last_update ?? m.lastUpdate ?? ''),
      }));
    } catch (e) {
      // API 不可用,fallback 到空数组(不抛错,见 plan.md)
      logger.warn(`模块商店搜索失败,返回空列表: ${(e as Error).message}`);
      return [];
    }
  }

  /** 从商店下载并安装模块 */
  async installFromStore(module: StoreModule): Promise<{ success: boolean; error?: string }> {
    if (!module.downloadUrl) {
      return { success: false, error: '模块缺少下载地址' };
    }
    try {
      // 下载到 cache 目录
      if (!fs.existsSync(paths.cache)) {
        fs.mkdirSync(paths.cache, { recursive: true });
      }
      const filename = `${module.id || 'store_module'}_${Date.now()}.zip`;
      const localPath = path.join(paths.cache, filename);
      logger.info(`下载商店模块: ${module.downloadUrl} → ${localPath}`);
      await this.httpsDownload(module.downloadUrl, localPath);
      // 调用 magisk 方式安装
      const result = await this.install(localPath, 'magisk');
      // 安装完成后清理本地 zip(对应 instmodule.bat 的 rm temp_module.zip)
      try {
        fs.unlinkSync(localPath);
      } catch {
        // ignore
      }
      return result;
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /** HTTPS GET JSON(模块商店 API) */
  private httpsGetJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: { 'User-Agent': 'iMooDesktop/1.0' },
          timeout: 15000,
        },
        (res) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          let body = '';
          res.setEncoding('utf-8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`JSON 解析失败: ${(e as Error).message}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('请求超时'));
      });
    });
  }

  /** HTTPS 下载文件到本地(流式) */
  private httpsDownload(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const req = https.get(
        url,
        {
          headers: { 'User-Agent': 'iMooDesktop/1.0' },
          timeout: 120000,
        },
        (res) => {
          // 处理重定向
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            try { fs.unlinkSync(destPath); } catch { /* ignore */ }
            this.httpsDownload(res.headers.location, destPath).then(resolve, reject);
            return;
          }
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            file.close();
            try { fs.unlinkSync(destPath); } catch { /* ignore */ }
            reject(new Error(`下载失败: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close(() => resolve());
          });
        },
      );
      req.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch { /* ignore */ }
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy(new Error('下载超时'));
      });
    });
  }
}

/** 商店模块类型 */
export interface StoreModule {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  versionCode: string;
  downloadUrl: string;
  homepage: string;
  lastUpdate: string;
}

export const MagiskService = new MagiskServiceClass();
