// electron/services/EdlPartitionService.ts - EDL 分区管理(基于 edl-ng)
//
// 工具:edl-ng v1.5.0(.NET 9 AOT,MIT,resources/bin/edl-ng/edl-ng.exe)
// 优势:实时读设备 GPT(printgpt),不依赖静态 XML,设备分区变动也能正确识别
//
// 与现有 EdlService(QSaharaServer + fh_loader)的关系:
//   - EdlService 负责 root 流程和全盘备份,不动
//   - 本服务只负责"EDL 分区管理"页面,独立用 edl-ng
//   - loader(prog_firehose_ddr.elf/msm8909w.mbn/msm8937.mbn)复用 resources/edl/
//
// 风险说明:
//   - edl-ng README 明说 MSM8998 以下未测试,iMoo 的 MSM8909W/MSM8953 可能不支持
//   - 只读操作(printgpt/read-part)安全,跑不通只是功能不可用,不会变砖
//   - 写操作(write-part/erase-part)有变砖风险,需真实设备验证后使用

import { SubprocessPool, type SpawnResult } from './SubprocessPool';
import { DeviceService } from './DeviceService';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('EdlPartitionService');

/** 分区信息(从 edl-ng printgpt 实时解析) */
export interface EdlPartition {
  label: string;
  typeGuid: string;
  uid: string;
  firstLba: number;
  lastLba: number;
  sizeBytes: number;
  lun: number;
}

/** 存储几何信息 */
export interface EdlStorageInfo {
  sectorSize: number;
  lunCount: number;
}

/** 操作记录(内存,会话级) */
export interface EdlOperationRecord {
  id: string;
  type: 'printgpt' | 'backup' | 'restore' | 'erase' | 'reset' | 'verify';
  label: string;
  timestamp: number;
  success: boolean;
  message: string;
  durationMs: number;
}

/** 校验结果 */
export interface VerifyResult {
  success: boolean;
  matched: boolean;
  bytesRead: number;
  bytesExpected: number;
  error?: string;
}

/** 传输进度(edl-ng 进度行解析) */
export interface TransferProgress {
  operation: string;       // Reading / Writing
  percent: number;
  transferredMiB: number;
  totalMiB: number;
  speed: string;
}

/** 关键分区黑名单(擦除需额外确认) */
const CRITICAL_PARTITIONS = [
  'boot', 'system', 'modem', 'recovery', 'xbl', 'sbl', 'aboot',
  'tz', 'rpm', 'hyp', 'modemst1', 'modemst2', 'fsg', 'fsc', 'ssd',
  'DDR', 'pad',
];

/** edl-ng 进度行正则:\rReading: 45.3% (12.50 / 27.60 MiB) [3.45 MiB/s] */
const PROGRESS_RE = /(\w+):\s*([\d.]+)%\s*\(([\d.]+)\s*\/\s*([\d.]+)\s*MiB\)\s*\[([^\]]+)\]/;

class EdlPartitionServiceClass {
  /** edl-ng 可执行文件路径 */
  private edlNgPath = paths.edlNgFile('edl-ng.exe');
  /** edl-ng 工作目录(放 libusb-1.0.dll) */
  private edlNgDir = paths.edlNg;

  /** 操作记录(最近 50 条) */
  private operationHistory: EdlOperationRecord[] = [];
  private historyIdCounter = 0;

  // ========== 分区表(实时读设备 GPT) ==========

