// electron/ipc/system.ts - system:* 通道
// 见 plan.md 8.1 通道命名规范

import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { config } from '../core/config';
import { paths } from '../core/paths';
import {
  setWindowOpacity,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
} from '../core/windows';
import { ResourceService } from '../services/ResourceService';
import { TerminalService } from '../services/TerminalService';
import { Logger } from '../services/Logger';
import { APP_META, AppSettings, VerifyResult } from '../../shared/types';

const logger = Logger.instance;

export function registerSystemIpc(): void {
  // 获取设置
  ipcMain.handle('system:get-settings', (): AppSettings => config.getAll());

  // 更新设置
  ipcMain.handle(
    'system:set-settings',
    (_evt, { settings }: { settings: Partial<AppSettings> }): AppSettings => {
      const updated = config.setAll(settings);
      // 窗口透明度立即生效
      if (settings.windowOpacity !== undefined) {
        setWindowOpacity(settings.windowOpacity);
      }
      return updated;
    },
  );

  // 单独的窗口透明度设置(M1 验收要求)
  ipcMain.handle('system:set-window-opacity', (_evt, { opacity }: { opacity: number }) => {
    setWindowOpacity(opacity);
  });

  // 文件选择(替代 filedialog.exe,见 plan.md 10.3)
  ipcMain.handle(
    'system:pick-file',
    async (
      _evt,
      opts: { kind: 'open' | 'folder'; filter?: string; multi?: boolean },
    ): Promise<string | string[] | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? undefined;
      if (opts.kind === 'folder') {
        const result = await dialog.showOpenDialog(win!, {
          properties: [opts.multi ? 'multiSelections' : 'openDirectory'].filter(Boolean),
        });
        if (result.canceled) return null;
        return opts.multi ? result.filePaths : result.filePaths[0];
      }
      // open file
      const filters = parseFilter(opts.filter);
      const result = await dialog.showOpenDialog(win!, {
        properties: [
          'openFile',
          ...(opts.multi ? ['multiSelections'] : []),
        ],
        filters,
      });
      if (result.canceled) return null;
      return opts.multi ? result.filePaths : result.filePaths[0];
    },
  );

  // 打开外部链接
  ipcMain.handle('system:open-external', (_evt, { path }: { path: string }) => {
    shell.openExternal(path);
  });

  // 在文件管理器中显示
  ipcMain.handle('system:show-in-folder', (_evt, { path }: { path: string }) => {
    shell.showItemInFolder(path);
  });

  // 资源完整性校验(见 plan.md 6.14 ResourceService)
  ipcMain.handle('system:verify-resources', async (): Promise<VerifyResult[]> => {
    return ResourceService.instance.verify();
  });

  // 应用版本
  ipcMain.handle('system:get-version', () => ({
    version: APP_META.version,
    buildDate: APP_META.buildDate,
  }));

  // ========== 窗口控制(自定义标题栏用) ==========
  ipcMain.handle('system:window-minimize', () => minimizeWindow());
  ipcMain.handle('system:window-toggle-maximize', () => toggleMaximizeWindow());
  ipcMain.handle('system:window-close', () => closeWindow());
  ipcMain.handle('system:window-is-maximized', () => isWindowMaximized());

  // 打开终端(带 adb 环境)
  ipcMain.handle('system:open-terminal', () => {
    try {
      TerminalService.openTerminal();
      return { success: true };
    } catch (e) {
      logger.error(`打开终端失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  });

  logger.info('ipc', 'system:* 通道已注册');
}

/** 解析过滤器字符串,如 "APK 文件|*.apk;所有文件|*.*" */
function parseFilter(filter?: string): Electron.FileFilter[] {
  if (!filter) {
    return [{ name: '所有文件', extensions: ['*'] }];
  }
  // 格式:name1|ext1;ext2;name2|ext3
  const parts = filter.split('|');
  const filters: Electron.FileFilter[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const name = parts[i];
    const exts = parts[i + 1]
      .split(';')
      .map((e) => e.replace(/^\*\./, '').trim())
      .filter(Boolean);
    filters.push({ name, extensions: exts.length ? exts : ['*'] });
  }
  return filters.length ? filters : [{ name: '所有文件', extensions: ['*'] }];
}
