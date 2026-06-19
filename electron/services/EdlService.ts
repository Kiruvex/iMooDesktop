// electron/services/EdlService.ts - 9008 EDL 刷机封装
// 见 plan.md 6.5 EdlService
// 对应原 edlport.bat / QSaharaServer.bat / fh_loader.bat / qfh_loader.bat
// qfh_loader 已合并到 fh_loader(见 plan.md 核心约束 fh_loader/qfh_loader 合并)
// 错误处理语义保留分离:flash 失败=重试,reboot 失败=跳过

import { SubprocessPool, SpawnError } from './SubprocessPool';
import { AdbService } from './AdbService';
import { DeviceService } from './DeviceService';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import fs from 'node:fs';
import path from 'node:path';

const logger = Logger.instance.child('EdlService');

export interface EdlOptions {
  /** COM 端口,如 "COM5" */
  port: string;
  /** firehose 加载器 */
  loader: 'msm8909w.mbn' | 'msm8937.mbn' | 'prog_firehose_ddr.elf';
  /** 任务 ID(用于取消) */
  taskId?: string;
}

export interface Partition {
  label: string;
  filename: string;
  startSector: number;
  numSectors: number;
  sizeInKb: number;
}

class EdlServiceClass {
  private fhLoaderPath = paths.binFile('fh_loader.exe');
  private qsaharaPath = paths.binFile('QSaharaServer.exe');

  /**
   * 加载 firehose(初始化 9008 通信)
   * 对应 QSaharaServer.bat:QSaharaServer.exe -p \\.\COMn -s 13:<loader>
   * 失败=致命,抛错(调用方决定是否重试)
   */
  async loadFirehose(opts: EdlOptions): Promise<void> {
    const loaderPath = paths.edlFile(opts.loader);
    if (!fs.existsSync(loaderPath)) {
      throw new Error(`firehose loader 不存在: ${opts.loader}`);
    }
    // 原 QSaharaServer.bat:2:QSaharaServer.exe %* >QStmp.txt || goto error
    // 失败时读 QStmp.txt 日志,写 logs/QSerror_<nutime>.txt
    try {
      await SubprocessPool.spawn({
        cmd: this.qsaharaPath,
        args: ['-p', `\\\\.\\${opts.port}`, '-s', `13:${loaderPath}`],
        encoding: 'gbk',
        timeout: 60000,
        cwd: paths.bin,
        onStdout: (line) => logger.info(`QSaharaServer: ${line}`),
        onStderr: (line) => logger.warn(`QSaharaServer stderr: ${line}`),
      });
      logger.info(`firehose 加载成功: ${opts.loader}`);
    } catch (e) {
      const err = e as SpawnError;
      logger.error(`firehose 加载失败: ${err.message}`, err.stderr);
      throw new Error(`firehose 加载失败: ${err.message}`);
    }
  }

  /**
   * 按分区表 XML 刷入(写)
   * 对应 fh_loader.bat:fh_loader.exe --port=... --memoryname=EMMC --search_path=... --sendxml=... --noprompt
   * 失败=致命,死循环重试(对应原 fh_loader.bat 的 goto run)
   */
  async flashPartitions(
    opts: EdlOptions & { xmlPath: string; imagesDir: string },
  ): Promise<void> {
    const { port, xmlPath, imagesDir } = opts;
    // 原 fh_loader.bat:2:fh_loader.exe %* >FHtmp.txt || goto error
    // 失败时写 logs/FHerror_<nutime>.txt,UI 提示重试
    try {
      await SubprocessPool.spawn({
        cmd: this.fhLoaderPath,
        args: [
          `--port=\\\\.\\${port}`,
          '--memoryname=EMMC',
          `--search_path=${imagesDir}`,
          `--sendxml=${xmlPath}`,
          '--noprompt',
        ],
        encoding: 'gbk',
        timeout: 300000,
        cwd: paths.bin,
        onStdout: (line) => logger.info(`fh_loader: ${line}`),
        onStderr: (line) => logger.warn(`fh_loader stderr: ${line}`),
      });
      logger.info(`分区刷入成功: ${xmlPath}`);
    } catch (e) {
      const err = e as SpawnError;
      logger.error(`分区刷入失败: ${err.message}`, err.stderr);
      throw new Error(`分区刷入失败: ${err.message}`);
    }
  }

