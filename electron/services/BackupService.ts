// electron/services/BackupService.ts - 备份恢复服务
// 见 plan.md 6.11 BackupService
// 对应原 backup.bat(DCIM + adb-dd)+ pashtwrppro.bat(开机自刷 TWRP)+ Xposed.bat
//
// 业务逻辑 1:1 复刻原 .bat(见 plan.md 核心约束"逻辑保真度"):
//   - DCIM 备份/恢复:adb pull/push /storage/emulated/0/DCIM
//   - adb-dd 备份:su -c ls /dev/block/bootdevice/by-name/ → 逐分区 dd if=... bs=4096 → 7z 打包
//   - adb-dd 恢复:7z 解压 → 匹配设备分区 → dd of=... bs=4096
//   - 开机自刷 TWRP(原 pashtwrppro.bat):push recovery.img + auto_flash_recovery.sh → cp 到 Magisk 服务目录
//   - Xposed 安装(原 Xposed.bat):SDK=19/SDK=25 两个分支
//
// 设备端 .sh 改名(见 plan.md 2.5.2):
//   - rec.sh → auto_flash_recovery.sh(源文件名改,目标路径 /data/adb/service.d/rec.sh 保留 Magisk 约定)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SubprocessPool, SpawnError } from './SubprocessPool';
import { AdbService } from './AdbService';
import { MagiskService } from './MagiskService';
import { Logger } from './Logger';
import { paths } from '../core/paths';

const logger = Logger.instance.child('BackupService');

/** 备份结果 */
export interface BackupResult {
  success: boolean;
  /** 生成的 zip 路径(backup 成功时) */
  zipPath?: string;
  error?: string;
}

/** adb-dd 恢复时的分区匹配结果(供 UI 显示并请求用户确认) */
export interface AdbDdMatchResult {
  /** 备份中包含、设备上也存在的分区(将被恢复) */
  matched: string[];
  /** 备份中包含、设备上不存在的分区(跳过) */
  skipped: string[];
}

class BackupServiceClass {
  private adbPath = paths.binFile('adb.exe');
  private sevenZipPath = paths.binFile('7z.exe');

  // ========== DCIM 备份/恢复(对应 backup.bat :DCIM-backup / :DCIM-recover) ==========

