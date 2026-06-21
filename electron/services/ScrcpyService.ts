// electron/services/ScrcpyService.ts - scrcpy 投屏管理
// 见 plan.md 6.13 ScrcpyService
// 对应原 scrcpy-ui.bat + scrcpy-noconsole.vbs
// 18 个参数对应原 scrcpy-ui.json
//
// 事件驱动:launch/exit 时 emit 'process-change' 事件,IPC 层转发到前端,替代轮询

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
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

/** 进程变化事件数据 */
export interface ScrcpyProcessChange {
  type: 'launch' | 'exit';
  pid: number;
  code?: number;  // exit 时的退出码
}

class ScrcpyServiceClass extends EventEmitter {
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

    // 推送 launch 事件
    this.emit('process-change', { type: 'launch', pid } satisfies ScrcpyProcessChange);

    proc.on('error', (err) => {
      logger.error(`scrcpy 启动失败: ${err.message}`);
      this.running.delete(pid);
      this.emit('process-change', { type: 'exit', pid } satisfies ScrcpyProcessChange);
    });

    proc.on('exit', (code) => {
      logger.info(`scrcpy 退出(pid=${pid}, code=${code})`);
      // 只有还在 running 里时才 emit(stop() 已经删除并 emit 过的不再重复)
      if (this.running.has(pid)) {
        this.running.delete(pid);
        this.emit('process-change', { type: 'exit', pid, code: code ?? undefined } satisfies ScrcpyProcessChange);
      }
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
    // 先从 running 删除,这样 proc.on('exit') 不会再重复 emit
    this.running.delete(pid);
    try {
      entry.process.kill();
      logger.info(`已停止 scrcpy pid=${pid}`);
    } catch (e) {
      logger.error(`停止 scrcpy 失败: ${(e as Error).message}`);
    }
    // 推送 exit 事件(proc.on('exit') 里 running 已无此 pid,不会再 emit)
    this.emit('process-change', { type: 'exit', pid } satisfies ScrcpyProcessChange);
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