  /**
   * 按分区表 XML 读取(备份)
   * 对应 fh_loader.exe --convertprogram2read
   */
  async readPartitions(
    opts: EdlOptions & { xmlPath: string; outputDir: string },
  ): Promise<void> {
    const { port, xmlPath, outputDir } = opts;
    try {
      await SubprocessPool.spawn({
        cmd: this.fhLoaderPath,
        args: [
          `--port=\\\\.\\${port}`,
          '--memoryname=EMMC',
          `--search_path=${outputDir}`,
          `--sendxml=${xmlPath}`,
          '--convertprogram2read',
          '--noprompt',
        ],
        encoding: 'gbk',
        timeout: 600000,
        cwd: paths.bin,
        onStdout: (line) => logger.info(`fh_loader read: ${line}`),
      });
      logger.info(`分区读取成功: ${xmlPath}`);
    } catch (e) {
      const err = e as SpawnError;
      logger.error(`分区读取失败: ${err.message}`, err.stderr);
      throw new Error(`分区读取失败: ${err.message}`);
    }
  }

  /**
   * 重启设备
   * 对应原 qfh_loader.bat:qfh_loader.exe --sendxml=reboot.xml
   * 已合并到 fh_loader.exe(见 plan.md 核心约束)
   * 失败=非致命,跳过 + 提示手动按电源键(对应原 qfh_loader.bat 的语义)
   */
  async reboot(opts: EdlOptions): Promise<void> {
    const rebootXml = paths.edlFile('reboot.xml');
    try {
      await SubprocessPool.spawn({
        cmd: this.fhLoaderPath,
        args: [
          `--port=\\\\.\\${opts.port}`,
          '--memoryname=EMMC',
          `--search_path=${paths.edl}`,
          '--sendxml=reboot.xml',
          '--noprompt',
        ],
        encoding: 'gbk',
        timeout: 30000,
        cwd: paths.bin,
        onStdout: (line) => logger.info(`reboot: ${line}`),
      });
      logger.info('设备重启指令已发送');
    } catch (e) {
      // 失败=跳过,不抛错(对应原 qfh_loader.bat 的"已跳过"语义)
      logger.warn(`9008重启失败!已跳过,可能需要手动按10秒电源键重启: ${(e as Error).message}`);
    }
  }

  /**
   * 找 9008 COM 端口
   * 对应原 edlport.bat:lsusb | find "Qualcomm HS-USB QDLoader 9008"
   * 解析括号里的 COMn
   */
  async findPort(): Promise<string | null> {
    const lsusbPath = paths.binFile('lsusb.exe');
    try {
      const result = await SubprocessPool.spawn({
        cmd: lsusbPath,
        args: [],
        encoding: 'utf-8',
        timeout: 5000,
        cwd: paths.bin,
        silent: true,
      });
      for (const line of result.stdout.split('\n')) {
        if (line.includes('Qualcomm HS-USB QDLoader 9008')) {
          // 格式:Bus xxx Device xxx: ID 05c6:9008 ... (Qualcomm HS-USB QDLoader 9008) COM5
          const portMatch = line.match(/COM(\d+)/i);
          if (portMatch) {
            return `COM${portMatch[1]}`;
          }
        }
      }
    } catch {
      // 静默
    }
    return null;
  }

