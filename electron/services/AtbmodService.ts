// electron/services/AtbmodService.ts - .atbmod 模块管理
// 对应原 Loadatbmod.bat(M5)
//
// 逻辑保真(命令参数与原 .bat 逐字一致):
//   Loadatbmod.bat 流程:
//     1. 收集 *.atbmod 文件
//     2. 对每个 .atbmod 文件:
//        a) 创建临时目录 mod/atbmod_<nutime>_tmp/
//        b) 7z.exe x <file> -o<tempdir> -y
//        c) 检查 atbmod.prop 是否存在(否则失败)
//        d) 从 atbmod.prop 读 modid/modname/modversion/modversioncode/modtype
//           必须有 modid 和 modversioncode
//        e) 用户确认安装(yesno)
//        f) 找 install.bat 或 install.exe
//        g) 执行(install.bat 用 call,install.exe 直接调用)
//        h) 安装成功:
//           - 若 mod/<modid>/ 已存在,重命名为 mod/<modid>_old
//           - 重命名 mod/<tempdir> 为 mod/<modid>
//           - 重命名 .atbmod 文件为 .atbmod.end
//        i) 安装失败:删除 tempdir,重命名 .atbmod 为 .atbmod.end
//
// 注:本服务暴露 scan/install/listInstalled/uninstall 四个方法
//    scan() 扫描 *.atbmod 文件,返回基本信息(不解压)
//    install(file) 完整执行一次安装流程
//    listInstalled() 列出 mod/ 下的目录(排除 _old 和 _tmp 后缀)
//    uninstall(modid) 删除 mod/<modid>/(可选:转 _old 备份)

import { SubprocessPool } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('AtbmodService');

/** atbmod.prop 解析结果 */
export interface AtbmodProp {
  modid: string;
  modname: string;
  modversion: string;
  modversioncode: string;
  modtype: string;
}

/** 扫描到的 .atbmod 文件信息 */
export interface AtbmodFile {
  /** 文件完整路径 */
  path: string;
  /** 文件名 */
  filename: string;
  /** 文件大小(字节) */
  size: number;
}

/** 已安装模块 */
export interface InstalledAtbmod {
  modid: string;
  /** mod/<modid> 目录完整路径 */
  dir: string;
  /** 是否有 atbmod.prop(可读取元信息) */
  hasProp: boolean;
  /** atbmod.prop 解析结果(若存在) */
  prop?: AtbmodProp;
}

/** 安装结果 */
export interface AtbmodInstallResult {
  success: boolean;
  modid?: string;
  error?: string;
}

class AtbmodServiceClass {
  /** 工作目录:resources/bin/mod(对应原 .bat 在 bin 目录下创建 mod/) */
  private get modDir(): string {
    return path.join(paths.bin, 'mod');
  }

  /** 7z.exe 路径 */
  private get sevenZip(): string {
    return paths.binFile('7z.exe');
  }

