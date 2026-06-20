// electron/services/SubprocessPool.ts - 子进程统一管理器
//
// 职责说明(名称为 Pool 但实为 Runner/Manager):
//   本类负责管理所有外部 .exe(adb / fastboot / fh_loader / QSaharaServer / edl-ng / 7z 等)
//   的子进程生命周期,虽名为 "Pool" 但不做进程复用或池化,而是统一封装:
//   - child_process.spawn(非 execFile,避免 stdout 缓冲区限制)
//   - iconv-lite 解码 GBK 输出(原 .exe 多为 GBK 编码)
//   - 行分割:stdout.on('data') 累积,按 \n 切分 emit onStdout 回调
//   - 超时:timeout 到期 → proc.kill('SIGTERM') → 5 秒后 SIGKILL
//   - 取消:外部调 pool.kill(taskId) 终止指定任务
//   - 日志:所有 stdout/stderr 行通过 bus.emit('line') 广播,供日志面板订阅
//
// 命名保留 Pool 是历史原因(管理"池"中所有子进程),实际语义更接近 SubprocessRunner。
// 见 plan.md 6.1 SubprocessPool

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Logger } from './Logger';
import { decode } from '../lib/gbk';

export interface SpawnOptions {
  /** 命令,如 'adb' 或完整路径 */
  cmd: string;
  /** 参数数组,如 ['devices'] */
  args: string[];
  /** 工作目录,默认 resources/bin */
  cwd?: string;
  /** 超时(毫秒),0=不超时 */
  timeout?: number;
  /** 输出编码,默认 'gbk'(原 .exe 多为 GBK) */
  encoding?: 'utf-8' | 'gbk';
  /** 关联任务 ID,用于日志分组和取消 */
  taskId?: string;
  /** 是否捕获 stdout 到完整字符串(默认 true) */
  captureStdout?: boolean;
  /** stdout 行回调 */
  onStdout?: (line: string) => void;
  /** stderr 行回调 */
  onStderr?: (line: string) => void;
  /** 环境变量 */
  env?: NodeJS.ProcessEnv;
  /** 静默模式:不发任何日志(设备检测等高频调用用,默认 false) */
  silent?: boolean;
}

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  signal?: NodeJS.Signals;
  killed: boolean;
}

export interface TaskInfo {
  taskId: string;
  cmd: string;
  args: string[];
  startedAt: number;
  process: ChildProcess;
}

const logger = Logger.instance.child('SubprocessPool');

class SubprocessPoolClass {
  private tasks = new Map<string, TaskInfo>();
  private bus = new EventEmitter();