  /**
   * 等待 9008 设备出现(轮询,带超时)
   * 对应原 edlport.bat 的循环检测
   */
  async waitForEdl(timeout = 120000): Promise<string> {
    const start = Date.now();
    logger.info(`等待 9008 设备(超时 ${timeout}ms)`);
    while (Date.now() - start < timeout) {
      const port = await this.findPort();
      if (port) {
        logger.info(`检测到 9008 设备: ${port}`);
        return port;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('等待 9008 设备超时');
  }

  /**
   * 解析 allxml,返回分区清单
   */
  parseAllXml(xmlPath: string): Partition[] {
    try {
      const content = fs.readFileSync(xmlPath, 'utf-8');
      const partitions: Partition[] = [];
      // 简单正则解析 <program .../> 标签
      const re = /<program\s+([^/]+)\/>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const attrs = m[1];
        const get = (name: string): string | undefined => {
          const am = attrs.match(new RegExp(`${name}="([^"]+)"`));
          return am?.[1];
        };
        partitions.push({
          label: get('label') ?? '',
          filename: get('filename') ?? '',
          startSector: Number(get('start_sector') ?? 0),
          numSectors: Number(get('num_partition_sectors') ?? 0),
          sizeInKb: Number(get('size_in_KB') ?? 0),
        });
      }
      return partitions;
    } catch (e) {
      logger.error(`解析 XML 失败: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 刷入 misc 分区(写 misc img 让设备进入 qmmi/ffbm/wipe/fastbootd)
   * 对应 rebootpro.bat :flash_device 函数
   * 参数:mode = qmmi/ffbm/wipe/fastbootd, platform = z10/otherpash/v3pash, innermodel
   */
  async flashMisc(opts: {
    port: string;
    mode: 'qmmi' | 'ffbm' | 'wipe' | 'fastbootd';
    platform: 'z10' | 'otherpash' | 'v3pash';
    innermodel: string;
  }): Promise<void> {
    const { port, mode, platform, innermodel } = opts;

    // 对应 rebootpro.bat:275-293:根据 platform 选 loader/misc_xml/misc_img/img_ext
    let loader: EdlOptions['loader'];
    let miscXml: string;
    let miscImg: string;
    let imgExt: string;

    if (platform === 'z10') {
      loader = 'prog_firehose_ddr.elf';
      miscXml = 'misc_ND03.xml';
      miscImg = 'misc.img';
      imgExt = 'img';
    } else if (platform === 'otherpash') {
      loader = 'msm8909w.mbn';
      miscXml = `misc_${innermodel}.xml`;
      miscImg = 'misc.mbn';
      imgExt = 'mbn';
    } else {
      // v3pash
      loader = 'msm8937.mbn';
      miscXml = `misc_${innermodel}.xml`;
      miscImg = 'misc.img';
      imgExt = 'img';
    }

    // 对应 rebootpro.bat:296-304:根据 mode 选镜像文件
    let imageSrc: string;
    if (mode === 'ffbm') {
      imageSrc = 'ffbm.img';
    } else if (mode === 'wipe') {
      imageSrc = 'wipe.img';
    } else if (mode === 'fastbootd') {
      imageSrc = 'fastbootd.img';
    } else {
      // qmmi
      imageSrc = 'misc.img';
    }

    // 对应 rebootpro.bat:311-313:复制文件到工作目录
    const workDir = paths.edlWork;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    const srcXml = paths.edlMiscFile(miscXml);
    const srcImg = paths.edlMiscFile(imageSrc);
    const dstXml = path.join(workDir, 'misc.xml');
    const dstImg = path.join(workDir, `misc.${imgExt}`);
    fs.copyFileSync(srcXml, dstXml);
    fs.copyFileSync(srcImg, dstImg);

    // 对应 rebootpro.bat:316-317:加载 firehose
    await this.loadFirehose({ port, loader });

    // 对应 rebootpro.bat:320-321:刷入 misc
    await this.flashPartitions({ port, loader, xmlPath: dstXml, imagesDir: workDir });

    // 对应 rebootpro.bat:323-324:重启
    await this.reboot({ port, loader });

    // 对应 rebootpro.bat:327-328:清理工作目录
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  // ========== 9008 备份(对应 backup.bat :9008-backup-run) ==========

  /**
   * 9008 EDL 备份:读取所有分区 → 7z 打包
   * 对应 backup.bat:9008-backup-run
   * 参数:innermodel(型号), v3(是否 V3 协议,决定用哪个 loader)
   */
  async backup9008(opts: {
    innermodel: string;
    v3: boolean;
    outputDir: string;
    onProgress?: (msg: string) => void;
  }): Promise<string> {
    const { innermodel, v3, outputDir, onProgress } = opts;
    const loader: EdlOptions['loader'] = v3 ? 'msm8937.mbn' : 'msm8909w.mbn';
    const allxml = paths.edlAllxmlFile(`${innermodel}.xml`);

    if (!fs.existsSync(allxml)) {
      throw new Error(`分区表不存在: ${innermodel}.xml`);
    }

    // 备份目录(对应 backup.bat:backupname=EDL_<innermodel>_<date>_<time>)
    const now = new Date();
    const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const t = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const backupName = `EDL_${innermodel}_${d}_${t}`;
    const backupDir = path.join(outputDir, backupName);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // 找 9008 端口
    onProgress?.('等待 9008 设备...');
    const port = await this.waitForEdl(60000);

    // 发送引导(对应:QSaharaServer -s 13:<loader>)
    onProgress?.(`发送引导: ${loader}`);
    await this.loadFirehose({ port, loader });

    // 对应原 .bat:busybox sleep 2(等待 firehose 就绪)
    await new Promise((r) => setTimeout(r, 2000));

    // 读取分区(对应:fh_loader --sendxml=allxml/<innermodel>.xml --convertprogram2read --mainoutputdir=<backupDir>)
    onProgress?.('正在备份分区...');
    await SubprocessPool.spawn({
      cmd: this.fhLoaderPath,
      args: [
        `--port=\\\\.\\${port}`,
        '--memoryname=EMMC',
        `--sendxml=${allxml}`,
        '--convertprogram2read',
        '--noprompt',
        `--mainoutputdir=${backupDir}\\`,
      ],
      encoding: 'gbk',
      timeout: 600000,
      cwd: paths.bin,
      onStdout: (line) => onProgress?.(line),
    });

    // 重启(对应:qfh_loader reboot.xml → 合并到 fh_loader)
    onProgress?.('重启设备...');
    await this.reboot({ port, loader });

    // 构建属性文件(对应:copy .img + v3.txt + rawprogram0.xml)
    onProgress?.('构建备份文件...');
    // 对应原 .bat:copy /y .\*.img .\backup\%backupname%\
    // 安全网:fh_loader 可能输出 .img 到 bin/ 目录(而非 mainoutputdir),复制到备份目录
    try {
      const binImgs = fs.readdirSync(paths.bin).filter((f) => f.endsWith('.img'));
      for (const img of binImgs) {
        const src = path.join(paths.bin, img);
        const dst = path.join(backupDir, img);
        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
        }
      }
    } catch {
      // ignore
    }
    // 复制 allxml 为 rawprogram0.xml
    fs.copyFileSync(allxml, path.join(backupDir, 'rawprogram0.xml'));
    // 写 v3.txt
    fs.writeFileSync(path.join(backupDir, 'v3.txt'), v3 ? '1' : '0', 'utf-8');

    // 压缩(对应:7z a -tzip backupName.zip backupDir/)
    onProgress?.('压缩备份文件...');
    const zipPath = path.join(outputDir, `${backupName}.zip`);
    await SubprocessPool.spawn({
      cmd: paths.binFile('7z.exe'),
      args: ['a', '-tzip', '-y', zipPath, `${backupDir}\\`],
      encoding: 'utf-8',
      timeout: 300000,
      cwd: paths.bin,
      onStdout: (line) => onProgress?.(line),
    });

    // 清理临时目录(对应:rd /Q /S backupDir)
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    onProgress?.(`备份完成: ${zipPath}`);
    return zipPath;
  }

  // ========== 9008 恢复(对应 backup.bat :9008-recover) ==========

  /**
   * 9008 EDL 恢复:从 zip 解压 → 读 v3.txt 选 loader → fh_loader 刷 rawprogram0.xml
   * 对应 backup.bat:9008-recover
   */
  async recover9008(opts: { zipPath: string; onProgress?: (msg: string) => void }): Promise<void> {
    const { zipPath, onProgress } = opts;

    // 解压(对应:7z x tmp.zip -o backup/tmp/)
    onProgress?.('解压备份文件...');
    const tmpDir = path.join(paths.resources, 'backup', 'tmp');
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
    await SubprocessPool.spawn({
      cmd: paths.binFile('7z.exe'),
      args: ['x', zipPath, `-o${tmpDir}`, '-aoa'],
      encoding: 'utf-8',
      timeout: 120000,
      cwd: paths.bin,
    });

    // 找解压后的目录(对应:backup/tmp/<backupname>/)
    const entries = fs.readdirSync(tmpDir);
    const backupSubdir = entries.find((e) => fs.statSync(path.join(tmpDir, e)).isDirectory());
    if (!backupSubdir) {
      throw new Error('备份文件中没有找到备份目录');
    }
    const backupDir = path.join(tmpDir, backupSubdir);

    // 读 v3.txt(对应:set /p v3=<.\backup\tmp\<backupname>\v3.txt)
    const v3Path = path.join(backupDir, 'v3.txt');
    let v3 = false;
    try {
      const v3Content = fs.readFileSync(v3Path, 'utf-8').trim();
      v3 = v3Content === '1';
    } catch {
      // 文件不存在,默认 false
    }

    // 选 loader(对应:v3=1 → msm8937.mbn,v3=0 → msm8909w.mbn)
    const loader: EdlOptions['loader'] = v3 ? 'msm8937.mbn' : 'msm8909w.mbn';

    // 找 9008 端口
    onProgress?.('等待 9008 设备...');
    const port = await this.waitForEdl(60000);

    // 发送引导
    onProgress?.(`发送引导: ${loader}`);
    await this.loadFirehose({ port, loader });

    // 对应原 .bat:busybox sleep 2(等待 firehose 就绪)
    await new Promise((r) => setTimeout(r, 2000));

    // 刷入 rawprogram0.xml(对应:fh_loader --sendxml=rawprogram0.xml)
    const rawprogramXml = path.join(backupDir, 'rawprogram0.xml');
    if (!fs.existsSync(rawprogramXml)) {
      throw new Error('备份文件中没有找到 rawprogram0.xml');
    }
    onProgress?.('正在恢复...');
    await this.flashPartitions({ port, loader, xmlPath: rawprogramXml, imagesDir: backupDir });

    // 重启
    onProgress?.('重启设备...');
    await this.reboot({ port, loader });

    // 清理(对应:rd /Q /S backup/tmp)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    onProgress?.('恢复完成');
  }

  // ========== 超级恢复(对应 super_recovery.bat) ==========

  /**
   * 超级恢复:选固件目录 → 自动检测 loader → 逐个刷 rawprogram0/1/2.xml + patch0.xml
   * 对应 super_recovery.bat
   */
  async superRecovery(opts: { folder: string; onProgress?: (msg: string) => void }): Promise<void> {
    const { folder, onProgress } = opts;

    // 自动检测 loader(对应 super_recovery.bat:39-53)
    let loader: EdlOptions['loader'] | null = null;
    if (fs.existsSync(path.join(folder, 'prog_firehose_ddr.elf'))) {
      loader = 'prog_firehose_ddr.elf';
    }
    // 检查目录里是否有含 8937 的文件
    const files = fs.readdirSync(folder);
    if (!loader && files.some((f) => f.includes('8937'))) {
      loader = 'msm8937.mbn';
    }
    if (!loader && files.some((f) => f.includes('8909'))) {
      loader = 'msm8909w.mbn';
    }
    if (!loader) {
      throw new Error('选择的目录没有引导文件');
    }

    // 检查 rawprogram 文件(对应:判断 rec_1 还是 rec_0)
    const hasRawprogram1 = fs.existsSync(path.join(folder, 'rawprogram1.xml'));
    const hasRawprogram2 = fs.existsSync(path.join(folder, 'rawprogram2.xml'));
    const hasRawprogram0 = fs.existsSync(path.join(folder, 'rawprogram0.xml'));

    if (!hasRawprogram0) {
      throw new Error('选择的目录没有可刷录入的 xml');
    }

    // 找 9008 端口
    onProgress?.('等待 9008 设备...');
    const port = await this.waitForEdl(60000);

    // 发送引导
    onProgress?.(`发送引导: ${loader}`);
    await this.loadFirehose({ port, loader });

    // 对应原 .bat:busybox sleep 2(等待 firehose 就绪)
    await new Promise((r) => setTimeout(r, 2000));

    // 刷入(对应:rec_1 分支刷 rawprogram0/1/2 + patch0;rec_0 分支只刷 rawprogram0)
    if (hasRawprogram1 && hasRawprogram2) {
      // rec_1 分支
      for (const xmlName of ['rawprogram0.xml', 'rawprogram1.xml', 'rawprogram2.xml']) {
        const xmlPath = path.join(folder, xmlName);
        if (fs.existsSync(xmlPath)) {
          onProgress?.(`刷入 ${xmlName}...`);
          await this.flashPartitions({ port, loader, xmlPath, imagesDir: folder });
        }
      }
      // patch0.xml
      const patchXml = path.join(folder, 'patch0.xml');
      if (fs.existsSync(patchXml)) {
        onProgress?.('刷入 patch0.xml...');
        await this.flashPartitions({ port, loader, xmlPath: patchXml, imagesDir: folder });
      }
    } else {
      // rec_0 分支
      onProgress?.('刷入 rawprogram0.xml...');
      await this.flashPartitions({
        port,
        loader,
        xmlPath: path.join(folder, 'rawprogram0.xml'),
        imagesDir: folder,
      });
    }

    // 重启
    onProgress?.('重启设备...');
    await this.reboot({ port, loader });

    onProgress?.('超级恢复完成');
  }

  // ========== 刷入 TWRP(对应 pashtwrp.bat) ==========

  /**
   * EDL 模式刷入 TWRP recovery
   * 对应 pashtwrp.bat
   */
  async flashTwrp(opts: {
    innermodel: string;
    onProgress?: (msg: string) => void;
  }): Promise<void> {
    const { innermodel, onProgress } = opts;
    const twrpDir = paths.edlFile('twrp');
    if (!fs.existsSync(twrpDir)) {
      throw new Error('TWRP 镜像未下载,请先在"资源下载"页下载 TWRP');
    }

    // 选 loader(对应 pashtwrp.bat:10-22:根据 innermodel 选 loader)
    // otherpash(I12/IB/I13C/I13/I19/I18)→ msm8909w.mbn
    // v3pash(I20/I25/I25C/I25D/I32/ND07/ND01)→ msm8937.mbn
    const otherpashModels = ['I12', 'IB', 'I13C', 'I13', 'I19', 'I18'];
    const loader: EdlOptions['loader'] = otherpashModels.includes(innermodel)
      ? 'msm8909w.mbn'
      : 'msm8937.mbn';

    // 复制文件到工作目录(对应:copy twrp/<innermodel>.xml + twrp/<innermodel>.img → EDL/rooting/)
    const twrpXml = path.join(twrpDir, `${innermodel}.xml`);
    const twrpImg = path.join(twrpDir, `${innermodel}.img`);
    if (!fs.existsSync(twrpImg)) {
      throw new Error(`TWRP 镜像不存在: ${innermodel}.img`);
    }
    const workDir = paths.edlWork;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    const dstXml = path.join(workDir, 'recovery.xml');
    const dstImg = path.join(workDir, 'recovery.img');
    if (fs.existsSync(twrpXml)) {
      fs.copyFileSync(twrpXml, dstXml);
    } else {
      throw new Error(`TWRP XML 不存在: ${innermodel}.xml`);
    }
    fs.copyFileSync(twrpImg, dstImg);

    // 对应原 pashtwrp.bat:35:busybox timeout 10 cmd /c adb reboot edl 2>nul 1>nul
    // 若设备在 ADB 模式,先尝试重启到 9008
    const device = DeviceService.instance.current();
    if (device?.type === 'adb') {
      onProgress?.('设备在 ADB 模式,重启至 9008...');
      try {
        await AdbService.reboot('edl');
      } catch {
        // 忽略失败,继续等 9008
      }
    }

    // 找 9008 端口
    onProgress?.('等待 9008 设备...');
    const port = await this.waitForEdl(60000);

    // 发送引导
    onProgress?.(`发送引导: ${loader}`);
    await this.loadFirehose({ port, loader });

    // 刷入 recovery(对应:fh_loader --sendxml=recovery.xml)
    onProgress?.('开始刷入 recovery...');
    await this.flashPartitions({ port, loader, xmlPath: dstXml, imagesDir: workDir });

    // 重启
    onProgress?.('重启设备...');
    await this.reboot({ port, loader });

    // 清理(对应:del /Q /F ".\EDL\rooting\*.*")
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });
    } catch {
      // ignore
    }

    onProgress?.('TWRP 刷入完成');
  }
}

export const EdlService = new EdlServiceClass();
