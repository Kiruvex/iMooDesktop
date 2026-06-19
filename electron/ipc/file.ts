// electron/ipc/file.ts - file:* 通道(ADB 文件管理)
//
// 通道列表:
//   file:list          列目录
//   file:stat          单文件信息
//   file:exists        路径是否存在
//   file:mkdir         创建目录
//   file:remove        删除
//   file:rename        重命名/移动
//   file:copy          复制
//   file:push          推送本地文件到设备
//   file:pull          拉取设备文件到本地
//   file:install-apk   安装设备上的 APK
//   file:disk-info     磁盘信息
//   file:read-text     读文本文件
//   file:quick-paths   快捷路径列表

import { ipcMain, dialog } from 'electron';
import { FileService, type FileEntry } from '../services/FileService';
import { AdbService } from '../services/AdbService';
import { DeviceService } from '../services/DeviceService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

function requireAdb(): boolean {
  const device = DeviceService.instance.current();
  return device?.type === 'adb';
}

export function registerFileIpc(): void {
  // 列目录(支持指定设备)
  ipcMain.handle(
    'file:list',
    async (_evt, { path, deviceSerial }: { path: string; deviceSerial?: string }) => {
      if (!requireAdb()) {
        return { success: false, error: '需要 ADB 设备', entries: [] as FileEntry[] };
      }
      try {
        const entries = await FileService.list(path, deviceSerial);
        return { success: true, entries };
      } catch (e) {
        logger.error('file', `列目录失败 ${path}: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message, entries: [] };
      }
    },
  );

  // stat
  ipcMain.handle('file:stat', async (_evt, { path }: { path: string }) => {
    if (!requireAdb()) {
      return { success: false, error: '需要 ADB 设备', entry: null };
    }
    try {
      const entry = await FileService.stat(path);
      return { success: true, entry };
    } catch (e) {
      return { success: false, error: (e as Error).message, entry: null };
    }
  });

  // exists
  ipcMain.handle('file:exists', async (_evt, { path }: { path: string }) => {
    if (!requireAdb()) return { success: false, exists: false };
    try {
      const exists = await FileService.exists(path);
      return { success: true, exists };
    } catch {
      return { success: false, exists: false };
    }
  });

  // mkdir
  ipcMain.handle(
    'file:mkdir',
    async (_evt, { path, recursive = true }: { path: string; recursive?: boolean }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.mkdir(path, recursive);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // remove
  ipcMain.handle(
    'file:remove',
    async (_evt, { path, recursive = true }: { path: string; recursive?: boolean }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.remove(path, recursive);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // rename
  ipcMain.handle(
    'file:rename',
    async (_evt, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.rename(oldPath, newPath);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // copy
  ipcMain.handle(
    'file:copy',
    async (
      _evt,
      { srcPath, dstPath, recursive = true }: { srcPath: string; dstPath: string; recursive?: boolean },
    ) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.copy(srcPath, dstPath, recursive);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // push:本地文件推送到设备(带进度事件)
  ipcMain.handle(
    'file:push',
    async (
      evt,
      { local, remote, deviceSerial }: { local: string; remote: string; deviceSerial?: string },
    ) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.push(local, remote, deviceSerial, (p) => {
          evt.sender.send('file:transfer-progress', p);
        });
        return { success: true };
      } catch (e) {
        logger.error('file', `push 失败 ${local} -> ${remote}: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // pull:设备文件拉取到本地(带进度事件)
  ipcMain.handle(
    'file:pull',
    async (
      evt,
      { remote, local, deviceSerial }: { remote: string; local: string; deviceSerial?: string },
    ) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.pull(remote, local, deviceSerial, (p) => {
          evt.sender.send('file:transfer-progress', p);
        });
        return { success: true };
      } catch (e) {
        logger.error('file', `pull 失败 ${remote} -> ${local}: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // push-folder:批量推送文件夹内所有文件(递归)
  ipcMain.handle(
    'file:push-folder',
    async (_evt, { localDir, remoteDir }: { localDir: string; remoteDir: string }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        // adb push <localDir> <remoteDir>/ 会递归
        await AdbService.push(localDir, remoteDir);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // install-apk:安装设备上的 APK
  ipcMain.handle(
    'file:install-apk',
    async (_evt, { remoteApk }: { remoteApk: string }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      return FileService.installRemoteApk(remoteApk);
    },
  );

  // install-local-apk:安装本地 APK 文件(用文件选择器选)
  ipcMain.handle('file:install-local-apk', async () => {
    if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
    const result = await dialog.showOpenDialog({
      title: '选择 APK 文件',
      filters: [{ name: 'Android 应用包', extensions: ['apk'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: '未选择文件' };
    }
    const local = result.filePaths[0];
    try {
      const r = await AdbService.install(local, 'install');
      return { success: r.success, pkg: r.pkg };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  // disk-info
  ipcMain.handle('file:disk-info', async (_evt, { path = '/sdcard' }: { path?: string }) => {
    if (!requireAdb()) return { success: false, error: '需要 ADB 设备', info: null };
    try {
      const info = await FileService.diskInfo(path);
      return { success: true, info };
    } catch (e) {
      return { success: false, error: (e as Error).message, info: null };
    }
  });

  // read-text
  ipcMain.handle('file:read-text', async (_evt, { path }: { path: string }) => {
    if (!requireAdb()) return { success: false, error: '需要 ADB 设备', content: '' };
    try {
      const content = await FileService.readTextFile(path);
      return { success: true, content };
    } catch (e) {
      return { success: false, error: (e as Error).message, content: '' };
    }
  });

  // quick-paths
  ipcMain.handle('file:quick-paths', async () => {
    return { success: true, paths: FileService.QUICK_PATHS };
  });

  // ========== M6 新增:多设备/搜索/排序/批量/编辑/chmod/书签/兼容模式 ==========

  // 列出所有 ADB 设备(对应 wkbin/JSleim 的 Multi-device support)
  ipcMain.handle('file:list-devices', async () => {
    try {
      const devices = await FileService.listDevices();
      return { success: true, devices };
    } catch (e) {
      return { success: false, devices: [], error: (e as Error).message };
    }
  });

  // 创建文件(对应 wkbin 的 Create file)
  ipcMain.handle(
    'file:create-file',
    async (_evt, { path, content = '' }: { path: string; content?: string }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.createFile(path, content);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 写入文本文件(对应 wkbin 的 Edit)
  ipcMain.handle(
    'file:write-file',
    async (_evt, { path, content }: { path: string; content: string }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.writeFile(path, content);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 修改权限 chmod(对应 wkbin 计划中的 File permission modification)
  ipcMain.handle(
    'file:chmod',
    async (
      _evt,
      { path, mode, recursive = false }: { path: string; mode: string; recursive?: boolean },
    ) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备' };
      try {
        await FileService.chmod(path, mode, recursive);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 批量删除(对应 T0biasCZe/JSleim 的多选批量操作)
  ipcMain.handle(
    'file:batch-remove',
    async (_evt, { paths, recursive = true }: { paths: string[]; recursive?: boolean }) => {
      if (!requireAdb()) return { success: false, error: '需要 ADB 设备', deleted: [], failed: [] };
      try {
        const result = await FileService.batchRemove(paths, recursive);
        return { success: true, deleted: result.success, failed: result.failed };
      } catch (e) {
        return { success: false, error: (e as Error).message, deleted: [], failed: [] };
      }
    },
  );

  // 搜索当前目录(对应 wkbin 的 File search)
  ipcMain.handle(
    'file:search',
    async (_evt, { dir, query, deviceSerial }: { dir: string; query: string; deviceSerial?: string }) => {
      if (!requireAdb()) return { success: false, entries: [], error: '需要 ADB 设备' };
      try {
        const entries = await FileService.searchInDir(dir, query, deviceSerial);
        return { success: true, entries };
      } catch (e) {
        return { success: false, entries: [], error: (e as Error).message };
      }
    },
  );

  // 设置兼容模式(对应 T0biasCZe 的 compatibility fix)
  ipcMain.handle(
    'file:set-compat-mode',
    async (_evt, { enabled }: { enabled: boolean }) => {
      FileService.compatMode = enabled;
      return { success: true, compatMode: FileService.compatMode };
    },
  );

  // 设置保留 mtime(对应 T0biasCZe 的 Keep file modified date)
  ipcMain.handle(
    'file:set-keep-mtime',
    async (_evt, { enabled }: { enabled: boolean }) => {
      FileService.keepMtime = enabled;
      return { success: true, keepMtime: FileService.keepMtime };
    },
  );

  logger.info('file', 'file:* IPC 通道已注册');
}
