// electron/services/ResourceService.ts - 资源完整性校验
// 见 plan.md 6.14 ResourceService
// 替代原 checkfile.bat(用 MD5 manifest 代替 .backup 副本)

import fs from 'node:fs';
import crypto from 'node:crypto';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import { ManifestEntry, VerifyResult } from '../../shared/types';

const logger = Logger.instance.child('ResourceService');

class ResourceServiceClass {
  private static _instance: ResourceServiceClass;
  private manifestPath = paths.dataFile('manifest.json');

  static get instance(): ResourceServiceClass {
    if (!this._instance) {
      this._instance = new ResourceServiceClass();
    }
    return this._instance;
  }

  private constructor() {}

  /**
   * 校验所有 bin/ 文件的完整性
   * 若 manifest.json 不存在(首次运行或开发模式),返回空数组(不阻塞启动)
   */
  async verify(): Promise<VerifyResult[]> {
    const manifest = this.loadManifest();
    if (!manifest) {
      logger.warn('manifest.json 不存在,跳过校验(首次运行或开发模式)');
      return [];
    }

    const results: VerifyResult[] = [];
    for (const entry of manifest) {
      const fullPath = paths.binFile(entry.file);
      const result = await this.verifyFile(fullPath, entry);
      results.push(result);
      if (!result.ok) {
        logger.warn(`资源校验失败: ${entry.file} (expected=${entry.md5}, actual=${result.actual}, missing=${result.missing})`);
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      logger.info(`资源校验通过(${results.length} 个文件)`);
    } else {
      logger.error(`资源校验失败 ${failed.length}/${results.length} 个文件`);
    }
    return results;
  }

  private async verifyFile(fullPath: string, entry: ManifestEntry): Promise<VerifyResult> {
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        return { file: entry.file, ok: false, expected: entry.md5, actual: '', missing: true };
      }
      const md5 = await this.computeMd5(fullPath);
      return {
        file: entry.file,
        ok: md5 === entry.md5,
        expected: entry.md5,
        actual: md5,
        missing: false,
      };
    } catch {
      return { file: entry.file, ok: false, expected: entry.md5, actual: '', missing: true };
    }
  }

  private computeMd5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private loadManifest(): ManifestEntry[] | null {
    try {
      const content = fs.readFileSync(this.manifestPath, 'utf-8');
      return JSON.parse(content) as ManifestEntry[];
    } catch {
      return null;
    }
  }

  /**
   * 生成 manifest.json(开发时用,扫描 resources/bin/ 计算所有文件 MD5)
   * 运行:`node -e "require('./electron/services/ResourceService').instance.generateManifest()"`
   */
  async generateManifest(): Promise<ManifestEntry[]> {
    const entries: ManifestEntry[] = [];
    const files = fs.readdirSync(paths.bin);
    for (const file of files) {
      const fullPath = paths.binFile(file);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      const md5 = await this.computeMd5(fullPath);
      entries.push({ file, md5, size: stat.size });
    }
    fs.writeFileSync(this.manifestPath, JSON.stringify(entries, null, 2), 'utf-8');
    logger.info(`manifest.json 已生成(${entries.length} 个文件)`);
    return entries;
  }

  /**
   * 修复损坏的文件(从云端重新下载)
   * M5 阶段实现,这里仅占位
   */
  async repair(file: string): Promise<void> {
    logger.warn(`repair() 待 M5 实现: ${file}`);
    throw new Error(`repair() 待 M5 实现: ${file}`);
  }
}

export const ResourceService = ResourceServiceClass;
