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
//
// 重构:用 wrap 高阶函数消除重复 requireAdb + try-catch

import { ipcMain, dialog } from 'electron';
import { FileService, type FileEntry } from '../services/FileService';
import { AdbService } from '../services/AdbService';
import { ApkParser } from '../services/ApkParser';
import { Logger } from '../services/Logger';
import { wrap, wrapNoArgs } from '../lib/ipcHelper';
import type { DiskInfo } from '../services/FileService';

const logger = Logger.instance;

export function registerFileIpc(): void {
  // 列目录(支持指定设备)
  ipcMain.handle(
    'file:list',
    wrap(({ path, deviceSerial }: { path: string; deviceSerial?: string }) =>
      FileService.list(path, deviceSerial).then((entries) => ({ success: true, entries })),
    { requireDevice: 'adb', errorExtra: { entries: [] as FileEntry[] }, logPrefix: 'file' }),
  );

  // stat
  ipcMain.handle(
    'file:stat',
    wrap(({ path }: { path: string }) =>
      FileService.stat(path).then((entry) => ({ success: true, entry })),
    { requireDevice: 'adb', errorExtra: { entry: null }, logPrefix: 'file' }),
  );

  // exists
  ipcMain.handle(
    'file:exists',
    wrap(({ path }: { path: string }) =>
      FileService.exists(path).then((exists) => ({ success: true, exists })),
    { requireDevice: 'adb', errorExtra: { exists: false }, logPrefix: 'file' }),
  );

  // mkdir
  ipcMain.handle(
    'file:mkdir',
    wrap(({ path, recursive = true }: { path: string; recursive?: boolean }) =>
      FileService.mkdir(path, recursive).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // remove
  ipcMain.handle(
    'file:remove',
    wrap(({ path, recursive = true }: { path: string; recursive?: boolean }) =>
      FileService.remove(path, recursive).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // rename
  ipcMain.handle(
    'file:rename',
    wrap(({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
      FileService.rename(oldPath, newPath).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // copy
  ipcMain.handle(
    'file:copy',
    wrap(({ srcPath, dstPath, recursive = true }: { srcPath: string; dstPath: string; recursive?: boolean }) =>
      FileService.copy(srcPath, dstPath, recursive).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // push:本地文件推送到设备(带进度事件)
  ipcMain.handle(
    'file:push',
    wrap(
      ({ local, remote, deviceSerial }: { local: string; remote: string; deviceSerial?: string }, evt) =>
        FileService.push(local, remote, deviceSerial, (p) => {
          evt.sender.send('file:transfer-progress', p);
        }).then(() => ({ success: true })),
      { requireDevice: 'adb', logPrefix: 'file' },
    ),
  );

  // pull:设备文件拉取到本地(带进度事件)
  ipcMain.handle(
    'file:pull',
    wrap(
      ({ remote, local, deviceSerial }: { remote: string; local: string; deviceSerial?: string }, evt) =>
        FileService.pull(remote, local, deviceSerial, (p) => {
          evt.sender.send('file:transfer-progress', p);
        }).then(() => ({ success: true })),
      { requireDevice: 'adb', logPrefix: 'file' },
    ),
  );

  // push-folder:批量推送文件夹内所有文件(递归)
  ipcMain.handle(
    'file:push-folder',
    wrap(({ localDir, remoteDir }: { localDir: string; remoteDir: string }) =>
      AdbService.push(localDir, remoteDir).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // install-apk:安装设备上的 APK
  ipcMain.handle(
    'file:install-apk',
    wrap(({ remoteApk }: { remoteApk: string }) => FileService.installRemoteApk(remoteApk), {
      requireDevice: 'adb',
      logPrefix: 'file',
    }),
  );

  // install-local-apk:安装本地 APK 文件(用文件选择器选)
  ipcMain.handle(
    'file:install-local-apk',
    wrapNoArgs(async () => {
      const result = await dialog.showOpenDialog({
        title: '选择 APK 文件',
        filters: [{ name: 'Android 应用包', extensions: ['apk'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '未选择文件' };
      }
      const local = result.filePaths[0];
      const r = await AdbService.install(local, 'install');
      return { success: r.success, pkg: r.pkg };
    }, { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // disk-info
  ipcMain.handle(
    'file:disk-info',
    wrap(({ path = '/sdcard' }: { path?: string }) =>
      FileService.diskInfo(path).then((info) => ({ success: true, info: info as DiskInfo | null })),
    { requireDevice: 'adb', errorExtra: { info: null }, logPrefix: 'file' }),
  );

  // read-text
  ipcMain.handle(
    'file:read-text',
    wrap(({ path }: { path: string }) =>
      FileService.readTextFile(path).then((content) => ({ success: true, content })),
    { requireDevice: 'adb', errorExtra: { content: '' }, logPrefix: 'file' }),
  );

  // quick-paths(不需要设备)
  ipcMain.handle('file:quick-paths', async () => {
    return { success: true, paths: FileService.QUICK_PATHS };
  });

  // ========== 文件管理增强:多设备/搜索/排序/批量/编辑/chmod/书签/兼容模式 ==========

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
    wrap(({ path, content = '' }: { path: string; content?: string }) =>
      FileService.createFile(path, content).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // 写入文本文件(对应 wkbin 的 Edit)
  ipcMain.handle(
    'file:write-file',
    wrap(({ path, content }: { path: string; content: string }) =>
      FileService.writeFile(path, content).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // 修改权限 chmod(对应 wkbin 计划中的 File permission modification)
  ipcMain.handle(
    'file:chmod',
    wrap(({ path, mode, recursive = false }: { path: string; mode: string; recursive?: boolean }) =>
      FileService.chmod(path, mode, recursive).then(() => ({ success: true })),
    { requireDevice: 'adb', logPrefix: 'file' }),
  );

  // 批量删除(对应 T0biasCZe/JSleim 的多选批量操作)
  ipcMain.handle(
    'file:batch-remove',
    wrap(({ paths, recursive = true }: { paths: string[]; recursive?: boolean }) =>
      FileService.batchRemove(paths, recursive).then((result) => ({
        success: true,
        deleted: result.success,
        failed: result.failed,
      })),
    { requireDevice: 'adb', errorExtra: { deleted: [], failed: [] }, logPrefix: 'file' }),
  );

  // 搜索当前目录(对应 wkbin 的 File search)
  ipcMain.handle(
    'file:search',
    wrap(({ dir, query, deviceSerial }: { dir: string; query: string; deviceSerial?: string }) =>
      FileService.searchInDir(dir, query, deviceSerial).then((entries) => ({ success: true, entries })),
    { requireDevice: 'adb', errorExtra: { entries: [] }, logPrefix: 'file' }),
  );

  // 设置兼容模式(对应 T0biasCZe 的 compatibility fix)
  ipcMain.handle(
    'file:set-compat-mode',
    wrap(({ enabled }: { enabled: boolean }) => {
      FileService.compatMode = enabled;
      return { success: true, compatMode: FileService.compatMode };
    }, { logPrefix: 'file' }),
  );

  // 设置保留 mtime(对应 T0biasCZe 的 Keep file modified date)
  ipcMain.handle(
    'file:set-keep-mtime',
    wrap(({ enabled }: { enabled: boolean }) => {
      FileService.keepMtime = enabled;
      return { success: true, keepMtime: FileService.keepMtime };
    }, { logPrefix: 'file' }),
  );

  // APK 解析(纯 Node.js,不需要设备连接)
  ipcMain.handle(
    'file:parse-apk',
    wrap(({ apkPath }: { apkPath: string }) =>
      ApkParser.parse(apkPath),
    { logPrefix: 'file' }),
  );

  logger.info('ipc', 'file:* 通道已注册');
}
