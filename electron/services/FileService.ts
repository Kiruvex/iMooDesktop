// electron/services/FileService.ts - ADB 文件管理服务
//
// 参考:
//   - QtAdb(双栏布局 + push/pull 进度)
//   - wkbin/AdbFileManager(搜索/排序/书签/网格视图/文本编辑/多选)
//   - T0biasCZe/AdbFileManager(双栏/保留 mtime/旧 Android 兼容模式)
//   - JSleim/adb-file-explorer(多设备/剪贴板)
//   - adb_file_explorer 的 IPC 拆分
//
// 实现要点:
//   - list 使用 `adb shell ls -lA <path>`,解析 toybox/busybox 长格式输出
//   - 兼容 Android 7+ 的 toybox ls 与旧版 busybox 两种日期格式
//   - 旧 Android 兼容模式:回退到 `ls -l`(无 -A,显示 . 开头)
//   - 路径用单引号转义,防止空格/特殊字符注入
//   - push/pull 直接 spawn adb,解析 stdout 的 [XX%] 进度
//   - install-apk 复用 AdbService.install('install')
//   - 多设备:adb -s <serial> 前缀

import { AdbService } from './AdbService';
import { SubprocessPool } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import { EventEmitter } from 'node:events';

const logger = Logger.instance.child('FileService');

/** 文件条目 */
export interface FileEntry {
  name: string;
  /** 完整路径 */
  path: string;
  /** 是否目录 */
  isDir: boolean;
  /** 是否软链接 */
  isLink: boolean;
  /** 软链接目标(仅 isLink=true 时有值) */
  linkTarget?: string;
  /** 字节数(目录为 0) */
  size: number;
  /** 权限字符串,如 rwxr-xr-x */
  perms: string;
  /** 类型字符:d/-/l/b/c/s/p */
  type: string;
  /** 所有者 */
  owner: string;
  /** 所属组 */
  group: string;
  /** 修改时间字符串 */
  mtime: string;
  /** 扩展名(小写,无点) */
  ext: string;
}

/** 磁盘信息 */
export interface DiskInfo {
  path: string;
  total: number;
  used: number;
  available: number;
  /** 使用率 0-100 */
  usagePercent: number;
}

/** 传输进度事件 */
export interface TransferProgress {
  /** 关联的本地路径 */
  local: string;
  /** 关联的远端路径 */
  remote: string;
  /** 方向 */
  direction: 'push' | 'pull';
  /** 已传输字节 */
  transferred: number;
  /** 总字节(无法获取时为 0) */
  total: number;
  /** 百分比 0-100(total=0 时为 0) */
  percent: number;
}

class FileServiceClass extends EventEmitter {
  /** 旧 Android 兼容模式(对应 T0biasCZe/AdbFileManager 的 compatibility fix) */
  compatMode = false;

  /** 推送/拉取时是否保留源文件修改时间(对应 T0biasCZe 的 Keep file modified date) */
  keepMtime = false;

  /** 常用快捷路径(参考 HandShaker/QtAdb 侧栏) */
  QUICK_PATHS: { label: string; path: string; icon: string }[] = [
    { label: '内部存储', path: '/sdcard', icon: 'home' },
    { label: 'DCIM 相册', path: '/sdcard/DCIM', icon: 'image' },
    { label: '下载', path: '/sdcard/Download', icon: 'download' },
    { label: '图片', path: '/sdcard/Pictures', icon: 'image' },
    { label: '音乐', path: '/sdcard/Music', icon: 'music' },
    { label: '电影', path: '/sdcard/Movies', icon: 'film' },
    { label: '文档', path: '/sdcard/Documents', icon: 'file' },
    { label: '存储根', path: '/storage', icon: 'drive' },
    { label: '根目录', path: '/', icon: 'terminal' },
    { label: 'data 分区', path: '/data', icon: 'database' },
  ];

  /**
   * 列出目录内容
   * 使用 `adb shell ls -lA <path>`,解析长格式
   * 兼容模式:旧 Android 不支持 -A,回退到 `ls -l`
   */
  async list(remotePath: string, deviceSerial?: string): Promise<FileEntry[]> {
    const safePath = this.quote(remotePath);
    // -l 长格式,-A 显示除 . 和 .. 外的所有文件(含隐藏)
    // 兼容模式下不用 -A(旧 Android toybox 不支持)
    const flag = this.compatMode ? '-l' : '-lA';
    const out = await this.shellDevice(`ls ${flag} ${safePath}`, { timeout: 15000 }, deviceSerial);
    let entries = this.parseLsOutput(out, remotePath);
    // 兼容模式下手动过滤 . 和 ..
    if (this.compatMode) {
      entries = entries.filter((e) => e.name !== '.' && e.name !== '..');
    }
    return entries;
  }