  /**
   * 执行子进程,等待完成
   * @throws {SpawnError} 退出码非 0 或被 kill
   */
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const { cmd, args, cwd, timeout = 0, encoding = 'gbk', taskId, env } = opts;
    const captureStdout = opts.captureStdout !== false;
    const silent = opts.silent ?? false;
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
        shell: false,
      });

      if (taskId) {
        this.tasks.set(taskId, {
          taskId,
          cmd,
          args,
          startedAt: start,
          process: proc,
        });
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutStr = '';
      let stderrStr = '';
      let stdoutBuf = '';
      let stderrBuf = '';
      let killed = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      // 行分割器
      const processLine = (
        buf: string,
        chunk: Buffer,
        cb?: (line: string) => void,
      ): string => {
        const decoded = decode(chunk, encoding);
        const combined = buf + decoded;
        const lines = combined.split(/\r?\n/);
        // 最后一段可能不完整,保留
        const remaining = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) {
            cb?.(line);
            this.bus.emit('line', { taskId, line, stream: 'stdout' as const });
          }
        }
        return remaining;
      };

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (captureStdout) stdoutChunks.push(chunk);
        stdoutBuf = processLine(stdoutBuf, chunk, opts.onStdout);
        stdoutStr += decode(chunk, encoding);
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        if (captureStdout) stderrChunks.push(chunk);
        stderrBuf = processLine(stderrBuf, chunk, opts.onStderr);
        stderrStr += decode(chunk, encoding);
      });

      // 超时处理
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          killed = true;
          if (!silent) logger.warn(`超时(${timeout}ms),kill 进程: ${cmd} ${args.join(' ')}`);
          proc.kill('SIGTERM');
          // 5 秒后强制 kill
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
          }, 5000);
        }, timeout);
      }

      proc.on('error', (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (taskId) this.tasks.delete(taskId);
        // 静默模式下完全不发日志(设备检测用)
        // ENOENT 也静默(避免日志噪音)
        if (!silent && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.error(`启动失败: ${cmd} ${args.join(' ')} - ${err.message}`);
        }
        reject(new SpawnError(`启动失败: ${err.message}`, -1, '', '', 0, false, killed));
      });

      proc.on('close', (code, signal) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (taskId) this.tasks.delete(taskId);

        // 处理最后未换行结尾的输出
        if (stdoutBuf.trim()) {
          opts.onStdout?.(stdoutBuf);
          this.bus.emit('line', { taskId, line: stdoutBuf, stream: 'stdout' as const });
        }
        if (stderrBuf.trim()) {
          opts.onStderr?.(stderrBuf);
          this.bus.emit('line', { taskId, line: stderrBuf, stream: 'stderr' as const });
        }

        const duration = Date.now() - start;
        const result: SpawnResult = {
          exitCode: code,
          stdout: captureStdout ? Buffer.concat(stdoutChunks).toString('utf-8') || stdoutStr : stdoutStr,
          stderr: captureStdout ? Buffer.concat(stderrChunks).toString('utf-8') || stderrStr : stderrStr,
          duration,
          signal: signal ?? undefined,
          killed,
        };

        if (code === 0 && !killed) {
          if (!silent) logger.debug(`完成(${duration}ms): ${cmd} ${args.join(' ')}`);
          resolve(result);
        } else if (killed) {
          reject(new SpawnError(`进程被 kill: ${cmd}`, code ?? -1, result.stdout, result.stderr, duration, false, true));
        } else {
          reject(
            new SpawnError(
              `退出码 ${code}: ${cmd} ${args.join(' ')}`,
              code ?? -1,
              result.stdout,
              result.stderr,
              duration,
              false,
              false,
            ),
          );
        }
      });
    });
  }

  /**
   * 流式执行,返回行迭代器(用于实时日志场景)
   */
  async *spawnStreaming(opts: SpawnOptions): AsyncGenerator<string> {
    const queue: string[] = [];
    let done = false;
    let error: Error | null = null;
    let waiter: ((v: boolean) => void) | null = null;

    const onLine = (line: string): void => {
      queue.push(line);
      waiter?.(true);
      waiter = null;
    };

    this.spawn({ ...opts, onStdout: onLine, onStderr: onLine, captureStdout: false })
      .then(() => {
        done = true;
        waiter?.(true);
        waiter = null;
      })
      .catch((e) => {
        error = e as Error;
        done = true;
        waiter?.(true);
        waiter = null;
      });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<boolean>((resolve) => {
        waiter = resolve;
      });
    }
  }

  /** kill 指定任务 */
  kill(taskId: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    logger.warn(`kill 任务 ${taskId}: ${task.cmd} ${task.args.join(' ')}`);
    return task.process.kill(signal);
  }

  /** 列出所有运行中任务 */
  list(): TaskInfo[] {
    return Array.from(this.tasks.values());
  }

  /** 监听所有子进程的行输出(用于日志面板) */
  onLine(cb: (info: { taskId?: string; line: string; stream: 'stdout' | 'stderr' }) => void): () => void {
    this.bus.on('line', cb);
    return () => this.bus.off('line', cb);
  }
}

export class SpawnError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stdout: string,
    public stderr: string,
    public duration: number,
    public cancelled: boolean,
    public killed: boolean,
  ) {
    super(message);
    this.name = 'SpawnError';
  }
}

export const SubprocessPool = new SubprocessPoolClass();
