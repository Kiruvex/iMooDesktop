// electron/services/ScrcpyService.ts - scrcpy 投屏管理
// 见 plan.md 6.13 ScrcpyService
// 对应原 scrcpy-ui.bat + scrcpy-noconsole.vbs
// 18 个参数对应原 scrcpy-ui.json

import { spawn, ChildProcess } from 'node:child_process';
import { Logger } from './Logger';
import { paths } from '../core/paths';

const logger = Logger.instance.child('ScrcpyService');

export interface ScrcpyOptions {
  noControl?: boolean;          // --no-control
  turnScreenOff?: boolean;      // --turn-screen-off
  stayAwake?: boolean;          // --stay-awake
  record?: string;              // --record <file>
  noAudio?: boolean;            // --no-audio
  audio?: boolean;              // --audio
  noClipboardAutosync?: boolean; // --no-clipboard-autosync
  legacyPaste?: boolean;        // --legacy-paste
  showTouches?: boolean;        // --show-touches
  maxFps?: number;              // --max-fps <n>
  alwaysOnTop?: boolean;        // --always-on-top
  fullscreen?: boolean;         // --fullscreen
  windowBorderless?: boolean;   // --window-borderless
  recordFormat?: 'mp4' | 'mkv'; // --record-format <fmt>
  bitRate?: number;             // --bit-rate <n>
  crop?: string;                // --crop <w:h:x:y>
  windowTitle?: string;         // --window-title <text>
  maxSize?: number;             // --max-size <n>
}

interface RunningScrcpy {
  pid: number;
  opts: ScrcpyOptions;
  process: ChildProcess;
  startedAt: number;
}

class ScrcpyServiceClass {
  private scrcpyPath = paths.binFile('scrcpy.exe');
  private running = new Map<number, RunningScrcpy>();

  /** 启动 scrcpy,返回 pid */
  async launch(opts: ScrcpyOptions): Promise<number> {
    const args = this.buildArgs(opts);

    logger.info(`启动 scrcpy: ${args.join(' ')}`);

    const proc = spawn(this.scrcpyPath, args, {
      cwd: paths.bin,
      windowsHide: false,
      detached: false,
    });

    const pid = proc.pid ?? -1;
    const entry: RunningScrcpy = { pid, opts, process: proc, startedAt: Date.now() };
    this.running.set(pid, entry);

    proc.on('error', (err) => {
      logger.error(`scrcpy 启动失败: ${err.message}`);
      this.running.delete(pid);
    });

    proc.on('exit', (code) => {
      logger.info(`scrcpy 退出(pid=${pid}, code=${code})`);
      this.running.delete(pid);
    });

    return pid;
  }

  /** 停止指定 scrcpy */
  async stop(pid: number): Promise<void> {
    const entry = this.running.get(pid);
    if (!entry) {
      logger.warn(`scrcpy pid=${pid} 不存在`);
      return;
    }
    try {
      entry.process.kill();
      logger.info(`已停止 scrcpy pid=${pid}`);
    } catch (e) {
      logger.error(`停止 scrcpy 失败: ${(e as Error).message}`);
    }
    this.running.delete(pid);
  }

  /** 停止所有 scrcpy */
  async stopAll(): Promise<void> {
    for (const pid of Array.from(this.running.keys())) {
      await this.stop(pid);
    }
  }

  /** 列出运行中的 scrcpy */
  listRunning(): { pid: number; opts: ScrcpyOptions; startedAt: number }[] {
    return Array.from(this.running.values()).map((e) => ({
      pid: e.pid,
      opts: e.opts,
      startedAt: e.startedAt,
    }));
  }

  /** 构建 scrcpy 命令行参数 */
  private buildArgs(opts: ScrcpyOptions): string[] {
    const args: string[] = [];
    if (opts.noControl) args.push('--no-control');
    if (opts.turnScreenOff) args.push('--turn-screen-off');
    if (opts.stayAwake) args.push('--stay-awake');
    if (opts.record) args.push('--record', opts.record);
    if (opts.noAudio) args.push('--no-audio');
    if (opts.audio) args.push('--audio');
    if (opts.noClipboardAutosync) args.push('--no-clipboard-autosync');
    if (opts.legacyPaste) args.push('--legacy-paste');
    if (opts.showTouches) args.push('--show-touches');
    if (opts.maxFps) args.push('--max-fps', String(opts.maxFps));
    if (opts.alwaysOnTop) args.push('--always-on-top');
    if (opts.fullscreen) args.push('--fullscreen');
    if (opts.windowBorderless) args.push('--window-borderless');
    if (opts.recordFormat) args.push('--record-format', opts.recordFormat);
    if (opts.bitRate) args.push('--bit-rate', String(opts.bitRate));
    if (opts.crop) args.push('--crop', opts.crop);
    if (opts.windowTitle) args.push('--window-title', opts.windowTitle);
    if (opts.maxSize) args.push('--max-size', String(opts.maxSize));
    return args;
  }
}

export const ScrcpyService = new ScrcpyServiceClass();