  /**
   * 解析 ls -lA 输出
   * toybox 格式:
   *   drwxrwxr-x 2 root root 4096 2024-01-15 10:30 dirname
   *   -rw-rw-r-- 1 root root 1024 2024-01-15 10:30 file.txt
   * 旧 busybox 可能:
   *   drwxrwxr-x root root 4096 Jan 15 10:30 dirname
   * 软链接:
   *   lrwxrwxrwx 1 root root 7 2024-01-15 10:30 link -> /target
   */
  parseLsOutput(output: string, baseDir: string): FileEntry[] {
    const entries: FileEntry[] = [];
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // 跳过 "total N" 行
      if (/^total\s+\d+/i.test(line)) continue;
      // 跳过 "Permission denied" / "No such file" 等错误行
      if (/permission denied|no such file|not a directory|opendir/i.test(line)) continue;

      // 两种日期格式:yyyy-mm-dd HH:MM 或 Mon DD HH:MM
      // 匹配 toybox 格式(8 字段:perms nlink owner group size date time name)
      let m = line.match(
        /^([dlbcsp-])([rwxst-]{9})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.*)$/,
      );
      let typeChar: string;
      let perms: string;
      let owner: string;
      let group: string;
      let size: number;
      let mtime: string;
      let nameRaw: string;

      if (m) {
        [, typeChar, perms, , owner, group, , mtime, , nameRaw] = m;
        mtime = `${mtime} ${m[8]}`;
        size = parseInt(m[6], 10) || 0;
      } else {
        // 尝试旧 busybox 格式(无 nlink):perms owner group size Mon DD HH:MM name
        m = line.match(
          /^([dlbcsp-])([rwxst-]{9})\s+(\S+)\s+(\S+)\s+(\d+)\s+(\w{3}\s+\d{1,2}\s+[\d:]{4,5})\s+(.*)$/,
        );
        if (m) {
          [, typeChar, perms, owner, group, , mtime, nameRaw] = m;
          size = parseInt(m[5], 10) || 0;
        } else {
          // 无法解析,跳过
          logger.warn(`无法解析 ls 行: ${line}`);
          continue;
        }
      }

      const isLink = typeChar === 'l';
      let linkTarget: string | undefined;
      let name = nameRaw;

      if (isLink) {
        // 处理 "link -> /target" 格式
        const arrowIdx = nameRaw.indexOf(' -> ');
        if (arrowIdx >= 0) {
          name = nameRaw.slice(0, arrowIdx);
          linkTarget = nameRaw.slice(arrowIdx + 4);
        }
      }

      // 跳过 . 和 ..(虽然 -A 应该不输出,但保险)
      if (name === '.' || name === '..') continue;

      const isDir = typeChar === 'd';
      const fullPath = this.joinPath(baseDir, name);
      const ext = isDir || isLink ? '' : this.getExt(name);

