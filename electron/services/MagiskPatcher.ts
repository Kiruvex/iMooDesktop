// electron/services/MagiskPatcher.ts - 替代原 magiskpatch.bat
// 见 plan.md 6.6 MagiskPatcher
//
// 逻辑保真(最高优先级,见 plan.md 核心约束"逻辑保真度"):
//   1:1 复刻原 magiskpatch.bat 的 250 行状态机:
//   - 25200 分支(Magisk 25,SDK27):magiskinit25 + magisk32.xz
//     * KEEPVERITY=true, KEEPFORCEENCRYPT=true, PATCHVBMETAFLAG=false,
//       RECOVERYMODE=false, LEGACYSAR=true, arch=arm_32
//     * magiskboot unpack -h boot.img
//     * 测试 ramdisk.cpio(STATUS 0=stock, 1=magisk patched)
//     * Mode 0:SHA1 = magiskboot sha1, backup ramdisk.cpio.orig
//     * Mode 1:SHA1 = magiskboot cpio sha1, restore, backup
//     * 写 config 文件(KEEPVERITY/KEEPFORCEENCRYPT/PATCHVBMETAFLAG/RECOVERYMODE/SHA1)
//     * magiskboot cpio 序列(注意 magisk64.xz 那条是注释掉的)
//     * DTB patch(dtb/kernel_dtb/extra,先 test 再 patch)
//     * 3 处 hexpatch kernel
//   - 21200 分支(Magisk 21,SDK25):magiskinit21(无 magisk32.xz)
//     * 检查 recovery_dtbo → 强制 RECOVERYMODE=true
//     * config 无 PATCHVBMETAFLAG
//     * cpio: "add 750 init magiskinit"(注意 750 不是 0750!)
//     * DTB patch 包含 recovery_dtbo,无 test 直接 patch
//     * 同 3 处 hexpatch
//
// 所有 magiskboot 命令通过 SubprocessPool 调用 paths.binFile('magiskboot.exe'),
// cwd 设为工作目录(paths.edlWork)。
//
// magiskinit 文件:从 paths.binFile('magiskinit21') 或 paths.binFile('magiskinit25') 复制到工作目录的 'magiskinit'
// magisk32.xz:从 paths.binFile('magisk32.xz') 复制到工作目录(仅 25200 分支)

import fs from 'node:fs';
import path from 'node:path';
import { SubprocessPool, SpawnError } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';

const logger = Logger.instance.child('MagiskPatcher');

export type MagiskVersion = 21 | 25;

export type MagiskPatchStatus = 'stock' | 'magisk-patched' | 'restored';

export interface MagiskPatchResult {
  success: boolean;
  status: MagiskPatchStatus;
  /** SHA1(若计算过) */
  sha1?: string;
  error?: string;
}

/** magiskboot 命令的统一封装(cwd=工作目录,捕获 stdout/stderr) */
async function magiskboot(
  args: string[],
  opts: { cwd: string; taskId?: string; timeout?: number } = { cwd: paths.edlWork },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const magiskbootExe = paths.binFile('magiskboot.exe');
  try {
    const r = await SubprocessPool.spawn({
      cmd: magiskbootExe,
      args,
      cwd: opts.cwd,
      encoding: 'utf-8',
      timeout: opts.timeout ?? 60000,
      taskId: opts.taskId,
      onStdout: (line) => logger.debug(`magiskboot: ${line}`),
      onStderr: (line) => logger.warn(`magiskboot stderr: ${line}`),
    });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? 0 };
  } catch (e) {
    const err = e as SpawnError;
    // magiskboot 部分子命令返回非 0 是正常的(如 cpio test 检测 magisk patched),
    // 这里把 exitCode 也返回,让调用方判断
    if (err.exitCode !== undefined && err.exitCode !== null) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.exitCode,
      };
    }
    throw e;
  }
}

