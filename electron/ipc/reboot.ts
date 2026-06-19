// electron/ipc/reboot.ts - reboot:* 通道

import { ipcMain } from 'electron';
import { RebootService, type RebootMode } from '../services/RebootService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerRebootIpc(): void {
  ipcMain.handle(
    'reboot:execute',
    async (_evt, opts: { mode: RebootMode; innermodel?: string; platform?: 'otherpash' | 'v3pash' | 'z10' }) => {
      try {
        await RebootService.reboot(opts);
        return { success: true };
      } catch (e) {
        logger.error('reboot', `重启失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  logger.info('ipc', 'reboot:* 通道已注册');
}