      entries.push({
        name,
        path: fullPath,
        isDir,
        isLink,
        linkTarget,
        size: isDir ? 0 : size,
        perms,
        type: typeChar,
        owner,
        group,
        mtime,
        ext,
      });
    }

    // 排序:目录在前,然后按名称排序(不区分大小写)
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    return entries;
  }

  /** 获取文件/目录 stat */
  async stat(remotePath: string, deviceSerial?: string): Promise<FileEntry | null> {
    const safePath = this.quote(remotePath);
    try {
      // ls -ld 显示自身信息
      const out = await this.shellDevice(`ls -ld ${safePath}`, { timeout: 5000 }, deviceSerial);
      const entries = this.parseLsOutput(out, this.parentDir(remotePath));
      return entries.find((e) => e.path === remotePath) ?? entries[0] ?? null;
    } catch {
      return null;
    }
  }

  /** 判断路径是否存在 */
  async exists(remotePath: string): Promise<boolean> {
    const safePath = this.quote(remotePath);
    try {
      const out = await AdbService.shell(`[ -e ${safePath} ] && echo yes || echo no`, {
        timeout: 5000,
      });
      return out.trim() === 'yes';
    } catch {
      return false;
    }
  }

  /** 创建目录(支持递归) */
  async mkdir(remotePath: string, recursive = true): Promise<void> {
    const flag = recursive ? '-p' : '';
    await AdbService.shell(`mkdir ${flag} ${this.quote(remotePath)}`, { timeout: 10000 });
  }

  /** 删除文件或目录(递归) */
  async remove(remotePath: string, recursive = true): Promise<void> {
    const flag = recursive ? '-rf' : '-f';
    await AdbService.shell(`rm ${flag} ${this.quote(remotePath)}`, { timeout: 60000 });
  }

  /** 重命名/移动 */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await AdbService.shell(
      `mv ${this.quote(oldPath)} ${this.quote(newPath)}`,
      { timeout: 60000 },
    );
  }

  /** 复制(支持递归) */
  async copy(srcPath: string, dstPath: string, recursive = true): Promise<void> {
    const flag = recursive ? '-r' : '';
    await AdbService.shell(
      `cp ${flag} ${this.quote(srcPath)} ${this.quote(dstPath)}`,
      { timeout: 120000 },
    );
  }

  /** 推送本地文件到设备(带进度) */
  async push(
    local: string,
    remote: string,
    deviceSerial?: string,
    onProgress?: (p: TransferProgress) => void,
  ): Promise<void> {
    logger.info('file', `push: ${local} -> ${remote}`);
    // 先确保目标目录存在
    const remoteDir = this.parentDir(remote);
    if (remoteDir && remoteDir !== '/') {
      try {
        await this.mkdir(remoteDir, true);
      } catch {
        // 目录可能已存在,忽略
      }
    }
    const args = this.deviceArgs(deviceSerial);
    args.push('push', local, remote);
    // adb push 输出形如:[ 10%] /sdcard/x.mp4
    await this.spawnWithProgress(args, {
      local,
      remote,
      direction: 'push',
      onProgress,
    });
    // 保留 mtime:用 touch -r 不行(本地),改用 adb shell touch -d
    if (this.keepMtime) {
      try {
        const localMtime = await this.getLocalMtime(local);
        if (localMtime) {
          await this.shellDevice(
            `touch -d '${localMtime}' ${this.quote(remote)}`,
            { timeout: 5000, root: false },
            deviceSerial,
          );
        }
      } catch {
        // 非关键,忽略
      }
    }
  }

  /** 从设备拉取文件到本地(带进度) */
  async pull(
    remote: string,
    local: string,
    deviceSerial?: string,
    onProgress?: (p: TransferProgress) => void,
  ): Promise<void> {
    logger.info('file', `pull: ${remote} -> ${local}`);
    const args = this.deviceArgs(deviceSerial);
    args.push('pull', remote, local);
    // adb pull 输出形如:[ 10%] /sdcard/x.mp4
    await this.spawnWithProgress(args, {
      local,
      remote,
      direction: 'pull',
      onProgress,
    });
    // 保留 mtime:从设备 stat 拿到 mtime,本地 touch
    if (this.keepMtime) {
      // 不强制实现,保留接口
    }
  }

  /** 安装设备上的 APK 文件(远程安装) */
  async installRemoteApk(remoteApk: string): Promise<{ success: boolean; error?: string }> {
    try {
      // pm install -r <path>
      const out = await AdbService.shell(`pm install -r ${this.quote(remoteApk)}`, {
        timeout: 120000,
      });
      const success = out.includes('Success');
      if (!success) {
        return { success: false, error: out.trim() || '安装失败' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /** 获取磁盘信息(df) */
  async diskInfo(remotePath = '/sdcard'): Promise<DiskInfo | null> {
    try {
      // toybox df -k <path> 输出:Filesystem 1K-blocks Used Available Use% Mounted on
      const out = await AdbService.shell(`df -k ${this.quote(remotePath)}`, { timeout: 10000 });
      const lines = out.split('\n').filter((l) => l.trim());
      // 取最后一行数据
      const dataLine = lines[lines.length - 1];
      if (!dataLine) return null;
      // 兼容:有些设备 Filesystem 列很长会换行,取数字字段
      const parts = dataLine.split(/\s+/);
      // 找到 4 个连续数字字段
      const nums: number[] = [];
      for (const p of parts) {
        const n = parseInt(p, 10);
        if (!isNaN(n) && /^\d+$/.test(p)) nums.push(n);
      }
      if (nums.length < 4) return null;
      // 1K-blocks, Used, Available, Use%
      const total = nums[0] * 1024;
      const used = nums[1] * 1024;
      const available = nums[2] * 1024;
      const usagePercent = nums[3] > 100 ? Math.round((used / total) * 100) : nums[3];
      return { path: remotePath, total, used, available, usagePercent };
    } catch {
      return null;
    }
  }

  /** 读取文本文件内容(限小文件,<1MB) */
  async readTextFile(remotePath: string, maxBytes = 1024 * 1024): Promise<string> {
    const safePath = this.quote(remotePath);
    // cat 输出
    const out = await AdbService.shell(`cat ${safePath}`, { timeout: 10000 });
    if (out.length > maxBytes) {
      return out.slice(0, maxBytes) + '\n... [文件过大,已截断]';
    }
    return out;
  }

  /** 创建空文件(对应 wkbin 的 Create file) */
  async createFile(remotePath: string, content = ''): Promise<void> {
    const safePath = this.quote(remotePath);
    if (content) {
      // 用 echo 写入(转义单引号)
      // 写入临时再 mv,避免 shell 引号问题。这里用 printf '%s'
      const escaped = content.replace(/'/g, `'\\''`);
      await AdbService.shell(`printf '%s' '${escaped}' > ${safePath}`, { timeout: 10000 });
    } else {
      // touch 创建空文件
      await AdbService.shell(`touch ${safePath}`, { timeout: 5000 });
    }
  }

  /** 写入文本文件(覆盖,对应 wkbin 的 Edit) */
  async writeFile(remotePath: string, content: string): Promise<void> {
    const safePath = this.quote(remotePath);
    // 用 printf '%s' 写入,转义单引号
    const escaped = content.replace(/'/g, `'\\''`);
    await AdbService.shell(`printf '%s' '${escaped}' > ${safePath}`, { timeout: 30000 });
  }

  /** 修改权限(对应 wkbin 计划中的 File permission modification) */
  async chmod(remotePath: string, mode: string, recursive = false): Promise<void> {
    const flag = recursive ? '-R' : '';
    await AdbService.shell(`chmod ${flag} ${mode} ${this.quote(remotePath)}`, {
      timeout: 30000,
      root: false,
    });
  }

  /** 批量删除(对应 T0biasCZe/JSleim 的多选批量操作) */
  async batchRemove(paths: string[], recursive = true): Promise<{ success: string[]; failed: { path: string; error: string }[] }> {
    const flag = recursive ? '-rf' : '-f';
    const success: string[] = [];
    const failed: { path: string; error: string }[] = [];
    for (const p of paths) {
      try {
        await AdbService.shell(`rm ${flag} ${this.quote(p)}`, { timeout: 60000 });
        success.push(p);
      } catch (e) {
        failed.push({ path: p, error: (e as Error).message });
      }
    }
    return { success, failed };
  }

  /** 在当前目录内搜索(对应 wkbin 的 File search) */
  async searchInDir(dir: string, query: string, deviceSerial?: string): Promise<FileEntry[]> {
    // find <dir> -iname '*query*' -maxdepth 1(避免递归过深)
    // 旧 Android 可能没有 find,回退到 ls | grep
    const safeDir = this.quote(dir);
    const safeQuery = this.quote(`*${query}*`);
    let out: string;
    try {
      out = await this.shellDevice(
        `find ${safeDir} -maxdepth 1 -iname ${safeQuery} 2>/dev/null`,
        { timeout: 15000 },
        deviceSerial,
      );
    } catch {
      // find 不可用,回退 ls + grep
      out = await this.shellDevice(
        `ls ${safeDir} | grep -i ${this.quote(query)}`,
        { timeout: 15000 },
        deviceSerial,
      );
    }
    const foundPaths = out.split('\n').map((l) => l.trim()).filter(Boolean);
    // 对每个结果 stat 获取详细信息
    const results: FileEntry[] = [];
    for (const p of foundPaths) {
      const e = await this.stat(p, deviceSerial);
      if (e) results.push(e);
    }
    return results;
  }

  /** 列出所有已连接的 ADB 设备(对应 wkbin/JSleim 的 Multi-device support) */
  async listDevices(): Promise<{ serial: string; state: string; model?: string }[]> {
    const result = await SubprocessPool.spawn({
      cmd: paths.binFile('adb.exe'),
      args: ['devices', '-l'],
      encoding: 'utf-8',
      timeout: 5000,
      cwd: paths.bin,
    });
    const devices: { serial: string; state: string; model?: string }[] = [];
    const lines = result.stdout.split('\n').slice(1); // 跳过 "List of devices attached"
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 格式:serial\tstate\tkey:value key:model:XXX ...
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const serial = parts[0];
      const state = parts[1];
      if (state !== 'device' && state !== 'unauthorized' && state !== 'offline') continue;
      // 解析 model:xxx
      const modelField = parts.find((p) => p.startsWith('model:'));
      const model = modelField ? modelField.slice(6) : undefined;
      devices.push({ serial, state, model });
    }
    return devices;
  }

  // ========== 内部:多设备/进度相关 ==========

  /** 构造带 -s <serial> 的 adb 参数前缀 */
  private deviceArgs(serial?: string): string[] {
    return serial ? ['-s', serial] : [];
  }

  /** 在指定设备上执行 shell(默认走 AdbService,指定 serial 时直接 spawn) */
  private async shellDevice(
    cmd: string,
    opts: { timeout?: number; root?: boolean } = {},
    deviceSerial?: string,
  ): Promise<string> {
    if (!deviceSerial) {
      return AdbService.shell(cmd, opts);
    }
    const args = ['-s', deviceSerial, 'shell'];
    if (opts.root) {
      args.push(`su -c '${cmd.replace(/'/g, "'\\''")}'`);
    } else {
      args.push(cmd);
    }
    const result = await SubprocessPool.spawn({
      cmd: paths.binFile('adb.exe'),
      args,
      encoding: 'gbk',
      timeout: opts.timeout ?? 30000,
      cwd: paths.bin,
    });
    return result.stdout;
  }

  /**
   * spawn adb push/pull 并解析 [XX%] 进度
   * adb push/pull 进度行格式(无换行,用 \r 刷新):
   *   [ 10%] /sdcard/x.mp4
   *   [100%] /sdcard/x.mp4
   */
  private async spawnWithProgress(
    args: string[],
    ctx: { local: string; remote: string; direction: 'push' | 'pull'; onProgress?: (p: TransferProgress) => void },
  ): Promise<void> {
    let lastPercent = 0;
    await SubprocessPool.spawn({
      cmd: paths.binFile('adb.exe'),
      args,
      encoding: 'utf-8',
      timeout: 0, // 不超时(大文件)
      cwd: paths.bin,
      onStdout: (line) => {
        // 解析 [XX%]
        const m = line.match(/\[\s*(\d+)%\]/);
        if (m && ctx.onProgress) {
          const percent = parseInt(m[1], 10);
          if (percent !== lastPercent) {
            lastPercent = percent;
            ctx.onProgress({
              local: ctx.local,
              remote: ctx.remote,
              direction: ctx.direction,
              transferred: 0,
              total: 0,
              percent,
            });
          }
        }
      },
    });
    // 完成时发 100%
    if (ctx.onProgress && lastPercent < 100) {
      ctx.onProgress({
        local: ctx.local,
        remote: ctx.remote,
        direction: ctx.direction,
        transferred: 0,
        total: 0,
        percent: 100,
      });
    }
  }

  /** 获取本地文件的修改时间(YYYY-MM-DD HH:MM:SS 格式,供 touch -d 用) */
  private async getLocalMtime(localPath: string): Promise<string | null> {
    try {
      const fs = await import('node:fs');
      const stat = fs.statSync(localPath);
      const d = stat.mtime;
      const pad = (n: number): string => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch {
      return null;
    }
  }

  // ========== 工具方法 ==========

  /** 单引号转义路径 */
  private quote(p: string): string {
    return `'${String(p).replace(/'/g, `'\\''`)}'`;
  }

  /** 拼接路径 */
  private joinPath(base: string, name: string): string {
    if (base.endsWith('/')) return base + name;
    return base + '/' + name;
  }

  /** 获取父目录 */
  private parentDir(p: string): string {
    const idx = p.lastIndexOf('/');
    if (idx <= 0) return '/';
    return p.slice(0, idx);
  }

  /** 获取扩展名(小写无点) */
  private getExt(name: string): string {
    const idx = name.lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) return '';
    return name.slice(idx + 1).toLowerCase();
  }
}

export const FileService = new FileServiceClass();