  /**
   * 扫描 *.atbmod 文件
   * 对应 Loadatbmod.bat 开头:for %%f in (*.atbmod) do ...
   */
  async scan(): Promise<AtbmodFile[]> {
    const result: AtbmodFile[] = [];
    try {
      const entries = await fs.promises.readdir(paths.bin);
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.atbmod')) continue;
        const full = path.join(paths.bin, entry);
        try {
          const stat = await fs.promises.stat(full);
          if (stat.isFile()) {
            result.push({ path: full, filename: entry, size: stat.size });
          }
        } catch {
          // skip
        }
      }
    } catch (e) {
      logger.warn(`扫描 .atbmod 文件失败: ${(e as Error).message}`);
    }
    return result;
  }

  /**
   * 安装一个 .atbmod 文件
   * 对应 Loadatbmod.bat :ProcessModule 完整流程
   */
  async install(file: string): Promise<AtbmodInstallResult> {
    if (!fs.existsSync(file)) {
      return { success: false, error: '文件已不存在,跳过' };
    }

    // a) 创建 mod 目录(若不存在)+ 临时目录 mod/atbmod_<nutime>_tmp/
    if (!fs.existsSync(this.modDir)) {
      fs.mkdirSync(this.modDir, { recursive: true });
    }
    const nutime = String(Date.now());
    const tempDir = path.join(this.modDir, `atbmod_${nutime}_tmp`);
    fs.mkdirSync(tempDir, { recursive: true });

    // b) 7z.exe x <file> -o<tempdir> -y
    try {
      await SubprocessPool.spawn({
        cmd: this.sevenZip,
        args: ['x', file, `-o${tempDir}`, '-y'],
        encoding: 'utf-8',
        timeout: 60000,
        cwd: paths.bin,
      });
    } catch (e) {
      // 解压失败:删 tempdir,重命名 .atbmod 为 .end
      this.rmdir(tempDir);
      this.markAsEnd(file);
      return { success: false, error: `解压失败,模块可能已损坏: ${(e as Error).message}` };
    }

    // c) 检查 atbmod.prop 是否存在
    const propPath = path.join(tempDir, 'atbmod.prop');
    if (!fs.existsSync(propPath)) {
      this.rmdir(tempDir);
      this.markAsEnd(file);
      return { success: false, error: '模块不完整或格式不正确,缺少 atbmod.prop' };
    }

    // d) 从 atbmod.prop 读 modid/modname/modversion/modversioncode/modtype
    const prop = this.parseProp(propPath);
    if (!prop.modid) {
      this.rmdir(tempDir);
      this.markAsEnd(file);
      return { success: false, error: '模块不完整或格式不正确,缺少 modid' };
    }
    if (!prop.modversioncode) {
      this.rmdir(tempDir);
      this.markAsEnd(file);
      return { success: false, error: '模块不完整或格式不正确,缺少 modversioncode' };
    }
    logger.info(`模块名称: ${prop.modname}, 版本: ${prop.modversion}, 类型: ${prop.modtype}`);

    // e) 用户确认(由 UI 调用方负责,本服务直接执行)
    // 原 .bat:menu.exe yesno.json → set /p CONFIRM

    // f) 找 install.bat 或 install.exe
    let installer: string | null = null;
    const installBat = path.join(tempDir, 'install.bat');
    const installExe = path.join(tempDir, 'install.exe');
    if (fs.existsSync(installBat)) {
      installer = installBat;
    } else if (fs.existsSync(installExe)) {
      installer = installExe;
    }
    if (!installer) {
      this.rmdir(tempDir);
      this.markAsEnd(file);
      return { success: false, error: '模块不完整或格式不正确,缺少 install.bat/install.exe' };
    }

    // g) 执行安装(对应:pushd <tempdir> & call/.exe & popd)
    let exitCode = 0;
    try {
      if (installer.toLowerCase().endsWith('.bat')) {
        const result = await SubprocessPool.spawn({
          cmd: 'cmd.exe',
          args: ['/c', installer],
          encoding: 'gbk',
          timeout: 300000,
          cwd: tempDir,
          onStdout: (line) => logger.debug(`atbmod install: ${line}`),
        });
        exitCode = result.exitCode ?? 0;
      } else {
        const result = await SubprocessPool.spawn({
          cmd: installer,
          args: [],
          encoding: 'gbk',
          timeout: 300000,
          cwd: tempDir,
        });
        exitCode = result.exitCode ?? 0;
      }
    } catch (e) {
      this.rmdir(tempDir);
      this.markAsEnd(file);
      return { success: false, error: `安装出错: ${(e as Error).message}` };
    }

    // h) 处理安装结果
    if (exitCode !== 0) {
      this.rmdir(tempDir);
      this.markAsEnd(file);
      return { success: false, error: `安装出错,错误码 ${exitCode}` };
    }

    // 安装成功:若 mod/<modid>/ 已存在,重命名为 mod/<modid>_old
    const targetDir = path.join(this.modDir, prop.modid);
    if (fs.existsSync(targetDir)) {
      const oldDir = path.join(this.modDir, `${prop.modid}_old`);
      if (fs.existsSync(oldDir)) {
        this.rmdir(oldDir);
      }
      fs.renameSync(targetDir, oldDir);
    }
    // 重命名 tempDir 为 mod/<modid>
    fs.renameSync(tempDir, targetDir);
    // 重命名 .atbmod 文件为 .end
    this.markAsEnd(file);

    logger.info(`模块安装完成: ${prop.modid}`);
    return { success: true, modid: prop.modid };
  }

  /**
   * 列出已安装的 .atbmod 模块
   * 对应 Loadatbmod.bat 开头统计:dir /ad /b mod | findstr /v /e "_old _tmp"
   */
  async listInstalled(): Promise<InstalledAtbmod[]> {
    const result: InstalledAtbmod[] = [];
    if (!fs.existsSync(this.modDir)) {
      return result;
    }
    const entries = await fs.promises.readdir(this.modDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 排除 _old 和 _tmp 后缀
      if (entry.name.endsWith('_old') || entry.name.endsWith('_tmp')) continue;
      const dir = path.join(this.modDir, entry.name);
      const propPath = path.join(dir, 'atbmod.prop');
      const hasProp = fs.existsSync(propPath);
      const item: InstalledAtbmod = {
        modid: entry.name,
        dir,
        hasProp,
      };
      if (hasProp) {
        item.prop = this.parseProp(propPath);
      }
      result.push(item);
    }
    return result;
  }

  /**
   * 卸载已安装的 .atbmod 模块
   * 删除 mod/<modid>/ 目录
   * (原 .bat 没有专门的卸载,这里新增)
   */
  async uninstall(modid: string): Promise<{ success: boolean; error?: string }> {
    const targetDir = path.join(this.modDir, modid);
    if (!fs.existsSync(targetDir)) {
      return { success: false, error: `模块不存在: ${modid}` };
    }
    try {
      this.rmdir(targetDir);
      logger.info(`已卸载 atbmod 模块: ${modid}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  // ========== 内部工具 ==========

  /** 解析 atbmod.prop(格式:key=value,逐行读取) */
  private parseProp(propPath: string): AtbmodProp {
    const prop: AtbmodProp = {
      modid: '',
      modname: '',
      modversion: '',
      modversioncode: '',
      modtype: '',
    };
    try {
      const content = fs.readFileSync(propPath, 'utf-8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=]+)=(.*)$/);
        if (!m) continue;
        const key = m[1].trim().toLowerCase();
        const value = m[2].trim();
        switch (key) {
          case 'modid':
            prop.modid = value;
            break;
          case 'modname':
            prop.modname = value;
            break;
          case 'modversion':
            prop.modversion = value;
            break;
          case 'modversioncode':
            prop.modversioncode = value;
            break;
          case 'modtype':
            prop.modtype = value;
            break;
        }
      }
    } catch (e) {
      logger.warn(`解析 atbmod.prop 失败: ${(e as Error).message}`);
    }
    return prop;
  }

  /** 递归删除目录(对应 rd /s /q) */
  private rmdir(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      logger.warn(`删除目录失败: ${dir} - ${(e as Error).message}`);
    }
  }

  /** 重命名 .atbmod 为 .atbmod.end(对应 ren "!MODULE!" "%~nx1.end") */
  private markAsEnd(file: string): void {
    try {
      fs.renameSync(file, `${file}.end`);
    } catch (e) {
      logger.warn(`重命名 .atbmod 为 .end 失败: ${(e as Error).message}`);
    }
  }
}

export const AtbmodService = new AtbmodServiceClass();
