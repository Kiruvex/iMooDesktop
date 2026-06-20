// electron/services/UpdateService.ts - 应用自更新检查
// 对应 plan.md M5 自更新(用 https GET 检查 latest.yml,不引入 electron-updater)
//
// 检查流程:
//   1. 拉 4 镜像站的 latest.yml(任一成功即可)
//   2. 解析 yml 中的 version 字段
//   3. 与本地 APP_META.version 比较
//   4. 若有新版本:返回 updateAvailable=true + version + downloadUrl
//
// 不引入 electron-updater(避免依赖),由 UI 提示用户手动下载安装
//
// 注:GitHub Releases 用 latest.yml(electron-builder 自动生成)
//    4 镜像站复用 links.json 中的 mirrors(原项目的下载基础设施)

import https from 'node:https';
import { Logger } from './Logger';
import { APP_META } from '../../shared/types';
import { paths } from '../core/paths';
import fs from 'node:fs';

const logger = Logger.instance.child('UpdateService');

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  error?: string;
}

class UpdateServiceClass {
  /**
   * 检查应用更新
   * 实现:从 links.json 配置的镜像站拉取 latest.yml(多镜像 fallback,任意一个成功即可)
   * 兜底:GitHub Releases;解析 electron-builder 的 latest.yml 格式(version/path/releaseDate)
   */
  async checkAppUpdate(): Promise<UpdateInfo> {
    const currentVersion = APP_META.version;
    const info: UpdateInfo = {
      hasUpdate: false,
      currentVersion,
    };

    // 4 镜像站(从 links.json 读,失败则用默认 GitHub)
    const mirrors = this.loadMirrors();
    // latest.yml 通常在镜像站根目录
    const urls = mirrors.map((m) => `${m}latest.yml`);
    // 兜底:GitHub Releases
    if (urls.length === 0) {
      urls.push('https://github.com/iMooDesktop/iMooDesktop/releases/latest/download/latest.yml');
    }

    let ymlContent: string | null = null;
    let usedUrl = '';
    for (const url of urls) {
      try {
        logger.info(`尝试从 ${url} 拉取 latest.yml`);
        ymlContent = await this.httpsGetText(url, 10000);
        usedUrl = url;
        break;
      } catch (e) {
        logger.debug(`拉取失败: ${url} - ${(e as Error).message}`);
      }
    }

    if (!ymlContent) {
      info.error = '所有镜像站均无法访问,请检查网络';
      return info;
    }

    // 解析 yml(electron-builder latest.yml 格式:version: x.y.z + path: xxx + releaseDate)
    const versionMatch = ymlContent.match(/^version:\s*(.+)$/m);
    if (!versionMatch) {
      info.error = 'latest.yml 格式异常(无 version 字段)';
      return info;
    }
    const latestVersion = versionMatch[1].trim();
    info.latestVersion = latestVersion;

    // 提取 releaseNotes(若有 releaseNotes 字段)
    const notesMatch = ymlContent.match(/^releaseNotes:\s*(.+)$/m);
    if (notesMatch) {
      info.releaseNotes = notesMatch[1].trim();
    }

    // 提取下载 URL(若有 path 字段)
    const pathMatch = ymlContent.match(/^path:\s*(.+)$/m);
    if (pathMatch) {
      const baseUrl = usedUrl.replace(/latest\.yml$/, '');
      info.releaseUrl = baseUrl + pathMatch[1].trim();
    } else {
      // fallback:GitHub Releases 页面
      info.releaseUrl = 'https://github.com/iMooDesktop/iMooDesktop/releases/latest';
    }

    // 版本比较(简单字符串比较 + 数字段比较)
    info.hasUpdate = this.compareVersion(latestVersion, currentVersion) > 0;
    logger.info(
      `更新检查: current=${currentVersion}, latest=${latestVersion}, hasUpdate=${info.hasUpdate}`,
    );
    return info;
  }

  /** 简单 HTTPS GET 文本 */
  private httpsGetText(url: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: { 'User-Agent': 'iMooDesktop/1.0' },
          timeout: timeoutMs,
        },
        (res) => {
          // 重定向
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            this.httpsGetText(res.headers.location, timeoutMs).then(resolve, reject);
            return;
          }
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
          res.on('end', () => resolve(body));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('请求超时'));
      });
    });
  }

  /** 从 links.json 加载 mirrors */
  private loadMirrors(): string[] {
    try {
      const content = fs.readFileSync(paths.dataFile('links.json'), 'utf-8');
      const config = JSON.parse(content) as { mirrors?: string[] };
      return config.mirrors ?? [];
    } catch {
      return [];
    }
  }

  /** 版本比较:返回正数 a>b,0 相等,负数 a<b */
  private compareVersion(a: string, b: string): number {
    const partsA = a.split('.');
    const partsB = b.split('.');
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
      const numA = parseInt(partsA[i] ?? '0', 10) || 0;
      const numB = parseInt(partsB[i] ?? '0', 10) || 0;
      if (numA !== numB) return numA - numB;
    }
    return 0;
  }
}

export const UpdateService = new UpdateServiceClass();
