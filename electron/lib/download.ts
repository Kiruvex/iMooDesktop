// electron/lib/download.ts - aria2c 下载封装
// 对应原 curltool.bat:aria2c 多链接下载
// 逻辑保真:参数与原 curltool.bat 一致

import { SubprocessPool } from '../services/SubprocessPool';
import { Logger } from '../services/Logger';
import { paths } from '../core/paths';

const logger = Logger.instance.child('download');

export interface DownloadOptions {
  /** 4 个镜像 URL */
  urls: string[];
  /** 输出文件名 */
  filename: string;
  /** 输出目录(默认 resources/ 对应位置) */
  outputDir: string;
  /** 进度回调(0-100) */
  onProgress?: (percent: number) => void;
  /** 任务 ID(用于取消) */
  taskId?: string;
}

/**
 * 用 aria2c 下载文件(多镜像自适应)
 * 对应原 curltool.bat:
 *   aria2c.exe --uri-selector=adaptive --max-connection-per-server=8 --split=8
 *     --continue=false --allow-overwrite=true --lowest-speed-limit=1M
 *     --user-agent="pan.baidu.com" --check-certificate=false <urls>
 */
export async function downloadWithAria2(opts: DownloadOptions): Promise<string> {
  const aria2cPath = paths.binFile('aria2c.exe');
  const { urls, filename, outputDir, onProgress, taskId } = opts;

  // 原 curltool.bat 参数(逐字一致,见 plan.md 核心约束)
  const args = [
    `--uri-selector=adaptive`,
    `--console-log-level=notice`,
    `--summary-interval=0`,
    `--check-certificate=false`,
    `--max-connection-per-server=8`,
    `--split=8`,
    `--continue=false`,
    `--allow-overwrite=true`,
    `--lowest-speed-limit=1M`,
    `--user-agent=pan.baidu.com`,
    `--dir=${outputDir}`,
    `--out=${filename}`,
    ...urls,
  ];

  logger.info(`开始下载: ${filename}(${urls.length} 个镜像)`);

  const result = await SubprocessPool.spawn({
    cmd: aria2cPath,
    args,
    encoding: 'utf-8',
    timeout: 600000, // 10 分钟
    cwd: paths.bin,
    taskId,
    onStdout: (line) => {
      // 解析进度:aria2c 输出形如 "[#abc 10MiB/100MiB(10%) CN:8 DL:5MiB]"
      const m = line.match(/\((\d+)%\)/);
      if (m && onProgress) {
        onProgress(Number(m[1]));
      }
    },
    onStderr: (line) => logger.debug(`aria2c: ${line}`),
  });

  if (result.exitCode !== 0) {
    throw new Error(`下载失败: ${filename} (exit ${result.exitCode})`);
  }

  const outputPath = `${outputDir}/${filename}`;
  logger.info(`下载完成: ${outputPath}`);
  return outputPath;
}