class MagiskPatcherClass {
  /**
   * 修补 boot.img
   * 对应原 magiskpatch.bat(250 行状态机)
   *
   * @param bootImg 输入 boot.img 的绝对路径
   * @param outputPath 输出 boot.img 的绝对路径
   * @param magiskVer Magisk 版本(21=SDK25, 25=SDK27)
   * @param workDir 工作目录(默认 paths.edlWork)
   * @param taskId 任务 ID(用于日志关联)
   */
  async patch(
    bootImg: string,
    outputPath: string,
    magiskVer: MagiskVersion,
    workDir: string = paths.edlWork,
    taskId?: string,
  ): Promise<MagiskPatchResult> {
    if (!fs.existsSync(bootImg)) {
      return { success: false, status: 'stock', error: `boot.img 不存在: ${bootImg}` };
    }
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    logger.info(`开始修补 boot.img(magisk ${magiskVer}): ${bootImg} → ${outputPath}`);

    // ========== 1. 清理临时文件(对应 magiskpatch.bat:14-21) ==========
    // del /Q /F .\magiskinit .\header .\kernel_dtb .\kernel .\ramdisk.cpio .\config .\ramdisk.cpio.orig
    const tempFiles = ['magiskinit', 'header', 'kernel_dtb', 'kernel', 'ramdisk.cpio', 'config', 'ramdisk.cpio.orig'];
    for (const f of tempFiles) {
      const p = path.join(workDir, f);
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }

    // ========== 2. 复制 magiskinit(对应 magiskpatch.bat:22) ==========
    // copy /y .\magiskinit%magiskver% .\magiskinit
    const magiskinitSrc = paths.binFile(`magiskinit${magiskVer}`);
    const magiskinitDst = path.join(workDir, 'magiskinit');
    if (!fs.existsSync(magiskinitSrc)) {
      return { success: false, status: 'stock', error: `magiskinit${magiskVer} 不存在` };
    }
    fs.copyFileSync(magiskinitSrc, magiskinitDst);

    // ========== 3. 设置修补选项(对应 magiskpatch.bat:24-35) ==========
    // 25200 分支:KEEPVERITY=true, KEEPFORCEENCRYPT=true, PATCHVBMETAFLAG=false,
    //             RECOVERYMODE=false, LEGACYSAR=true, arch=arm_32
    // 21200 分支:KEEPVERITY=true, KEEPFORCEENCRYPT=true, RECOVERYMODE=false, arch=arm_32
    //             (PATCHVBMETAFLAG 不设置,LEGACYSAR 不设置)
    const KEEPVERITY = 'true';
    const KEEPFORCEENCRYPT = 'true';
    const PATCHVBMETAFLAG = magiskVer === 25 ? 'false' : undefined;
    let RECOVERYMODE = 'false';
    // LEGACYSAR 仅在 25200 分支设置(原 .bat 设了但实际未使用,因为新版 magiskboot 自动检测)
    // 这里保留设置(逻辑保真),但写入 config 时不写 LEGACYSAR(原 .bat 也没写)
    // arch=arm_32 仅作为内部变量,实际不传给 magiskboot

    // 25200 分支需要 magisk32.xz
    if (magiskVer === 25) {
      // 对应 magiskpatch.bat:42:if not exist .\magisk32.xz goto FATAL
      const magisk32xzSrc = paths.binFile('magisk32.xz');
      if (!fs.existsSync(magisk32xzSrc)) {
        return { success: false, status: 'stock', error: 'magisk32.xz 不存在' };
      }
      fs.copyFileSync(magisk32xzSrc, path.join(workDir, 'magisk32.xz'));
    }

    // ========== 4. 解包 boot(对应 magiskpatch.bat:45/84) ==========
    // magiskboot.exe unpack -h %bootpath%
    await magiskboot(['unpack', '-h', bootImg], { cwd: workDir, taskId });

    // 21200 分支:检查 recovery_dtbo(对应 magiskpatch.bat:88)
    if (magiskVer === 21) {
      if (fs.existsSync(path.join(workDir, 'recovery_dtbo'))) {
        RECOVERYMODE = 'true';
        logger.info('检测到 recovery_dtbo,RECOVERYMODE 强制设为 true');
      }
    }

    // ========== 5. 测试 ramdisk.cpio(对应 magiskpatch.bat:46-53 / 90-97) ==========
    let STATUS = 0;
    let sha1 = '';
    let status: MagiskPatchStatus = 'stock';

    if (!fs.existsSync(path.join(workDir, 'ramdisk.cpio'))) {
      // 对应:if not exist .\ramdisk.cpio ( set STATUS=0 & goto MODE0 )
      STATUS = 0;
    } else {
      // magiskboot.exe cpio .\ramdisk.cpio test
      const testResult = await magiskboot(['cpio', 'ramdisk.cpio', 'test'], { cwd: workDir, taskId });
      // magiskboot cpio test 通过 exitCode 返回状态:0=stock, 1=magisk patched
      STATUS = testResult.exitCode;
      if (STATUS !== 0 && STATUS !== 1) {
        // 对应:goto FATAL
        return { success: false, status: 'stock', error: `magiskboot cpio test 返回异常 exitCode: ${STATUS}` };
      }
    }

    if (STATUS === 0) {
      // ========== Mode 0:Stock boot image detected(对应 magiskpatch.bat:55-60 / 99-105) ==========
      status = 'stock';
      // SHA1 = magiskboot sha1 %bootpath%
      const sha1Result = await magiskboot(['sha1', bootImg], { cwd: workDir, taskId });
      sha1 = sha1Result.stdout.trim().split(/\s+/)[0] ?? '';
      // copy /Y .\ramdisk.cpio .\ramdisk.cpio.orig
      const ramdiskCpio = path.join(workDir, 'ramdisk.cpio');
      const ramdiskOrig = path.join(workDir, 'ramdisk.cpio.orig');
      if (fs.existsSync(ramdiskCpio)) {
        fs.copyFileSync(ramdiskCpio, ramdiskOrig);
      }
    } else {
      // ========== Mode 1:Magisk patched boot image detected(对应 magiskpatch.bat:62-67 / 107-114) ==========
      status = 'magisk-patched';
      // SHA1 = magiskboot cpio ramdisk.cpio sha1
      const sha1Result = await magiskboot(['cpio', 'ramdisk.cpio', 'sha1'], { cwd: workDir, taskId });
      sha1 = sha1Result.stdout.trim().split(/\s+/)[0] ?? '';
      // magiskboot.exe cpio ramdisk.cpio restore
      await magiskboot(['cpio', 'ramdisk.cpio', 'restore'], { cwd: workDir, taskId });
      status = 'restored';
      // copy /Y .\ramdisk.cpio .\ramdisk.cpio.orig
      const ramdiskCpio = path.join(workDir, 'ramdisk.cpio');
      const ramdiskOrig = path.join(workDir, 'ramdisk.cpio.orig');
      if (fs.existsSync(ramdiskCpio)) {
        fs.copyFileSync(ramdiskCpio, ramdiskOrig);
      }
    }

    // ========== 6. 写 config 文件(对应 magiskpatch.bat:69-71 / 116-118) ==========
    // 25200:
    //   echo.KEEPVERITY=%KEEPVERITY%>config
    //   echo.KEEPFORCEENCRYPT=%KEEPFORCEENCRYPT%>>config
    //   echo.PATCHVBMETAFLAG=%PATCHVBMETAFLAG%>>config
    //   echo.RECOVERYMODE=%RECOVERYMODE%>>config
    //   if not "%SHA1%"=="" echo.SHA1=%SHA1%|find "SHA1" 1>>config
    // 21200:
    //   echo.KEEPVERITY>config
    //   echo.KEEPFORCEENCRYPT>>config
    //   echo.RECOVERYMODE>>config
    //   if not "%SHA1%"=="" echo.SHA1=%SHA1%|find "SHA1" 1>>config
    // 注:原 .bat 用 `echo.X>config` 写入 "X\r\n",最后用 busybox sed -i "s/\r//g;s/^M//g" config 去掉 CR
    // TS 直接写 LF 结尾的文本,跳过 sed 步骤(等价语义)
    const configLines: string[] = [];
    configLines.push(`KEEPVERITY=${KEEPVERITY}`);
    configLines.push(`KEEPFORCEENCRYPT=${KEEPFORCEENCRYPT}`);
    if (PATCHVBMETAFLAG !== undefined) {
      configLines.push(`PATCHVBMETAFLAG=${PATCHVBMETAFLAG}`);
    }
    configLines.push(`RECOVERYMODE=${RECOVERYMODE}`);
    if (sha1) {
      configLines.push(`SHA1=${sha1}`);
    }
    fs.writeFileSync(path.join(workDir, 'config'), configLines.join('\n') + '\n', 'utf-8');

    // ========== 7. magiskboot cpio 操作序列 ==========
    if (magiskVer === 25) {
      // 对应 magiskpatch.bat:73
      // magiskboot.exe cpio ramdisk.cpio "add 0750 init magiskinit" "mkdir 0750 overlay.d"
      //   "mkdir 0750 overlay.d/sbin" "add 0644 overlay.d/sbin/magisk32.xz magisk32.xz"
      //   "%var% add 0644 overlay.d/sbin/magisk64.xz magisk64.xz"  (注:%var%=# 即注释掉)
      //   "patch" "backup ramdisk.cpio.orig" "mkdir 000 .backup" "add 000 .backup/.magisk config"
      await magiskboot(
        [
          'cpio',
          'ramdisk.cpio',
          'add 0750 init magiskinit',
          'mkdir 0750 overlay.d',
          'mkdir 0750 overlay.d/sbin',
          'add 0644 overlay.d/sbin/magisk32.xz magisk32.xz',
          '# add 0644 overlay.d/sbin/magisk64.xz magisk64.xz',
          'patch',
          'backup ramdisk.cpio.orig',
          'mkdir 000 .backup',
          'add 000 .backup/.magisk config',
        ],
        { cwd: workDir, taskId },
      );
    } else {
      // 对应 magiskpatch.bat:119
      // magiskboot.exe cpio ramdisk.cpio "add 750 init magiskinit" "patch" "backup ramdisk.cpio.orig"
      //   "mkdir 000 .backup" "add 000 .backup/.magisk config"
      // 注意:21200 分支的 '750' 没有前导 0!这是原 .bat 的字面值,逻辑保真必须保留
      await magiskboot(
        [
          'cpio',
          'ramdisk.cpio',
          'add 750 init magiskinit',
          'patch',
          'backup ramdisk.cpio.orig',
          'mkdir 000 .backup',
          'add 000 .backup/.magisk config',
        ],
        { cwd: workDir, taskId },
      );
    }

    // ========== 8. DTB patch ==========
    if (magiskVer === 25) {
      // 对应 magiskpatch.bat:74-79
      // if exist dtb set dtbname=dtb & call :dtb_sub  (test + patch)
      // if exist kernel_dtb set dtbname=kernel_dtb & call :dtb_sub
      // if exist extra set dtbname=extra & call :dtb_sub
      for (const dtbName of ['dtb', 'kernel_dtb', 'extra']) {
        const dtbPath = path.join(workDir, dtbName);
        if (fs.existsSync(dtbPath)) {
          // 先 test 再 patch(对应 :magiskpatch-25200-dtb)
          await magiskboot(['dtb', dtbName, 'test'], { cwd: workDir, taskId });
          await magiskboot(['dtb', dtbName, 'patch'], { cwd: workDir, taskId });
        }
      }
    } else {
      // 对应 magiskpatch.bat:121-129
      // 检查 dtb/kernel_dtb/extra/recovery_dtbo,有一个就 patch(无 test)
      let dtbName: string | null = null;
      for (const name of ['dtb', 'kernel_dtb', 'extra', 'recovery_dtbo']) {
        if (fs.existsSync(path.join(workDir, name))) {
          dtbName = name;
          break;
        }
      }
      if (dtbName) {
        await magiskboot(['dtb', dtbName, 'patch'], { cwd: workDir, taskId });
      }
    }

    // ========== 9. 3 处 hexpatch kernel(对应 magiskpatch.bat:81-83 / 131-133) ==========
    // 注:hexpatch 字节序列必须逐字一致(逻辑保真)
    await magiskboot(
      [
        'hexpatch',
        'kernel',
        '49010054011440B93FA00F71E9000054010840B93FA00F7189000054001840B91FA00F7188010054',
        'A1020054011440B93FA00F7140020054010840B93FA00F71E0010054001840B91FA00F7181010054',
      ],
      { cwd: workDir, taskId },
    );
    await magiskboot(['hexpatch', 'kernel', '821B8012', 'E2FF8F12'], { cwd: workDir, taskId });
    // want_initramfs → skip_initramfs(ASCII hex)
    await magiskboot(
      [
        'hexpatch',
        'kernel',
        '77616E745F696E697472616D667300',
        '736B69705F696E697472616D667300',
      ],
      { cwd: workDir, taskId },
    );

    // ========== 10. repack(对应 magiskpatch.bat:138) ==========
    // magiskboot.exe repack %bootpath% boot_new.img
    await magiskboot(['repack', bootImg, 'boot_new.img'], { cwd: workDir, taskId });

    const bootNewPath = path.join(workDir, 'boot_new.img');
    if (!fs.existsSync(bootNewPath)) {
      return { success: false, status, sha1, error: 'magiskboot repack 未生成 boot_new.img' };
    }

    // ========== 11. 移动成品到指定目录(对应 magiskpatch.bat:147) ==========
    // move /Y .\boot_new.img %outputpath%
    // 确保 outputPath 的父目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    // 如果目标已存在,先删除(move /Y 会覆盖)
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    fs.renameSync(bootNewPath, outputPath);

    // ========== 12. 清理临时文件(对应 magiskpatch.bat:150-156) ==========
    for (const f of tempFiles) {
      const p = path.join(workDir, f);
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
    // 25200 分支还复制了 magisk32.xz,清理
    if (magiskVer === 25) {
      try {
        const p = path.join(workDir, 'magisk32.xz');
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }

    logger.info(`boot.img 修补完成: ${outputPath}(status=${status})`);
    return { success: true, status, sha1 };
  }
}

export const MagiskPatcher = new MagiskPatcherClass();
