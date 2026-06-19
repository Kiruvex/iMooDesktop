// electron/services/TerminalService.ts - 打开带 adb 环境的终端
// 对应原 main.bat:2 "在此处打开cmd[含adb环境]"
// 跨平台:Windows 用 cmd,Linux 用 x-terminal-emulator/xterm

import { spawn } from 'node:child_process';
import { Logger } from './Logger';
import { paths } from '../core/paths';

const logger = Logger.instance.child('TerminalService');

class TerminalServiceClass {
  /** 打开终端,cwd 设为 resources/bin(含 adb.exe) */
  openTerminal(): void {
    const cwd = paths.bin;
    const isWindows = process.platform === 'win32';

    try {
      if (isWindows) {
        // Windows:打开 cmd,cwd 设为 bin
        spawn('cmd', ['/k', `title iMooDesktop - ADB Shell`], {
          cwd,
          detached: true,
          shell: true,
          stdio: 'ignore',
        });
      } else {
        // Linux:尝试常见终端模拟器
        const terminals = [
          'x-terminal-emulator',
          'gnome-terminal',
          'konsole',
          'xfce4-terminal',
          'xterm',
        ];
        for (const term of terminals) {
          try {
            spawn(term, ['--working-directory', cwd], {
              cwd,
              detached: true,
              shell: true,
              stdio: 'ignore',
            });
            logger.info(`已打开终端: ${term}`);
            return;
          } catch {
            // 尝试下一个
          }
        }
        throw new Error('未找到可用的终端模拟器');
      }
      logger.info(`已打开终端(cwd=${cwd})`);
    } catch (e) {
      logger.error(`打开终端失败: ${(e as Error).message}`);
      throw e;
    }
  }
}

export const TerminalService = new TerminalServiceClass();