  /**
   * 读 GPT 分区表(edl-ng printgpt)
   * 实时从设备读取,不依赖静态 XML
   */
  async printGpt(opts: {
    loader: string;
    onProgress?: (msg: string) => void;
  }): Promise<{ success: boolean; partitions: EdlPartition[]; storage?: EdlStorageInfo; error?: string }> {
    const { loader, onProgress } = opts;
    const start = Date.now();
    try {
      if (!fs.existsSync(loader)) {
        throw new Error(`firehose loader 不存在: ${loader}`);
      }
      onProgress?.('正在读取 GPT 分区表...');
      const result = await this.spawnEdlNg([
        '--loader', loader,
        '--memory', 'Sdcc',  // iMoo 是 eMMC
        '--slot', '0',
        'printgpt',
      ], onProgress);

      if (result.exitCode !== 0) {
        const msg = `printgpt 失败(退出码 ${result.exitCode}): ${result.stderr || result.stdout}`;
        this.recordOperation({ type: 'printgpt', label: '-', success: false, message: msg, durationMs: Date.now() - start });
        return { success: false, partitions: [], error: msg };
      }

      const partitions = this.parseGptOutput(result.stdout);
      const storage = this.parseStorageInfo(result.stdout);

      const msg = `读取成功,共 ${partitions.length} 个分区`;
      onProgress?.(msg);
      this.recordOperation({ type: 'printgpt', label: '-', success: true, message: msg, durationMs: Date.now() - start });
      return { success: true, partitions, storage };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`printgpt 失败: ${msg}`);
      this.recordOperation({ type: 'printgpt', label: '-', success: false, message: msg, durationMs: Date.now() - start });
      return { success: false, partitions: [], error: msg };
    }
  }

  /**
   * 解析 edl-ng printgpt 输出
   * 格式(每分区多行):
   *   --- Partitions LUN 0 ---
   *     Name: modem
   *       Type: {GUID}
   *       UID:  {GUID}
   *       LBA:  1024-5120 (Size: 20.00 MiB)
   */
  private parseGptOutput(output: string): EdlPartition[] {
    const partitions: EdlPartition[] = [];
    let current: Partial<EdlPartition> | null = null;
    let currentLun = 0;

    for (const line of output.split('\n')) {
      const trimmed = line.trim();

      // 检测 LUN 切换: "--- Partitions LUN 0 ---"
      const lunMatch = trimmed.match(/--- Partitions\s+(?:LUN\s+)?(\d+)\s*---/i);
      if (lunMatch) {
        currentLun = parseInt(lunMatch[1], 10);
        continue;
      }

      // 分区名: "Name: modem"
      const nameMatch = trimmed.match(/^Name:\s*(.+)$/);
      if (nameMatch) {
        if (current) partitions.push(current as EdlPartition);
        current = { label: nameMatch[1].trim(), lun: currentLun };
        continue;
      }

      if (!current) continue;

      // Type: {GUID}
      const typeMatch = trimmed.match(/^Type:\s*(.+)$/);
      if (typeMatch) { current.typeGuid = typeMatch[1].trim(); continue; }

      // UID: {GUID}
      const uidMatch = trimmed.match(/^UID:\s*(.+)$/);
      if (uidMatch) { current.uid = uidMatch[1].trim(); continue; }

      // LBA: 1024-5120 (Size: 20.00 MiB)  支持 KiB/MiB/GiB
      const lbaMatch = trimmed.match(/^LBA:\s*(\d+)-(\d+)\s*\(Size:\s*([\d.]+)\s*(KiB|MiB|GiB)\)/i);
      if (lbaMatch) {
        current.firstLba = parseInt(lbaMatch[1], 10);
        current.lastLba = parseInt(lbaMatch[2], 10);
        const val = parseFloat(lbaMatch[3]);
        const unit = lbaMatch[4].toLowerCase();
        const mult = unit === 'kib' ? 1024 : unit === 'mib' ? 1024 * 1024 : 1024 * 1024 * 1024;
        current.sizeBytes = Math.round(val * mult);
        continue;
      }
    }
    if (current) partitions.push(current as EdlPartition);

    // 过滤无效项
    return partitions.filter((p) => p.label && p.sizeBytes > 0);
  }

  /** 解析存储几何信息(扇区大小、LUN 数) */
  private parseStorageInfo(output: string): EdlStorageInfo | undefined {
    let sectorSize = 512;
    let lunCount = 1;

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      // "Using sector size: 512 bytes for LUN 0."
      const sectorMatch = trimmed.match(/sector size:\s*(\d+)\s*bytes/i);
      if (sectorMatch) {
        sectorSize = parseInt(sectorMatch[1], 10);
      }
      // 统计 LUN 数:出现 "--- GPT Header LUN N ---" 的不同 N
      const lunHeaderMatch = trimmed.match(/--- (?:GPT Header|Partitions)\s+LUN\s+(\d+)\s*---/i);
      if (lunHeaderMatch) {
        const lun = parseInt(lunHeaderMatch[1], 10) + 1;
        if (lun > lunCount) lunCount = lun;
      }
    }

    return { sectorSize, lunCount };
  }

  // ========== 单分区操作 ==========

  /**
   * 备份单个分区(edl-ng read-part)
   * edl-ng 自动按分区名找位置,不需要手动指定 LBA
   */
  async backupPartition(opts: {
    loader: string;
    label: string;
    outputFile: string;
    onProgress?: (msg: string) => void;
    onTransferProgress?: (p: TransferProgress) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { loader, label, outputFile, onProgress, onTransferProgress } = opts;
    const start = Date.now();
    try {
      if (!fs.existsSync(loader)) {
        throw new Error(`firehose loader 不存在: ${loader}`);
      }
      const outputDir = path.dirname(outputFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      onProgress?.(`正在备份分区: ${label}`);
      const result = await this.spawnEdlNgWithProgress([
        '--loader', loader,
        '--memory', 'Sdcc',
        '--slot', '0',
        'read-part', label, outputFile,
      ], onProgress, onTransferProgress);

      if (result.exitCode !== 0) {
        const msg = `备份失败: ${result.stderr || result.stdout}`;
        this.recordOperation({ type: 'backup', label, success: false, message: msg, durationMs: Date.now() - start });
        return { success: false, error: msg };
      }

      // 校验输出文件
      if (!fs.existsSync(outputFile)) {
        const msg = '备份失败: 输出文件未生成';
        this.recordOperation({ type: 'backup', label, success: false, message: msg, durationMs: Date.now() - start });
        return { success: false, error: msg };
      }

      const msg = `备份完成: ${outputFile}`;
      onProgress?.(msg);
      this.recordOperation({ type: 'backup', label, success: true, message: msg, durationMs: Date.now() - start });
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`备份分区 ${label} 失败: ${msg}`);
      this.recordOperation({ type: 'backup', label, success: false, message: msg, durationMs: Date.now() - start });
      return { success: false, error: msg };
    }
  }

  /**
   * 恢复单个分区(edl-ng write-part)
   * 安全:可选恢复前备份 + 可选恢复后校验
   */
  async restorePartition(opts: {
    loader: string;
    label: string;
    inputFile: string;
    backupBeforeRestore?: boolean;
    backupOutputDir?: string;
    verifyAfterRestore?: boolean;
    onProgress?: (msg: string) => void;
    onTransferProgress?: (p: TransferProgress) => void;
  }): Promise<{ success: boolean; error?: string; backupPath?: string }> {
    const {
      loader, label, inputFile,
      backupBeforeRestore = true,
      backupOutputDir,
      verifyAfterRestore = false,
      onProgress,
      onTransferProgress,
    } = opts;
    const start = Date.now();
    let backupPath: string | undefined;

    try {
      if (!fs.existsSync(loader)) {
        throw new Error(`firehose loader 不存在: ${loader}`);
      }
      if (!fs.existsSync(inputFile)) {
        throw new Error(`输入文件不存在: ${inputFile}`);
      }

      // 恢复前备份(安全网)
      if (backupBeforeRestore) {
        if (!backupOutputDir) {
          throw new Error('backupBeforeRestore=true 时需提供 backupOutputDir');
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        backupPath = path.join(backupOutputDir, `${label}_pre_restore_${ts}.img`);
        onProgress?.(`恢复前备份当前分区到: ${backupPath}`);
        const backupRes = await this.backupPartition({
          loader, label, outputFile: backupPath, onProgress, onTransferProgress,
        });
        if (!backupRes.success) {
          throw new Error(`恢复前备份失败: ${backupRes.error}(已中止恢复以防数据丢失)`);
        }
      }

      onProgress?.(`正在恢复分区: ${label}`);
      const result = await this.spawnEdlNgWithProgress([
        '--loader', loader,
        '--memory', 'Sdcc',
        '--slot', '0',
        'write-part', label, inputFile,
      ], onProgress, onTransferProgress);

      if (result.exitCode !== 0) {
        const msg = `恢复失败: ${result.stderr || result.stdout}`;
        this.recordOperation({ type: 'restore', label, success: false, message: msg, durationMs: Date.now() - start });
        return { success: false, error: msg, backupPath };
      }

      // 恢复后校验
      if (verifyAfterRestore) {
        onProgress?.('恢复后读回校验...');
        const verify = await this.verifyPartition({ loader, label, expectedFile: inputFile, onProgress, onTransferProgress });
        if (!verify.matched) {
          onProgress?.(`校验未通过: ${verify.error ?? '数据不一致'}`);
        } else {
          onProgress?.('校验通过');
        }
      }

      const msg = `恢复完成: ${label}`;
      onProgress?.(msg);
      this.recordOperation({
        type: 'restore', label, success: true,
        message: msg + (backupPath ? '(已备份原数据)' : ''),
        durationMs: Date.now() - start,
      });
      return { success: true, backupPath };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`恢复分区 ${label} 失败: ${msg}`);
      this.recordOperation({ type: 'restore', label, success: false, message: msg, durationMs: Date.now() - start });
      return { success: false, error: msg, backupPath };
    }
  }

  /**
   * 校验分区:读回分区与本地文件逐字节比对
   */
  async verifyPartition(opts: {
    loader: string;
    label: string;
    expectedFile: string;
    onProgress?: (msg: string) => void;
    onTransferProgress?: (p: TransferProgress) => void;
  }): Promise<VerifyResult> {
    const { loader, label, expectedFile, onProgress, onTransferProgress } = opts;
    const start = Date.now();
    try {
      if (!fs.existsSync(expectedFile)) {
        return { success: false, matched: false, bytesRead: 0, bytesExpected: 0, error: '预期文件不存在' };
      }
      const expectedSize = fs.statSync(expectedFile).size;

      // 读回分区到临时文件
      const workDir = paths.edlWork;
      if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
      const readBackPath = path.join(workDir, `verify_${label}_${Date.now()}.img`);

      onProgress?.(`读回分区 ${label} 进行校验...`);
      const result = await this.spawnEdlNgWithProgress([
        '--loader', loader,
        '--memory', 'Sdcc',
        '--slot', '0',
        'read-part', label, readBackPath,
      ], onProgress, onTransferProgress);

      if (result.exitCode !== 0 || !fs.existsSync(readBackPath)) {
        this.recordOperation({ type: 'verify', label, success: false, message: '读回失败', durationMs: Date.now() - start });
        return { success: false, matched: false, bytesRead: 0, bytesExpected: expectedSize, error: '读回失败' };
      }

      const actualSize = fs.statSync(readBackPath).size;
      let matched = actualSize === expectedSize;

      if (matched) {
        // 逐字节比对(4MB 分块,避免内存爆)
        const expectedFd = fs.openSync(expectedFile, 'r');
        const actualFd = fs.openSync(readBackPath, 'r');
        const bufSize = 4 * 1024 * 1024;
        const buf1 = Buffer.alloc(bufSize);
        const buf2 = Buffer.alloc(bufSize);
        let offset = 0;
        while (offset < expectedSize) {
          const toRead = Math.min(bufSize, expectedSize - offset);
          const r1 = fs.readSync(expectedFd, buf1, 0, toRead, offset);
          const r2 = fs.readSync(actualFd, buf2, 0, toRead, offset);
          if (r1 !== r2 || buf1.compare(buf2, 0, r1, 0, r2) !== 0) {
            matched = false;
            break;
          }
          offset += r1;
        }
        fs.closeSync(expectedFd);
        fs.closeSync(actualFd);
      }

      try { fs.unlinkSync(readBackPath); } catch { /* ignore */ }

      this.recordOperation({
        type: 'verify', label, success: true,
        message: matched ? '校验通过' : '数据不一致',
        durationMs: Date.now() - start,
      });
      return { success: true, matched, bytesRead: actualSize, bytesExpected: expectedSize };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`校验分区 ${label} 失败: ${msg}`);
      this.recordOperation({ type: 'verify', label, success: false, message: msg, durationMs: Date.now() - start });
      return { success: false, matched: false, bytesRead: 0, bytesExpected: 0, error: msg };
    }
  }

  /**
   * 擦除单个分区(edl-ng erase-part)
   * edl-ng 直接发 firehose erase 命令,不需要生成全零镜像
   */
  async erasePartition(opts: {
    loader: string;
    label: string;
    onProgress?: (msg: string) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { loader, label, onProgress } = opts;
    const start = Date.now();
    try {
      if (!fs.existsSync(loader)) {
        throw new Error(`firehose loader 不存在: ${loader}`);
      }
      onProgress?.(`正在擦除分区: ${label}`);
      const result = await this.spawnEdlNg([
        '--loader', loader,
        '--memory', 'Sdcc',
        '--slot', '0',
        'erase-part', label,
      ], onProgress);

      if (result.exitCode !== 0) {
        const msg = `擦除失败: ${result.stderr || result.stdout}`;
        this.recordOperation({ type: 'erase', label, success: false, message: msg, durationMs: Date.now() - start });
        return { success: false, error: msg };
      }

      const msg = `擦除完成: ${label}`;
      onProgress?.(msg);
      this.recordOperation({ type: 'erase', label, success: true, message: msg, durationMs: Date.now() - start });
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`擦除分区 ${label} 失败: ${msg}`);
      this.recordOperation({ type: 'erase', label, success: false, message: msg, durationMs: Date.now() - start });
      return { success: false, error: msg };
    }
  }

  /** 重启设备(edl-ng reset) */
  async resetDevice(opts: {
    loader: string;
    onProgress?: (msg: string) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { loader, onProgress } = opts;
    const start = Date.now();
    try {
      if (!fs.existsSync(loader)) {
        throw new Error(`firehose loader 不存在: ${loader}`);
      }
      onProgress?.('正在重启设备...');
      const result = await this.spawnEdlNg([
        '--loader', loader,
        '--memory', 'Sdcc',
        '--slot', '0',
        'reset', '--mode', 'Reset', '--delay', '1',
      ], onProgress);

      if (result.exitCode !== 0) {
        const msg = `重启失败: ${result.stderr || result.stdout}`;
        this.recordOperation({ type: 'reset', label: '-', success: false, message: msg, durationMs: Date.now() - start });
        return { success: false, error: msg };
      }

      const msg = '重启指令已发送';
      onProgress?.(msg);
      this.recordOperation({ type: 'reset', label: '-', success: true, message: msg, durationMs: Date.now() - start });
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`重启失败: ${msg}`);
      this.recordOperation({ type: 'reset', label: '-', success: false, message: msg, durationMs: Date.now() - start });
      return { success: false, error: msg };
    }
  }

  // ========== 辅助 ==========

  /** 检查设备是否在 9008 模式 */
  async checkEdlDevice(): Promise<{ inEdl: boolean; port?: string }> {
    const device = DeviceService.instance.current();
    if (device?.type === 'qcom_edl') {
      return { inEdl: true, port: device.port };
    }
    return { inEdl: false };
  }

  /** 判断分区是否关键 */
  isCritical(label: string): boolean {
    return CRITICAL_PARTITIONS.includes(label);
  }

  /** 获取可用 loader 列表 */
  listLoaders(): { name: string; path: string; description: string }[] {
    return [
      { name: 'msm8909w.mbn', path: paths.edlFile('msm8909w.mbn'), description: 'Z2-Z6 非 V3' },
      { name: 'msm8937.mbn', path: paths.edlFile('msm8937.mbn'), description: 'V3 机型(Z6+/Z7+)' },
      { name: 'prog_firehose_ddr.elf', path: paths.edlFile('prog_firehose_ddr.elf'), description: 'Z10/ND03' },
    ];
  }

  // ========== 操作历史 ==========

  getHistory(): EdlOperationRecord[] {
    return [...this.operationHistory].reverse();
  }

  clearHistory(): void {
    this.operationHistory = [];
  }

  private recordOperation(opts: {
    type: EdlOperationRecord['type'];
    label: string;
    success: boolean;
    message: string;
    durationMs: number;
  }): void {
    this.operationHistory.push({
      id: `op-${++this.historyIdCounter}`,
      ...opts,
      timestamp: Date.now(),
    });
    if (this.operationHistory.length > 50) {
      this.operationHistory.shift();
    }
  }

  // ========== 内部:edl-ng 调用 ==========

  /** spawn edl-ng,捕获完整输出(无进度解析) */
  private async spawnEdlNg(
    args: string[],
    onProgress?: (msg: string) => void,
  ): Promise<SpawnResult> {
    logger.info(`edl-ng ${args.join(' ')}`);
    return SubprocessPool.spawn({
      cmd: this.edlNgPath,
      args,
      encoding: 'utf-8',
      timeout: 0,  // 不超时(大文件操作)
      cwd: this.edlNgDir,
      onStdout: (line) => {
        logger.info(`edl-ng: ${line}`);
        onProgress?.(line);
      },
      onStderr: (line) => {
        logger.warn(`edl-ng stderr: ${line}`);
      },
    });
  }

  /** spawn edl-ng,解析进度行(\r 前缀的百分比行) */
  private async spawnEdlNgWithProgress(
    args: string[],
    onProgress?: (msg: string) => void,
    onTransferProgress?: (p: TransferProgress) => void,
  ): Promise<SpawnResult> {
    logger.info(`edl-ng ${args.join(' ')}`);
    return SubprocessPool.spawn({
      cmd: this.edlNgPath,
      args,
      encoding: 'utf-8',
      timeout: 0,
      cwd: this.edlNgDir,
      onStdout: (line) => {
        // 尝试匹配进度行
        const m = line.match(PROGRESS_RE);
        if (m && onTransferProgress) {
          onTransferProgress({
            operation: m[1],
            percent: parseFloat(m[2]),
            transferredMiB: parseFloat(m[3]),
            totalMiB: parseFloat(m[4]),
            speed: m[5],
          });
        } else {
          logger.info(`edl-ng: ${line}`);
          onProgress?.(line);
        }
      },
      onStderr: (line) => {
        logger.warn(`edl-ng stderr: ${line}`);
      },
    });
  }
}

export const EdlPartitionService = new EdlPartitionServiceClass();
