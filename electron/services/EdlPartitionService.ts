// electron/services/EdlPartitionService.ts - EDL 分区管理(基于 QSaharaServer + fh_loader)
//
// 复用现有 EdlService 的 loadFirehose/flashPartitions/readPartitions/reboot/findPort/waitForEdl
// 分区表来源:resources/edl/allxml/<innermodel>.xml(静态,不连设备可用)
// 单分区操作:动态生成只含一个 <program> 的 XML → 复用 fh_loader
//
// 不引入任何新依赖,零芯片支持不确定性(Qualcomm 官方工具,root 流程已验证)

import { EdlService, type EdlOptions, type Partition } from './EdlService';
import { DeviceService } from './DeviceService';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('EdlPartitionService');

/** 分区信息(从 allxml 解析,扩展自 EdlService.Partition) */
export interface EdlPartition {
  label: string;
  filename: string;
  startSector: number;
  numSectors: number;
  sizeBytes: number;
  sizeInKb?: number;
  lun: number;
  sectorSize: number;
}

/** 可用型号(从 allxml 目录扫描) */
export interface EdlModel {
  innermodel: string;
  xmlPath: string;
  partitionCount: number;
}

/** 操作记录(内存,会话级) */
export interface EdlOperationRecord {
  id: string;
  type: 'backup' | 'restore' | 'erase' | 'reset' | 'verify';
  innermodel: string;
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

/** 关键分区黑名单 */
const CRITICAL_PARTITIONS = [
  'boot', 'system', 'modem', 'recovery', 'xbl', 'sbl', 'aboot',
  'tz', 'rpm', 'hyp', 'modemst1', 'modemst2', 'fsg', 'fsc', 'ssd',
  'DDR', 'pad',
];

class EdlPartitionServiceClass {
  private edlService = EdlService;
  /** 操作记录(最近 50 条,会话级) */
  private operationHistory: EdlOperationRecord[] = [];
  private historyIdCounter = 0;

  // ========== 型号 & 分区表(不连设备可用) ==========

