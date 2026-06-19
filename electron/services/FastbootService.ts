// electron/services/FastbootService.ts - fastboot 命令封装
// 见 plan.md 6.4 FastbootService

import { SubprocessPool } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';

const logger = Logger.instance.child('FastbootService');

class FastbootServiceClass {
  private fastbootPath = paths.binFile('fastboot.exe');

  async devices(): Promise<string[]> {
    const result = await SubprocessPool.spawn({
      cmd: this.fastbootPath,
      args: ['devices'],
      encoding: 'utf-8',
      timeout: 5000,
      cwd: paths.bin,
    });
    return result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.includes('fastboot'));
  }

  // 原 ROOT-SDK27.bat:fastboot flash boot new-boot.img
  async flash(partition: string, img: string): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.fastbootPath,
      args: ['flash', partition, img],
      encoding: 'gbk',
      timeout: 120000,
      cwd: paths.bin,
      onStdout: (line) => logger.info(`flash ${partition}: ${line}`),
    });
  }

  // 原 ROOT-SDK27.bat:fastboot erase misc
  async erase(partition: string): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.fastbootPath,
      args: ['erase', partition],
      encoding: 'gbk',
      timeout: 30000,
      cwd: paths.bin,
    });
  }

  // 原 rebootpro.bat 临时启动 TWRP:fastboot boot twrp-<innermodel>.img
  async boot(img: string): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.fastbootPath,
      args: ['boot', img],
      encoding: 'gbk',
      timeout: 30000,
      cwd: paths.bin,
    });
  }

  async reboot(target: 'system' | 'bootloader' | 'recovery'): Promise<void> {
    const arg = target === 'system' ? 'reboot' : `reboot ${target}`;
    await SubprocessPool.spawn({
      cmd: this.fastbootPath,
      args: arg.split(' '),
      encoding: 'utf-8',
      timeout: 10000,
      cwd: paths.bin,
    });
  }

  async getVar(name: string): Promise<string> {
    const result = await SubprocessPool.spawn({
      cmd: this.fastbootPath,
      args: ['getvar', name],
      encoding: 'utf-8',
      timeout: 10000,
      cwd: paths.bin,
    });
    return result.stdout.trim();
  }

  async oem(cmd: string): Promise<void> {
    await SubprocessPool.spawn({
      cmd: this.fastbootPath,
      args: ['oem', cmd],
      encoding: 'gbk',
      timeout: 30000,
      cwd: paths.bin,
    });
  }
}

export const FastbootService = new FastbootServiceClass();
