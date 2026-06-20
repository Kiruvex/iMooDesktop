// electron/services/CloudService.ts - 资源下载 + 版本管理
// 见 plan.md 6.12 CloudService
// 对应原 cloud.bat / link.bat / curltool.bat / resvertool.bat

import fs from 'node:fs';
import { TIMEOUT } from '../lib/timeouts';
import path from 'node:path';
import { SubprocessPool } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import { downloadWithAria2 } from '../lib/download';

const logger = Logger.instance.child('CloudService');

export interface CloudResource {
  /** 资源短名(如 userdata) */
  name: string;
  /** 文件名(如 userdata.img) */
  filename: string;
  /** 是否必需 */
  required: boolean;
  /** 是否解压 */
  extract: boolean;
  /** 解压目标(相对 resources/) */
  extractTo?: string;
  /** 分类 */
  category: string;
  /** 描述 */
  description: string;
  /** 云端版本 */
  cloudVersion?: string;
  /** 本地版本 */
  localVersion?: string;
}

interface LinksConfig {
  mirrors: string[];
  resources: Record<string, Omit<CloudResource, 'name' | 'cloudVersion' | 'localVersion'>>;
}

class CloudServiceClass {
  private linksConfig: LinksConfig | null = null;

  /** 加载 links.json */
  private loadConfig(): LinksConfig {
    if (this.linksConfig) return this.linksConfig;
    try {
      const content = fs.readFileSync(paths.dataFile('links.json'), 'utf-8');
      const config: LinksConfig = JSON.parse(content);
      this.linksConfig = config;
      return config;
    } catch (e) {
      logger.error(`加载 links.json 失败: ${(e as Error).message}`);
      return { mirrors: [], resources: {} };
    }
  }

  /** 列出所有资源(排除"版本"分类,那些是内部用的) */
  async list(): Promise<CloudResource[]> {
    const config = this.loadConfig();
    return Object.entries(config.resources)
      .filter(([, r]) => r.category !== '版本' && r.category !== '工具箱')
      .map(([name, r]) => ({
        name,
        ...r,
        localVersion: this.getLocalVersion(name),
      }));
  }

  /** 按分类列出 */
  async listByCategory(): Promise<Record<string, CloudResource[]>> {
    const all = await this.list();
    const grouped: Record<string, CloudResource[]> = {};
    for (const r of all) {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    }
    return grouped;
  }

  /** 下载单个资源 */
  async download(
    name: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const config = this.loadConfig();
    const res = config.resources[name];
    if (!res) {
      throw new Error(`未知资源: ${name}`);
    }

    // 构造 4 个镜像 URL
    const urls = config.mirrors.map((m) => `${m}${res.filename}`);
    if (urls.length === 0) {
      throw new Error('无可用镜像');
    }

    // 输出目录:res.extractTo 或 resources/cache/
    const outputDir = res.extractTo
      ? path.join(paths.resources, res.extractTo)
      : paths.cache;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    logger.info(`下载资源: ${name} → ${outputDir}/${res.filename}`);
    await downloadWithAria2({
      urls,
      filename: res.filename,
      outputDir,
      onProgress,
    });

    // 解压(若需要)
    if (res.extract) {
      const zipPath = path.join(outputDir, res.filename);
      const extractTo = path.join(paths.resources, res.extractTo ?? '');
      if (!fs.existsSync(extractTo)) {
        fs.mkdirSync(extractTo, { recursive: true });
      }
      logger.info(`解压: ${zipPath} → ${extractTo}`);
      await SubprocessPool.spawn({
        cmd: paths.binFile('7z.exe'),
        args: ['x', zipPath, `-o${extractTo}`, '-aoa'],
        encoding: 'utf-8',
        timeout: TIMEOUT.install,
        cwd: paths.bin,
        onStdout: (line) => logger.debug(`7z: ${line}`),
      });
    }

    logger.info(`资源 ${name} 处理完成`);
  }

  /** 下载多个资源 */
  async downloadMultiple(
    names: string[],
    onProgress?: (name: string, percent: number) => void,
  ): Promise<void> {
    for (const name of names) {
      await this.download(name, (p) => onProgress?.(name, p));
    }
  }

  /** 获取本地资源版本(从 resversion.json) */
  private getLocalVersion(name: string): string | undefined {
    try {
      const content = fs.readFileSync(paths.dataFile('resversion.json'), 'utf-8');
      const versions = JSON.parse(content) as Record<string, string>;
      return versions[name];
    } catch {
      return undefined;
    }
  }

  /** 检查更新(比对本地 vs 云端版本) */
  async checkUpdates(): Promise<{ resource: CloudResource; updateAvailable: boolean }[]> {
    const local = await this.list();
    // 拉取云端 resversion.txt
    const cloudVersions: Record<string, string> = {};
    try {
      const config = this.loadConfig();
      const urls = config.mirrors.map((m) => `${m}resversion.txt`);
      // 用 aria2c 下载到临时目录
      const tmpDir = paths.cache;
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      await downloadWithAria2({
        urls,
        filename: 'resversion.txt',
        outputDir: tmpDir,
      });
      const content = fs.readFileSync(path.join(tmpDir, 'resversion.txt'), 'utf-8');
      // 解析 "key=value" 格式
      for (const line of content.split('\n')) {
        const m = line.match(/^(\S+?)=(.+)$/);
        if (m) {
          cloudVersions[m[1]] = m[2].trim();
        }
      }
    } catch (e) {
      logger.warn(`拉取云端版本失败: ${(e as Error).message}`);
    }

    return local.map((r) => ({
      resource: { ...r, cloudVersion: cloudVersions[r.name] },
      updateAvailable: Boolean(
        cloudVersions[r.name] && cloudVersions[r.name] !== r.localVersion,
      ),
    }));
  }
}

export const CloudService = new CloudServiceClass();
