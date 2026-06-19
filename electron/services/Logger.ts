// electron/services/Logger.ts - 统一日志出口
// 见 plan.md 6.2 Logger
// 1. electron-log 写文件 %APPDATA%/iMooDesktop/logs/<date>.log(按天滚动,保留7天)
// 2. logBus.emit('log', entry)
// 3. BrowserWindow.getAllWindows().forEach(w => w.webContents.send('log:line', entry))

import log from 'electron-log';
import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { LogEntry, LogLevel } from '../../shared/types';
import { paths } from '../core/paths';

// electron-log 配置
log.transports.file.level = 'debug';
log.transports.console.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB

// 日志目录
const logsDir = paths.logs;
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // ignore
  }
}
log.transports.file.resolvePathFn = () => path.join(logsDir, `${new Date().toISOString().slice(0, 10)}.log`);

// 清理 7 天前的日志
function cleanOldLogs(): void {
  try {
    const files = fs.readdirSync(logsDir);
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (!f.endsWith('.log')) continue;
      const full = path.join(logsDir, f);
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > sevenDays) {
        fs.unlinkSync(full);
      }
    }
  } catch {
    // ignore
  }
}

class LoggerClass {
  private static _instance: LoggerClass;
  private bus = new EventEmitter();
  private subscriberCount = 0;

  static get instance(): LoggerClass {
    if (!this._instance) {
      this._instance = new LoggerClass();
    }
    return this._instance;
  }

  private constructor() {
    this.bus.setMaxListeners(50);
    cleanOldLogs();
  }

  log(entry: LogEntry): void {
    // 1. 写文件
    const prefix = `[${new Date(entry.ts).toISOString()}] [${entry.level.toUpperCase()}] [${entry.source}]`;
    const msg = entry.raw ? `${entry.message}\n  raw: ${entry.raw}` : entry.message;
    const line = `${prefix} ${msg}`;

    switch (entry.level) {
      case 'debug':
        log.debug(line);
        break;
      case 'info':
        log.info(line);
        break;
      case 'warn':
        log.warn(line);
        break;
      case 'error':
        log.error(line);
        break;
    }

    // 2. emit 到 bus(内部监听)
    this.bus.emit('log', entry);

    // 3. 推送到所有渲染进程(只有订阅过的才推送)
    if (this.subscriberCount > 0) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          w.webContents.send('log:line', entry);
        }
      }
    }
  }

  debug(source: string, message: string, raw?: string): void {
    this.log({ ts: Date.now(), level: 'debug', source, message, raw });
  }

  info(source: string, message: string, raw?: string): void {
    this.log({ ts: Date.now(), level: 'info', source, message, raw });
  }

  warn(source: string, message: string, raw?: string): void {
    this.log({ ts: Date.now(), level: 'warn', source, message, raw });
  }

  error(source: string, message: string, raw?: string): void {
    this.log({ ts: Date.now(), level: 'error', source, message, raw });
  }

  /** 创建子 logger,自动填 source */
  child(source: string): ChildLogger {
    return new ChildLogger(this, source);
  }

  /** 内部监听(如 DeviceService 等待日志) */
  onLog(cb: (entry: LogEntry) => void): () => void {
    this.bus.on('log', cb);
    return () => this.bus.off('log', cb);
  }

  addSubscriber(): void {
    this.subscriberCount++;
  }

  removeSubscriber(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
  }
}

class ChildLogger {
  constructor(private parent: LoggerClass, private source: string) {}

  debug(message: string, raw?: string): void {
    this.parent.debug(this.source, message, raw);
  }
  info(message: string, raw?: string): void {
    this.parent.info(this.source, message, raw);
  }
  warn(message: string, raw?: string): void {
    this.parent.warn(this.source, message, raw);
  }
  error(message: string, raw?: string): void {
    this.parent.error(this.source, message, raw);
  }
  log(level: LogLevel, message: string, raw?: string): void {
    this.parent.log({ ts: Date.now(), level, source: this.source, message, raw });
  }
}

export const Logger = LoggerClass;
export type LoggerType = LoggerClass;
export { ChildLogger };