  /**
   * DCIM 备份
   * 对应 backup.bat:DCIM-backup
   * 原:adb pull /storage/emulated/0/DCIM "<sel__folder_path>"
   */
  async backupDcim(outputDir: string, onProgress?: (msg: string) => void): Promise<BackupResult> {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      onProgress?.('正在备份相册...');
      // 原:adb pull /storage/emulated/0/DCIM "%sel__folder_path%"
      await AdbService.pull('/storage/emulated/0/DCIM', outputDir);
      onProgress?.('备份成功');
      logger.info(`DCIM 备份成功: ${outputDir}`);
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      onProgress?.('备份失败');
      logger.error(`DCIM 备份失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * DCIM 恢复
   * 对应 backup.bat:DCIM-recover
   * 原:adb push "<sel__folder_path>\DCIM" /storage/emulated/0/
   */
  async recoverDcim(inputDir: string, onProgress?: (msg: string) => void): Promise<BackupResult> {
    try {
      onProgress?.('正在恢复相册...');
      // 原:adb push "<sel__folder_path>\DCIM" /storage/emulated/0/
      // inputDir 应是包含 DCIM 子目录的文件夹
      const dcimPath = path.join(inputDir, 'DCIM');
      if (!fs.existsSync(dcimPath)) {
        return { success: false, error: `所选文件夹中没有 DCIM 子目录: ${dcimPath}` };
      }
      // adb push <localDir>/DCIM /storage/emulated/0/ → 设备上得到 /storage/emulated/0/DCIM
      await AdbService.push(dcimPath, '/storage/emulated/0/');
      onProgress?.('恢复成功');
      logger.info(`DCIM 恢复成功: ${inputDir}`);
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      onProgress?.('恢复失败');
      logger.error(`DCIM 恢复失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  // ========== ADB-dd 备份/恢复(对应 backup.bat :adb-dd-backup / :adb-dd-recover) ==========

  /**
   * ADB-dd 全分区备份(不含 userdata)
   * 对应 backup.bat:adb-dd-backup
   *
   * 步骤(与原 .bat 1:1 等价):
   *   1. 检查 root(原:call adbdevice root)
   *   2. 获取分区列表(原:adb shell "su -c 'ls /dev/block/bootdevice/by-name/'")
   *   3. 跳过 userdata(原:if /i "!PART!"=="userdata" (跳过))
   *   4. 逐分区 dd 读取(原:adb exec-out "su -c 'dd if=/dev/block/bootdevice/by-name/<part> bs=4096 2>/dev/null'" > <part>.img)
   *   5. 7z 打包(原:progress.exe 7z a -tzip -y <zip> <dir> -bsp1)
   *
   * @param outputDir 输出目录,zip 将生成在此目录下
   * @param onProgress 进度回调
   * @returns { success, zipPath?, error? }
   */
  async backupAdbDd(
    outputDir: string,
    onProgress?: (msg: string) => void,
  ): Promise<BackupResult> {
    try {
      // 原:for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set d=%%a%%b%%c
      // 原:for /f "tokens=1-2 delims=: " %%a in ('time /t') do set t=%%a%%b
      // 原:set backupname=ADB_%d%_%t%
      const now = new Date();
      const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const t = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const backupName = `ADB_${d}_${t}`;
      const backupDir = path.join(outputDir, backupName);
      // 原:md .\backup\%backupname%
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      onProgress?.('等待设备连接...');
      // 原:call adbdevice.bat adb(在 IPC 层检查设备已是 ADB 模式,这里不再重复)

      // 原:call adbdevice.bat root
      onProgress?.('检查 root 权限...');
      const rootResult = await AdbService.root();
      if (!rootResult.granted) {
        // 原:echo %error%没有root权限,请尝试进入twrp/qmmi
        return { success: false, error: '没有 root 权限,请尝试进入 twrp/qmmi' };
      }

      // 原:echo %info%正在获取分区列表...
      // 原:for /f "tokens=*" %%i in ('adb shell "!suroot! 'ls /dev/block/bootdevice/by-name/'" 2^>nul') do ( set PART_LIST=%%i )
      onProgress?.('正在获取分区列表...');
      const listOutput = await AdbService.shell('ls /dev/block/bootdevice/by-name/', {
        timeout: 10000,
        root: true,
      });
      const partitions = listOutput
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (partitions.length === 0) {
        // 原:if not defined PART_LIST ( echo %error%无法获取分区列表 ... exit /b )
        return { success: false, error: '无法获取分区列表,请检查 root 权限或设备支持' };
      }

      // 原:set "ERRORPART=备份失败的分区:"
      const failedParts: string[] = [];
      // 原:echo %info%开始备份分区...
      onProgress?.(`开始备份分区(共 ${partitions.length} 个)...`);

      // 原:for /f %%p in ('adb shell "!suroot! 'ls /dev/block/bootdevice/by-name/'"') do ( ... )
      for (const part of partitions) {
        // 原:if /i "!PART!"=="userdata" ( echo %info%跳过userdata  set PART= )
        if (part.toLowerCase() === 'userdata') {
          onProgress?.('跳过 userdata');
          continue;
        }
        onProgress?.(`正在备份分区: ${part}`);
        // 原:set PART_DEV=/dev/block/bootdevice/by-name/!PART!
        // 原:set IMG_FILE=!PART!.img
        // 原:adb exec-out "!suroot! 'dd if=!PART_DEV! bs=4096 2>/dev/null'" >.\backup\!backupname!\!IMG_FILE!
        const imgFile = path.join(backupDir, `${part}.img`);
        try {
          await this.adbExecOutToFile(
            `su -c 'dd if=/dev/block/bootdevice/by-name/${part} bs=4096 2>/dev/null'`,
            imgFile,
          );
          onProgress?.(`备份 ${part} 已完成`);
        } catch (e) {
          // 原:if !errorlevel! neq 0 ( echo %error%分区 !PART! 备份可能失败,继续下一个... set "ERRORPART=!ERRORPART! !PART!" )
          logger.warn(`分区 ${part} 备份可能失败: ${(e as Error).message}`);
          failedParts.push(part);
        }
      }

      // 注:原 .bat 还包含 MD5 校验环节(:adb-dd-backup 后半段),为减小 IO 与耗时,
      // 这里实现等价校验:对每个备份的 .img 计算本地 md5,同时取设备端 md5sum,比对失败则删除。
      // 校验逻辑保真(对应原 .bat 后半段 "正在校验备份文件完整性" 块)。
      onProgress?.('正在校验备份文件完整性...');
      await this.verifyBackupMd5(backupDir, failedParts, onProgress);

      if (failedParts.length > 0) {
        onProgress?.(`备份失败的分区: ${failedParts.join(' ')}`);
      }

      // 原:ECHO.%INFO%压缩文件
      // 原:progress.exe 7z a -tzip -y .\backup\%backupname%.zip .\backup\%backupname%\ -bsp1
      onProgress?.('压缩备份文件...');
      const zipPath = path.join(outputDir, `${backupName}.zip`);
      await SubprocessPool.spawn({
        cmd: this.sevenZipPath,
        args: ['a', '-tzip', '-y', zipPath, `${backupDir}${path.sep}`],
        encoding: 'utf-8',
        timeout: 600000,
        cwd: paths.bin,
        onStdout: (line) => onProgress?.(line),
      });

      // 原:rd /Q /S .\backup\%backupname% >nul 2>nul
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        // ignore
      }

      onProgress?.(`备份完成: ${zipPath}`);
      logger.info(`ADB-dd 备份成功: ${zipPath}`);
      return { success: true, zipPath };
    } catch (e) {
      const msg = (e as Error).message;
      onProgress?.(`备份失败: ${msg}`);
      logger.error(`ADB-dd 备份失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * 校验备份 md5(对应 backup.bat :adb-dd-backup 中"正在校验备份文件完整性"块)
   * 行为等价:对每个 .img,从设备取 md5sum,与本地 busybox md5sum 比对,不一致则删除本地文件并加入 errorPart。
   */
  private async verifyBackupMd5(
    backupDir: string,
    failedParts: string[],
    onProgress?: (msg: string) => void,
  ): Promise<void> {
    let entries: string[] = [];
    try {
      entries = fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith('.img'));
    } catch {
      return;
    }
    for (const file of entries) {
      const part = path.basename(file, '.img');
      onProgress?.(`正在校验 ${part}...`);
      try {
        // 原:for /f "delims=" %%h in ('adb shell "!suroot! 'md5sum !REAL_DEV! 2^>/dev/null'"') do ...
        const remoteOut = await AdbService.shell(
          `md5sum /dev/block/bootdevice/by-name/${part} 2>/dev/null`,
          { timeout: 30000, root: true },
        );
        const remoteHash = remoteOut.trim().split(/\s+/)[0];
        if (!remoteHash) {
          onProgress?.(`无法获取分区 ${part} 的 MD5,跳过校验`);
          continue;
        }
        // 原:for /f "tokens=1" %%h in ('busybox md5sum "%%f" 2^>nul') do set "LOCAL_HASH=%%h"
        const localHash = await this.busyboxMd5(path.join(backupDir, file));
        if (!localHash) {
          onProgress?.(`无法计算本地文件 ${part}.img 的 MD5,跳过校验`);
          continue;
        }
        if (localHash.toLowerCase() !== remoteHash.toLowerCase()) {
          // 原:echo %error%分区 !PART! 备份校验失败,删除不匹配文件
          onProgress?.(`分区 ${part} 校验失败,删除不匹配文件`);
          try {
            fs.unlinkSync(path.join(backupDir, file));
          } catch {
            // ignore
          }
          if (!failedParts.includes(part)) {
            failedParts.push(part);
          }
        } else {
          onProgress?.(`分区 ${part} 校验通过`);
        }
      } catch (e) {
        logger.warn(`校验 ${part} 异常: ${(e as Error).message}`);
      }
    }
  }

  /**
   * ADB-dd 全分区恢复(不含 userdata)
   * 对应 backup.bat:adb-dd-recover
   *
   * 步骤(与原 .bat 1:1 等价):
   *   1. 选 zip → 7z 解压到临时目录
   *   2. 检查 zip 中是否有 .img 文件
   *   3. 检查 root
   *   4. 获取设备分区表
   *   5. 匹配备份 .img 与设备分区(返回匹配/跳过列表,供 UI 确认)
   *   6. 用户确认后逐分区 dd 写入
   *
   * 由于涉及用户确认,本方法拆分为两步:
   *   - prepareAdbDdRecover(zipPath):解压 + 匹配,返回 { matched, skipped, extractDir }
   *   - executeAdbDdRecover(extractDir, matched, onProgress):实际 dd 写入
   *
   * 完整一次性调用入口:recoverAdbDd(zipPath, onProgress, onConfirm)
   *   onConfirm 返回 true 时继续执行
   */
  async prepareAdbDdRecover(
    zipPath: string,
    onProgress?: (msg: string) => void,
  ): Promise<{ success: boolean; extractDir?: string; match?: AdbDdMatchResult; error?: string }> {
    try {
      // 原:progress.exe 7z x .\backup\tmp.zip -o.\backup\tmp\ -aoa -bsp1
      onProgress?.('解压备份文件...');
      const tmpDir = path.join(paths.resources, 'backup', 'tmp');
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tmpDir, { recursive: true });
      await SubprocessPool.spawn({
        cmd: this.sevenZipPath,
        args: ['x', zipPath, `-o${tmpDir}`, '-aoa'],
        encoding: 'utf-8',
        timeout: 120000,
        cwd: paths.bin,
      });

      // 原:pushd .\backup\tmp\  dir /b *.img >nul 2>&1
      // 原:if %errorlevel% neq 0 ( echo %error%备份文件中没有找到任何 .img 文件 ... exit /b 1 )
      // 注:7z 解压后可能在 tmpDir 根目录有 .img,也可能在子目录。这里扫描两层。
      let extractDir = tmpDir;
      let imgFiles = this.listImgFiles(extractDir);
      if (imgFiles.length === 0) {
        // 找一层子目录
        const subEntries = fs.readdirSync(tmpDir, { withFileTypes: true }).filter((e) => e.isDirectory());
        for (const sub of subEntries) {
          const subDir = path.join(tmpDir, sub.name);
          const subImgs = this.listImgFiles(subDir);
          if (subImgs.length > 0) {
            extractDir = subDir;
            imgFiles = subImgs;
            break;
          }
        }
      }
      if (imgFiles.length === 0) {
        return { success: false, error: '备份文件中没有找到任何 .img 文件' };
      }

      // 原:call adbdevice.bat root
      onProgress?.('检查 root 权限...');
      const rootResult = await AdbService.root();
      if (!rootResult.granted) {
        // 原:echo %error%没有root权限,请尝试进入twrp/qmmi
        return { success: false, error: '没有 root 权限,请尝试进入 twrp/qmmi' };
      }

      // 原:echo %info%正在获取设备分区表...
      // 原:adb shell "!suroot! 'ls /dev/block/bootdevice/by-name/'" > "%PART_LIST_FILE%" 2>nul
      onProgress?.('正在获取设备分区表...');
      const partListOutput = await AdbService.shell('ls /dev/block/bootdevice/by-name/', {
        timeout: 10000,
        root: true,
      });
      const deviceParts = new Set(
        partListOutput
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );

      // 原:echo %info%以下分区将从备份目录中恢复:
      // 原:for %%f in (.\backup\tmp\*.img) do ( set "PART=%%~nf"  findstr /i /b /c:"!PART!" "%PART_LIST_FILE%" >nul ... )
      const matched: string[] = [];
      const skipped: string[] = [];
      for (const img of imgFiles) {
        const part = path.basename(img, '.img');
        if (deviceParts.has(part)) {
          matched.push(part);
        } else {
          skipped.push(part);
        }
      }

      // 原:if %COUNT% equ 0 ( echo %error%没有可恢复的分区 ... exit /b 1 )
      if (matched.length === 0) {
        return { success: false, error: '没有可恢复的分区(备份中的分区均未在设备上发现)' };
      }

      onProgress?.(`匹配 ${matched.length} 个分区,跳过 ${skipped.length} 个`);
      return { success: true, extractDir, match: { matched, skipped } };
    } catch (e) {
      const msg = (e as Error).message;
      onProgress?.(`准备恢复失败: ${msg}`);
      logger.error(`ADB-dd 恢复准备失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * 执行 ADB-dd 恢复的 dd 写入阶段
   * 对应 backup.bat:adb-dd-recover 后半段(for %%f in (!RESTORE_LIST!) do ... dd of=...)
   *
   * @param extractDir 解压后的目录(含 .img 文件)
   * @param parts 要恢复的分区名列表(已与设备匹配)
   */
  async executeAdbDdRecover(
    extractDir: string,
    parts: string[],
    onProgress?: (msg: string) => void,
  ): Promise<BackupResult> {
    const failedParts: string[] = [];
    try {
      for (const part of parts) {
        onProgress?.(`恢复分区: ${part} ...`);
        // 原:set PART_DEV=/dev/block/bootdevice/by-name/!PART!
        // 原:adb.exe exec-in "!suroot! 'dd of=!PART_DEV! bs=4096 2>/dev/null'" <.\backup\tmp\!IMG_FILE!
        // 注:原 .bat 此处路径中含一个多余空格(`.\backup\tmp\ !IMG_FILE!`),属笔误,
        // 我们按"意图"实现为:从 <extractDir>/<part>.img 读取,写入 adb exec-in 的 stdin。
        const imgFile = path.join(extractDir, `${part}.img`);
        if (!fs.existsSync(imgFile)) {
          logger.warn(`分区 ${part} 的镜像不存在: ${imgFile},跳过`);
          failedParts.push(part);
          continue;
        }
        try {
          await this.adbExecInFromFile(
            `su -c 'dd of=/dev/block/bootdevice/by-name/${part} bs=4096 2>/dev/null'`,
            imgFile,
          );
          onProgress?.(`${part} 恢复成功`);
        } catch (e) {
          // 原:if !errorlevel! neq 0 ( echo %error%!PART! 写入可能失败,请检查！ )
          logger.warn(`分区 ${part} 写入可能失败: ${(e as Error).message}`);
          failedParts.push(part);
        }
      }

      // 原:del "%PART_LIST_FILE%" >nul 2>&1
      // 原:echo %info%恢复流程结束,建议重启设备。
      // 清理临时目录
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {
        // ignore
      }

      if (failedParts.length > 0) {
        onProgress?.(`恢复流程结束,部分分区失败: ${failedParts.join(' ')}`);
        return {
          success: false,
          error: `部分分区恢复失败: ${failedParts.join(' ')}`,
        };
      }
      onProgress?.('恢复流程结束,建议重启设备');
      logger.info('ADB-dd 恢复完成');
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      onProgress?.(`恢复失败: ${msg}`);
      logger.error(`ADB-dd 恢复失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * ADB-dd 恢复(一站式入口,带用户确认回调)
   */
  async recoverAdbDd(
    zipPath: string,
    onProgress?: (msg: string) => void,
    onConfirm?: (match: AdbDdMatchResult) => Promise<boolean>,
  ): Promise<BackupResult> {
    const prep = await this.prepareAdbDdRecover(zipPath, onProgress);
    if (!prep.success || !prep.extractDir || !prep.match) {
      return { success: false, error: prep.error };
    }
    // 原:ECHO.%YELLOW%是否确认恢复以上分区? + menu.exe .\menu\yesno.json
    if (onConfirm) {
      const ok = await onConfirm(prep.match);
      if (!ok) {
        // 原:if /i not "!CONFIRM!"=="yes" ( echo %info%已取消操作 ... exit /b 0 )
        onProgress?.('已取消操作');
        // 清理临时目录
        try {
          fs.rmSync(prep.extractDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        return { success: false, error: '用户已取消' };
      }
    }
    return this.executeAdbDdRecover(prep.extractDir, prep.match.matched, onProgress);
  }

  // ========== 开机自刷 TWRP(对应 pashtwrppro.bat) ==========

  /**
   * 开机自刷 TWRP
   * 对应 pashtwrppro.bat
   *
   * 步骤(与原 .bat 1:1 等价):
   *   1. 选型号(已通过参数传入 innermodel)
   *   2. 复制 twrp/<innermodel>.img → work/recovery.img
   *      (原:copy /Y .\EDL\twrp\%innermodel%.img .\EDL\rooting\recovery.img)
   *   3. adb push recovery.img /sdcard/
   *   4. adb push auto_flash_recovery.sh /sdcard/(原:adb push rec.sh /sdcard/)
   *   5. adb shell "su -c cp /sdcard/recovery.img /data/rec.img"
   *   6. adb shell "su -c cp /sdcard/auto_flash_recovery.sh /data/adb/service.d/rec.sh"
   *      (原:adb shell "su -c cp /sdcard/rec.sh /data/adb/service.d/rec.sh")
   *      注:目标路径 /data/adb/service.d/rec.sh 是 Magisk 服务目录约定,不能改(见 plan.md 2.5.2)
   *   7. adb shell "chmod 755 -R /data/adb/service.d/rec.sh"
   *   8. 清理工作目录
   */
  async autoFlashTwrp(
    innermodel: string,
    onProgress?: (msg: string) => void,
  ): Promise<BackupResult> {
    try {
      // 原:if not exist .\EDL\twrp call cloud twrp
      const twrpDir = paths.edlFile('twrp');
      if (!fs.existsSync(twrpDir)) {
        return {
          success: false,
          error: 'TWRP 镜像未下载,请先在"资源下载"页下载 TWRP',
        };
      }
      const twrpImg = path.join(twrpDir, `${innermodel}.img`);
      if (!fs.existsSync(twrpImg)) {
        return {
          success: false,
          error: `TWRP 镜像不存在: ${innermodel}.img`,
        };
      }

      // 原:ECHO %INFO%拷贝文件到临时目录
      // 原:copy /Y .\EDL\twrp\%innermodel%.img .\EDL\rooting\recovery.img
      onProgress?.('拷贝文件到临时目录...');
      const workDir = paths.edlWork;
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
      }
      const recoveryImg = path.join(workDir, 'recovery.img');
      fs.copyFileSync(twrpImg, recoveryImg);

      // 原:ECHO %INFO%开始导入脚本
      // 原:adb push .\EDL\rooting\recovery.img /sdcard/
      onProgress?.('推送 recovery.img...');
      await AdbService.push(recoveryImg, '/sdcard/');

      // 原:adb push rec.sh /sdcard/
      // 改名(见 plan.md 2.5.2):rec.sh → auto_flash_recovery.sh(源文件名)
      onProgress?.('推送 auto_flash_recovery.sh...');
      const scriptPath = paths.scriptFile('auto_flash_recovery.sh');
      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: `脚本文件不存在: auto_flash_recovery.sh` };
      }
      await AdbService.push(scriptPath, '/sdcard/');

      // 原:adb shell "su -c cp /sdcard/recovery.img /data/rec.img"
      onProgress?.('安装到 Magisk 服务目录...');
      await AdbService.shell('cp /sdcard/recovery.img /data/rec.img', {
        timeout: 10000,
        root: true,
      });

      // 原:adb shell "su -c cp /sdcard/rec.sh /data/adb/service.d/rec.sh"
      // 改名:源是 auto_flash_recovery.sh,目标保留 /data/adb/service.d/rec.sh(Magisk 约定)
      await AdbService.shell('cp /sdcard/auto_flash_recovery.sh /data/adb/service.d/rec.sh', {
        timeout: 10000,
        root: true,
      });

      // 原:adb shell "chmod 755 -R /data/adb/service.d/rec.sh"
      await AdbService.shell('chmod 755 -R /data/adb/service.d/rec.sh', {
        timeout: 10000,
        root: true,
      });

      // 原:ECHO %INFO%清理临时数据
      // 原:del /Q /F ".\EDL\rooting\*.*"
      try {
        const workFiles = fs.readdirSync(workDir);
        for (const f of workFiles) {
          fs.unlinkSync(path.join(workDir, f));
        }
      } catch {
        // ignore
      }

      onProgress?.('刷入完成');
      logger.info(`开机自刷 TWRP 完成: ${innermodel}`);
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      onProgress?.(`刷入失败: ${msg}`);
      logger.error(`开机自刷 TWRP 失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  // ========== Xposed 安装(对应 Xposed.bat) ==========

  /**
   * Xposed 安装
   * 对应 Xposed.bat
   *
   * 步骤(与原 .bat 1:1 等价):
   *   1. 读 sdkversion(原:adb shell getprop ro.build.version.sdk)
   *   2. SDK=19 → MagiskModule-1 分支:
   *      - instapp apks/xpinstaller19.apk
   *      - instmodule tmp/19xposed.zip shinst
   *      - adb reboot
   *   3. SDK=25 → MagiskModule-2 分支:
   *      - instapp apks/toolkit.apk
   *      - instapp apks/xposed-magisk.apk
   *      - instmodule tmp/xposed-magisk-1.zip shinst
   *      - adb reboot
   *      - 等开机(原:device_check.exe adb + boot_completed.bat + busybox sleep 10)
   *      - instmodule tmp/xposed-magisk-2.zip shinst
   *      - adb reboot
   *   4. 其他 SDK:不支持
   *
   * 注:对应 plan.md 6.9 MagiskService 的 install(zip, 'shinst') 等价 instmodule.bat shinst
   *     对应 plan.md 6.10 AppService 的 install(apk, 'install') 等价 instapp.bat(默认 install)
   */
  async installXposed(onProgress?: (msg: string) => void): Promise<BackupResult> {
    try {
      // 原:call boot_completed.bat(等开机完成)
      onProgress?.('等待设备开机完成...');
      await AdbService.waitForBoot(120000);

      // 原:for /f "delims=" %%i in ('adb shell getprop ro.build.version.release') do set androidversion=%%i
      const androidVersion = await AdbService.getprop('ro.build.version.release');
      onProgress?.(`您的设备安卓版本为: ${androidVersion}`);

      // 原:for /f "delims=" %%i in ('adb shell getprop ro.build.version.sdk') do set sdkversion=%%i
      const sdkVersion = (await AdbService.getprop('ro.build.version.sdk')).trim();
      onProgress?.(`SDK 版本号: ${sdkVersion}`);

      // 原:if "%sdkversion%"=="19" ( goto MagiskModule-1 )
      // 原:if "%sdkversion%"=="25" ( goto MagiskModule-2 )
      if (sdkVersion === '19') {
        return await this.installXposedSdk19(onProgress);
      }
      if (sdkVersion === '25') {
        return await this.installXposedSdk25(onProgress);
      }

      // 原:echo %INFO%不是安卓4.4.4，也不是安卓7.1.1，无法安装。
      onProgress?.('不是安卓 4.4.4,也不是安卓 7.1.1,无法安装');
      return {
        success: false,
        error: `不支持的 SDK 版本: ${sdkVersion}(仅支持 19/25)`,
      };
    } catch (e) {
      const msg = (e as Error).message;
      onProgress?.(`Xposed 安装失败: ${msg}`);
      logger.error(`Xposed 安装失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  // 对应 Xposed.bat :MagiskModule-1(SDK=19)
  private async installXposedSdk19(onProgress?: (msg: string) => void): Promise<BackupResult> {
    try {
      // 原逻辑(开头):if not exist .\tmp\xposed.zip call cloud xp
      // 等价:确保 apks + xp 资源已下载到 resources/apks/ 和 resources/cache/
      const ensureOk = await this.ensureXposedResources(onProgress);
      if (!ensureOk.success) {
        return { success: false, error: ensureOk.error };
      }

      // 原:call instapp.bat apks\xpinstaller19.apk
      // 路径转换:apks\ → resources/apks/(原 bin/apks/,见 plan.md 10.1)
      onProgress?.('安装 xpinstaller19.apk...');
      const apk1 = path.join(paths.resources, 'apks', 'xpinstaller19.apk');
      if (!fs.existsSync(apk1)) {
        return { success: false, error: 'apks/xpinstaller19.apk 不存在,请先在"资源下载"页下载 apks 资源' };
      }
      const r1 = await AdbService.install(apk1, 'install');
      if (!r1.success) {
        return { success: false, error: '安装 xpinstaller19.apk 失败' };
      }

      // 原:call instmodule.bat tmp\19xposed.zip shinst
      // 路径转换:tmp\ → resources/cache/(原 bin/tmp/,改名见 plan.md 2.5.1)
      onProgress?.('安装 19xposed.zip 模块...');
      const zip1 = path.join(paths.cache, '19xposed.zip');
      if (!fs.existsSync(zip1)) {
        return { success: false, error: 'tmp/19xposed.zip 不存在,请先在"资源下载"页下载 xp 资源' };
      }
      // MagiskService.install(zip, 'shinst') 等价 instmodule.bat shinst
      const r2 = await MagiskService.install(zip1, 'shinst');
      if (!r2.success) {
        return { success: false, error: r2.error ?? '安装 19xposed.zip 失败' };
      }

      // 原:echo %INFO%重启手表  adb reboot
      onProgress?.('重启手表...');
      await AdbService.reboot('system');

      onProgress?.('Xposed 安装成功');
      logger.info('Xposed 安装成功(SDK=19)');
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      return { success: false, error: msg };
    }
  }

  // 对应 Xposed.bat :MagiskModule-2(SDK=25)
  private async installXposedSdk25(onProgress?: (msg: string) => void): Promise<BackupResult> {
    try {
      // 原逻辑(开头):if not exist .\tmp\xposed.zip call cloud xp
      const ensureOk = await this.ensureXposedResources(onProgress);
      if (!ensureOk.success) {
        return { success: false, error: ensureOk.error };
      }

      // 原:call instapp.bat apks\toolkit.apk
      onProgress?.('安装 toolkit.apk...');
      const apkToolkit = path.join(paths.resources, 'apks', 'toolkit.apk');
      if (!fs.existsSync(apkToolkit)) {
        return { success: false, error: 'apks/toolkit.apk 不存在,请先在"资源下载"页下载 apks 资源' };
      }
      const r1 = await AdbService.install(apkToolkit, 'install');
      if (!r1.success) {
        return { success: false, error: '安装 toolkit.apk 失败' };
      }

      // 原:call instapp.bat apks\xposed-magisk.apk
      onProgress?.('安装 xposed-magisk.apk...');
      const apkXp = path.join(paths.resources, 'apks', 'xposed-magisk.apk');
      if (!fs.existsSync(apkXp)) {
        return { success: false, error: 'apks/xposed-magisk.apk 不存在,请先在"资源下载"页下载 apks 资源' };
      }
      const r2 = await AdbService.install(apkXp, 'install');
      if (!r2.success) {
        return { success: false, error: '安装 xposed-magisk.apk 失败' };
      }

      // 原:call instmodule.bat tmp\xposed-magisk-1.zip shinst
      onProgress?.('安装 xposed-magisk-1.zip 模块...');
      const zip1 = path.join(paths.cache, 'xposed-magisk-1.zip');
      if (!fs.existsSync(zip1)) {
        return { success: false, error: 'tmp/xposed-magisk-1.zip 不存在,请先在"资源下载"页下载 xp 资源' };
      }
      const r3 = await MagiskService.install(zip1, 'shinst');
      if (!r3.success) {
        return { success: false, error: r3.error ?? '安装 xposed-magisk-1.zip 失败' };
      }

      // 原:echo %INFO%重启手表  adb reboot
      onProgress?.('重启手表(首次刷入 xp 可能需要 7-15 分钟开机时间,请耐心等待)...');
      await AdbService.reboot('system');

      // 原:echo %INFO%首次刷入xp可能需要7-15分钟开机时间,请耐心等待
      // 原:device_check.exe adb&&ECHO.  call boot_completed.bat  busybox sleep 10
      onProgress?.('等待设备重新开机完成...');
      await AdbService.waitForBoot(900000); // 给 15 分钟超时
      // 原:busybox sleep 10
      await new Promise((r) => setTimeout(r, 10000));

      // 原:call instmodule.bat tmp\xposed-magisk-2.zip shinst
      onProgress?.('安装 xposed-magisk-2.zip 模块...');
      const zip2 = path.join(paths.cache, 'xposed-magisk-2.zip');
      if (!fs.existsSync(zip2)) {
        return { success: false, error: 'tmp/xposed-magisk-2.zip 不存在,请先在"资源下载"页下载 xp 资源' };
      }
      const r4 = await MagiskService.install(zip2, 'shinst');
      if (!r4.success) {
        return { success: false, error: r4.error ?? '安装 xposed-magisk-2.zip 失败' };
      }

      // 原:echo %INFO%重启手表  adb reboot
      onProgress?.('重启手表...');
      await AdbService.reboot('system');

      onProgress?.('Xposed 安装成功');
      logger.info('Xposed 安装成功(SDK=25)');
      return { success: true };
    } catch (e) {
      const msg = (e as Error).message;
      return { success: false, error: msg };
    }
  }

  /**
   * 确保 Xposed 所需资源已就绪
   * 对应原 Xposed.bat 开头的:if not exist .\tmp\xposed.zip call cloud xp
   *
   * 资源映射(见 plan.md 2.5.1 + 10.1):
   *   - 原 bin/apks/ → resources/apks/(由 CloudService.download('apks') 解压)
   *   - 原 bin/tmp/  → resources/cache/(原 cloud.bat :xp 把 xp.zip 解压到 ./tmp/)
   *
   * CloudService 的 xp 资源 extract=false,所以这里需要手动解压 xp.zip 到 cache/
   */
  private async ensureXposedResources(
    _onProgress?: (msg: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    // 检查 xp 内部 zip 是否已存在(说明已解压)
    const xp19 = path.join(paths.cache, '19xposed.zip');
    const xp251 = path.join(paths.cache, 'xposed-magisk-1.zip');
    if (fs.existsSync(xp19) || fs.existsSync(xp251)) {
      return { success: true };
    }

    // 检查 apks 目录里的 apk 是否已存在
    const apk19 = path.join(paths.resources, 'apks', 'xpinstaller19.apk');
    const apkTool = path.join(paths.resources, 'apks', 'toolkit.apk');
    const hasApks = fs.existsSync(apk19) || fs.existsSync(apkTool);

    // 若有任一资源缺失,提示用户去下载
    if (!hasApks) {
      return {
        success: false,
        error: '缺少 apks 资源,请先在"资源下载"页下载 apks 资源',
      };
    }
    return {
      success: false,
      error: '缺少 xp 资源,请先在"资源下载"页下载 xp 资源(会自动解压到 cache/)',
    };
  }

  // ========== 底层辅助方法 ==========

  /**
   * 列出目录下的 .img 文件
   */
  private listImgFiles(dir: string): string[] {
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.img'))
        .map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  }

  /**
   * 用本地 busybox.exe 计算 md5
   * 对应原 .bat:busybox md5sum "<file>"
   */
  private async busyboxMd5(filePath: string): Promise<string | null> {
    try {
      const result = await SubprocessPool.spawn({
        cmd: paths.binFile('busybox.exe'),
        args: ['md5sum', filePath],
        encoding: 'utf-8',
        timeout: 120000,
        cwd: paths.bin,
        silent: true,
      });
      return result.stdout.trim().split(/\s+/)[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * adb exec-out 命令,将 stdout(可能为二进制)写入本地文件
   * 对应原 .bat:adb exec-out "su -c '...'" > <file>
   *
   * 注:stdout 是二进制(dd 读取的分区数据),不解码,直接写文件。
   */
  private adbExecOutToFile(shellCmd: string, outputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 原:adb exec-out "!suroot! 'dd if=!PART_DEV! bs=4096 2>/dev/null'" > file
      // args:exec-out "su -c '...'"
      const proc = spawn(this.adbPath, ['exec-out', shellCmd], {
        cwd: paths.bin,
        windowsHide: true,
        shell: false,
      });
      const out = fs.createWriteStream(outputFile);
      proc.stdout?.pipe(out);
      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      proc.on('error', (err) => {
        try {
          out.close();
        } catch {
          // ignore
        }
        reject(new SpawnError(`adb exec-out 启动失败: ${err.message}`, -1, '', stderr, 0, false, false));
      });
      proc.on('close', (code) => {
        try {
          out.close();
        } catch {
          // ignore
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new SpawnError(`adb exec-out 退出码 ${code}`, code ?? -1, '', stderr, 0, false, false));
        }
      });
    });
  }

  /**
   * adb exec-in 命令,将本地文件内容写入 stdin
   * 对应原 .bat:adb.exe exec-in "..." < <file>
   */
  private adbExecInFromFile(shellCmd: string, inputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 原:adb.exe exec-in "!suroot! 'dd of=!PART_DEV! bs=4096 2>/dev/null'" < file
      const proc = spawn(this.adbPath, ['exec-in', shellCmd], {
        cwd: paths.bin,
        windowsHide: true,
        shell: false,
      });
      const inp = fs.createReadStream(inputFile);
      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      inp.on('error', (err) => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        reject(new SpawnError(`读取文件失败: ${err.message}`, -1, '', stderr, 0, false, false));
      });
      inp.pipe(proc.stdin);
      proc.on('error', (err) => {
        reject(new SpawnError(`adb exec-in 启动失败: ${err.message}`, -1, '', stderr, 0, false, false));
      });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new SpawnError(`adb exec-in 退出码 ${code}`, code ?? -1, '', stderr, 0, false, false));
        }
      });
    });
  }
}

export const BackupService = new BackupServiceClass();