  /** 列出所有可用型号(扫描 allxml 目录) */
  async listModels(): Promise<EdlModel[]> {
    const dir = paths.edlAllxml;
    const models: EdlModel[] = [];
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));
      for (const f of files) {
        const innermodel = f.replace(/\.xml$/, '');
        const xmlPath = path.join(dir, f);
        // 快速解析分区数
        const partitions = this.parsePartitionXml(xmlPath);
        models.push({ innermodel, xmlPath, partitionCount: partitions.length });
      }
    } catch (e) {
      logger.error(`扫描型号失败: ${(e as Error).message}`);
    }
    // 按 innermodel 排序
    models.sort((a, b) => a.innermodel.localeCompare(b.innermodel));
    return models;
  }

  /** 解析型号的分区表 XML,返回所有分区 */
  async listPartitions(innermodel: string): Promise<EdlPartition[]> {
    const xmlPath = paths.edlAllxmlFile(`${innermodel}.xml`);
    if (!fs.existsSync(xmlPath)) {
      throw new Error(`分区表不存在: ${innermodel}.xml`);
    }
    return this.parsePartitionXml(xmlPath);
  }

  /** 解析单个 XML 文件为分区数组 */
  private parsePartitionXml(xmlPath: string): EdlPartition[] {
    // 复用 EdlService.parseAllXml,再补充 lun/sectorSize/sizeBytes
    const raw: Partition[] = this.edlService.parseAllXml(xmlPath);
    return raw.map((p) => {
      const sectorSize = 512; // iMoo 全系列 SECTOR_SIZE_IN_BYTES=512
      return {
        label: p.label,
        filename: p.filename,
        startSector: p.startSector,
        numSectors: p.numSectors,
        sizeBytes: p.numSectors * sectorSize,
        sizeInKb: p.sizeInKb || undefined,
        lun: 0, // iMoo eMMC 单 LUN,physical_partition_number 都是 0
        sectorSize,
      };
    });
  }

  /** 获取单个分区信息(含是否关键分区) */
  async getPartitionInfo(innermodel: string, label: string): Promise<{
    partition: EdlPartition;
    isCritical: boolean;
  } | null> {
    const partitions = await this.listPartitions(innermodel);
    const partition = partitions.find((p) => p.label === label);
    if (!partition) return null;
    return {
      partition,
      isCritical: CRITICAL_PARTITIONS.includes(label),
    };
  }

  /** 判断分区是否关键 */
  isCritical(label: string): boolean {
    return CRITICAL_PARTITIONS.includes(label);
  }

  /** 获取操作历史(会话级,最近 50 条) */
  getHistory(): EdlOperationRecord[] {
    return [...this.operationHistory].reverse(); // 最新的在前
  }

  /** 清空操作历史 */
  clearHistory(): void {
    this.operationHistory = [];
  }

  /** 记录操作 */
  private recordOperation(opts: {
    type: EdlOperationRecord['type'];
    innermodel: string;
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
    // 保留最近 50 条
    if (this.operationHistory.length > 50) {
      this.operationHistory.shift();
    }
  }

  // ========== 单分区操作(需 9008 设备) ==========

  /**
   * 备份单个分区
   * 生成只含该分区的 XML(filename=输出文件名)→ fh_loader --convertprogram2read
   */
  async backupPartition(opts: {
    innermodel: string;
    label: string;
    outputFile: string;
    v3: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { innermodel, label, outputFile, v3, onProgress } = opts;
    const start = Date.now();
    try {
      const target = await this.findPartition(innermodel, label);
      const workDir = this.ensureWorkDir();

      // 输出目录
      const outputDir = path.dirname(outputFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const outputName = path.basename(outputFile);

      // 生成单分区 XML(filename = 输出文件名,fh_loader --convertprogram2read 会用这个名字)
      const xmlPath = this.generateSinglePartitionXml({
        partition: target,
        filename: outputName,
        workDir,
      });

      // 找 9008 + 加载 firehose
      const { port, loader } = await this.prepareEdl({ innermodel, v3, onProgress });

      // fh_loader --convertprogram2read(备份)
      // 输出文件会生成在 outputDir/<outputName>
      onProgress?.(`正在备份分区: ${label} (${this.formatSize(target.sizeBytes)})`);
      await this.edlService.readPartitions({
        port,
        loader,
        xmlPath,
        outputDir,
      });

      // fh_loader 可能把文件输出到 bin/ 目录,需要复制到 outputDir(跟 backup9008 同样的安全网)
      const binOutput = paths.binFile(outputName);
      const finalOutput = path.join(outputDir, outputName);
      if (fs.existsSync(binOutput) && !fs.existsSync(finalOutput)) {
        fs.copyFileSync(binOutput, finalOutput);
      }

      // 校验输出文件大小(应为 numSectors * sectorSize)
      if (fs.existsSync(finalOutput)) {
        const actualSize = fs.statSync(finalOutput).size;
        if (actualSize !== target.sizeBytes) {
          logger.warn(`备份文件大小不匹配: 期望 ${target.sizeBytes}, 实际 ${actualSize}`);
          onProgress?.(`警告: 备份大小 ${this.formatSize(actualSize)}, 期望 ${this.formatSize(target.sizeBytes)}`);
        }
      }

      // 清理临时 XML + bin/ 下的临时 img
      this.cleanupTemp(xmlPath);
      try {
        if (fs.existsSync(binOutput)) fs.unlinkSync(binOutput);
      } catch {
        // ignore
      }

      const msg = `备份完成: ${finalOutput}`;
      onProgress?.(msg);
      this.recordOperation({
        type: 'backup',
        innermodel,
        label,
        success: true,
        message: msg,
        durationMs: Date.now() - start,
      });
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`备份分区 ${label} 失败: ${msg}`);
      this.recordOperation({
        type: 'backup',
        innermodel,
        label,
        success: false,
        message: msg,
        durationMs: Date.now() - start,
      });
      return { success: false, error: msg };
    }
  }

  /**
   * 恢复单个分区
   * 生成只含该分区的 XML(filename=输入文件名)→ fh_loader --sendxml
   * 安全:校验文件大小不超过分区大小 + 可选恢复前备份 + 可选恢复后读回校验
   */
  async restorePartition(opts: {
    innermodel: string;
    label: string;
    inputFile: string;
    v3: boolean;
    /** 恢复前先备份当前分区(默认 true) */
    backupBeforeRestore?: boolean;
    /** 备份输出目录(backupBeforeRestore=true 时必需) */
    backupOutputDir?: string;
    /** 恢复后读回校验(默认 false,耗时) */
    verifyAfterRestore?: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<{ success: boolean; error?: string; backupPath?: string; verified?: VerifyResult }> {
    const {
      innermodel,
      label,
      inputFile,
      v3,
      backupBeforeRestore = true,
      backupOutputDir,
      verifyAfterRestore = false,
      onProgress,
    } = opts;
    const start = Date.now();
    let backupPath: string | undefined;
    let verified: VerifyResult | undefined;

    try {
      if (!fs.existsSync(inputFile)) {
        throw new Error(`输入文件不存在: ${inputFile}`);
      }
      const target = await this.findPartition(innermodel, label);
      const fileSize = fs.statSync(inputFile).size;

      // 文件大小校验:不能超过分区大小
      if (fileSize > target.sizeBytes) {
        throw new Error(
          `镜像文件大小(${this.formatSize(fileSize)})超过分区大小(${this.formatSize(target.sizeBytes)})`,
        );
      }
      // 文件小于分区时提示(不阻止,fh_loader 会处理剩余空间)
      if (fileSize < target.sizeBytes) {
        onProgress?.(`提示: 镜像 ${this.formatSize(fileSize)} 小于分区 ${this.formatSize(target.sizeBytes)},剩余空间保持不变`);
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
          innermodel,
          label,
          outputFile: backupPath,
          v3,
          onProgress,
        });
        if (!backupRes.success) {
          throw new Error(`恢复前备份失败: ${backupRes.error}(已中止恢复以防数据丢失)`);
        }
      }

      const workDir = this.ensureWorkDir();

      // 复制输入文件到 workDir(fh_loader --search_path 从这里读)
      const inputName = path.basename(inputFile);
      const workInput = path.join(workDir, inputName);
      fs.copyFileSync(inputFile, workInput);

      // 生成单分区 XML(filename = 输入文件名)
      const xmlPath = this.generateSinglePartitionXml({
        partition: target,
        filename: inputName,
        workDir,
      });

      const { port, loader } = await this.prepareEdl({ innermodel, v3, onProgress });

      onProgress?.(`正在恢复分区: ${label} (${this.formatSize(fileSize)})`);
      await this.edlService.flashPartitions({
        port,
        loader,
        xmlPath,
        imagesDir: workDir,
      });

      // 清理
      this.cleanupTemp(xmlPath);
      try { fs.unlinkSync(workInput); } catch { /* ignore */ }

      // 恢复后读回校验
      if (verifyAfterRestore) {
        onProgress?.('恢复后读回校验...');
        verified = await this.verifyPartition({
          innermodel,
          label,
          expectedFile: inputFile,
          v3,
          onProgress,
        });
        if (verified.matched) {
          onProgress?.('校验通过: 读回数据与镜像一致');
        } else {
          onProgress?.(`校验未通过: ${verified.error ?? '数据不一致'}`);
        }
      }

      const msg = `恢复完成: ${label}`;
      onProgress?.(msg);
      this.recordOperation({
        type: 'restore',
        innermodel,
        label,
        success: true,
        message: msg + (backupPath ? `(已备份原数据)` : ''),
        durationMs: Date.now() - start,
      });
      return { success: true, backupPath, verified };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`恢复分区 ${label} 失败: ${msg}`);
      this.recordOperation({
        type: 'restore',
        innermodel,
        label,
        success: false,
        message: msg,
        durationMs: Date.now() - start,
      });
      return { success: false, error: msg, backupPath, verified };
    }
  }

  /**
   * 校验分区:读回分区数据与本地文件比对
   * 用于恢复后验证写入是否正确
   */
  async verifyPartition(opts: {
    innermodel: string;
    label: string;
    expectedFile: string;
    v3: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<VerifyResult> {
    const { innermodel, label, expectedFile, v3, onProgress } = opts;
    try {
      if (!fs.existsSync(expectedFile)) {
        return { success: false, matched: false, bytesRead: 0, bytesExpected: 0, error: '预期文件不存在' };
      }
      const expectedSize = fs.statSync(expectedFile).size;
      const target = await this.findPartition(innermodel, label);
      const workDir = this.ensureWorkDir();

      // 读回分区到临时文件
      const readBackName = `verify_${label}.img`;
      const readBackPath = path.join(workDir, readBackName);
      const xmlPath = this.generateSinglePartitionXml({
        partition: target,
        filename: readBackName,
        workDir,
      });

      const { port, loader } = await this.prepareEdl({ innermodel, v3, onProgress });
      onProgress?.(`读回分区 ${label} 进行校验...`);
      await this.edlService.readPartitions({
        port,
        loader,
        xmlPath,
        outputDir: workDir,
      });

      // fh_loader 可能输出到 bin/,安全网复制
      const binOutput = paths.binFile(readBackName);
      if (fs.existsSync(binOutput) && !fs.existsSync(readBackPath)) {
        fs.copyFileSync(binOutput, readBackPath);
      }

      if (!fs.existsSync(readBackPath)) {
        this.cleanupTemp(xmlPath);
        return { success: false, matched: false, bytesRead: 0, bytesExpected: expectedSize, error: '读回失败' };
      }

      const actualSize = fs.statSync(readBackPath).size;
      const bytesToCompare = Math.min(actualSize, expectedSize);
      let matched = actualSize === expectedSize;

      if (matched) {
        // 逐字节比对(分块,避免内存爆)
        const expectedFd = fs.openSync(expectedFile, 'r');
        const actualFd = fs.openSync(readBackPath, 'r');
        const bufSize = 4 * 1024 * 1024; // 4MB
        const buf1 = Buffer.alloc(bufSize);
        const buf2 = Buffer.alloc(bufSize);
        let offset = 0;
        while (offset < bytesToCompare) {
          const toRead = Math.min(bufSize, bytesToCompare - offset);
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

      // 清理
      this.cleanupTemp(xmlPath);
      try { fs.unlinkSync(readBackPath); } catch { /* ignore */ }
      try { if (fs.existsSync(binOutput)) fs.unlinkSync(binOutput); } catch { /* ignore */ }

      this.recordOperation({
        type: 'verify',
        innermodel,
        label,
        success: true,
        message: matched ? '校验通过' : '数据不一致',
        durationMs: 0,
      });

      return { success: true, matched, bytesRead: actualSize, bytesExpected: expectedSize };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`校验分区 ${label} 失败: ${msg}`);
      return { success: false, matched: false, bytesRead: 0, bytesExpected: 0, error: msg };
    }
  }

  /**
   * 擦除单个分区
   * 生成全零镜像 → fh_loader --sendxml(比 filename="" 更可靠)
   * 优化:大分区分块生成 + 进度回调
   */
  async erasePartition(opts: {
    innermodel: string;
    label: string;
    v3: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { innermodel, label, v3, onProgress } = opts;
    const start = Date.now();
    try {
      const target = await this.findPartition(innermodel, label);
      const workDir = this.ensureWorkDir();

      // 生成全零镜像(比 filename="" 更可靠,fh_loader 一定能处理)
      const zeroName = `zero_${label}.img`;
      const zeroPath = path.join(workDir, zeroName);
      onProgress?.(`生成擦除镜像(${this.formatSize(target.sizeBytes)})...`);
      // 写全零文件(numSectors * sectorSize 字节),分块 + 进度
      const fd = fs.openSync(zeroPath, 'w');
      try {
        const bufSize = 4 * 1024 * 1024; // 4MB 块(大分区更快)
        const buf = Buffer.alloc(bufSize, 0);
        let written = 0;
        const total = target.sizeBytes;
        const progressInterval = Math.max(bufSize, Math.floor(total / 20)); // 约 20 次进度
        let lastProgressAt = 0;
        while (written < total) {
          const toWrite = Math.min(buf.length, total - written);
          fs.writeSync(fd, buf, 0, toWrite, null);
          written += toWrite;
          if (written - lastProgressAt >= progressInterval || written >= total) {
            const pct = Math.floor((written / total) * 100);
            onProgress?.(`生成擦除镜像: ${pct}% (${this.formatSize(written)}/${this.formatSize(total)})`);
            lastProgressAt = written;
          }
        }
      } finally {
        fs.closeSync(fd);
      }

      const xmlPath = this.generateSinglePartitionXml({
        partition: target,
        filename: zeroName,
        workDir,
      });

      const { port, loader } = await this.prepareEdl({ innermodel, v3, onProgress });

      onProgress?.(`正在擦除分区: ${label}(写入全零数据)`);
      await this.edlService.flashPartitions({
        port,
        loader,
        xmlPath,
        imagesDir: workDir,
      });

      // 清理
      this.cleanupTemp(xmlPath);
      try { fs.unlinkSync(zeroPath); } catch { /* ignore */ }

      const msg = `擦除完成: ${label}`;
      onProgress?.(msg);
      this.recordOperation({
        type: 'erase',
        innermodel,
        label,
        success: true,
        message: msg,
        durationMs: Date.now() - start,
      });
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`擦除分区 ${label} 失败: ${msg}`);
      this.recordOperation({
        type: 'erase',
        innermodel,
        label,
        success: false,
        message: msg,
        durationMs: Date.now() - start,
      });
      return { success: false, error: msg };
    }
  }

  /** 重启设备(回系统) */
  async resetDevice(opts: {
    innermodel: string;
    v3: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<{ success: boolean; error?: string }> {
    const { innermodel, v3, onProgress } = opts;
    const start = Date.now();
    try {
      const { port, loader } = await this.prepareEdl({ innermodel, v3, onProgress });
      onProgress?.('正在重启设备...');
      await this.edlService.reboot({ port, loader });
      onProgress?.('重启指令已发送');
      this.recordOperation({
        type: 'reset',
        innermodel,
        label: '-',
        success: true,
        message: '重启指令已发送',
        durationMs: Date.now() - start,
      });
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`重启失败: ${msg}`);
      this.recordOperation({
        type: 'reset',
        innermodel,
        label: '-',
        success: false,
        message: msg,
        durationMs: Date.now() - start,
      });
      return { success: false, error: msg };
    }
  }

  /** 检查设备是否在 9008 模式 */
  async checkEdlDevice(): Promise<{ inEdl: boolean; port?: string }> {
    const device = DeviceService.instance.current();
    if (device?.type === 'qcom_edl') {
      return { inEdl: true, port: device.port };
    }
    // 主动找端口
    const port = await this.edlService.findPort();
    return { inEdl: !!port, port: port ?? undefined };
  }

  // ========== 内部 ==========

  /** 根据型号 + v3 选 loader */
  private selectLoader(innermodel: string, v3: boolean): EdlOptions['loader'] {
    // ND 系列(Z10)用 prog_firehose_ddr.elf
    if (innermodel.startsWith('ND')) {
      return 'prog_firehose_ddr.elf';
    }
    // V3 机型用 msm8937.mbn,非 V3 用 msm8909w.mbn
    return v3 ? 'msm8937.mbn' : 'msm8909w.mbn';
  }

  /** 找分区(从 allxml 解析) */
  private async findPartition(innermodel: string, label: string): Promise<EdlPartition> {
    const partitions = await this.listPartitions(innermodel);
    const target = partitions.find((p) => p.label === label);
    if (!target) {
      throw new Error(`分区 "${label}" 不存在于 ${innermodel}.xml`);
    }
    return target;
  }

  /** 确保工作目录存在 */
  private ensureWorkDir(): string {
    const workDir = paths.edlWork;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    return workDir;
  }

  /** 生成单分区 XML(临时文件) */
  private generateSinglePartitionXml(opts: {
    partition: EdlPartition;
    filename: string;
    workDir: string;
  }): string {
    const p = opts.partition;
    const xml = `<?xml version="1.0" ?>
<data>
<program SECTOR_SIZE_IN_BYTES="${p.sectorSize}" file_sector_offset="0" filename="${opts.filename}" label="${p.label}" num_partition_sectors="${p.numSectors}" physical_partition_number="${p.lun}" sparse="false" start_sector="${p.startSector}" />
</data>`;
    const xmlPath = path.join(opts.workDir, `single_${p.label}.xml`);
    fs.writeFileSync(xmlPath, xml, 'utf-8');
    return xmlPath;
  }

  /** 找 9008 端口 + 加载 firehose */
  private async prepareEdl(opts: {
    innermodel: string;
    v3: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<{ port: string; loader: EdlOptions['loader'] }> {
    const loader = this.selectLoader(opts.innermodel, opts.v3);

    // 先检查当前设备
    const check = await this.checkEdlDevice();
    let port = check.port;

    if (!port) {
      // 等待 9008 设备出现
      opts.onProgress?.('等待 9008 设备...');
      port = await this.edlService.waitForEdl(60000);
    }

    // 加载 firehose
    opts.onProgress?.(`加载引导: ${loader}`);
    await this.edlService.loadFirehose({ port, loader });

    // 等待 firehose 就绪(对应原 .bat 的 sleep 2)
    await new Promise((r) => setTimeout(r, 2000));

    return { port, loader };
  }

  /** 清理临时 XML */
  private cleanupTemp(xmlPath: string): void {
    try {
      if (fs.existsSync(xmlPath)) fs.unlinkSync(xmlPath);
    } catch {
      // ignore
    }
  }

  /** 格式化字节 */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
}

export const EdlPartitionService = new EdlPartitionServiceClass();
