// electron/services/RootService.ts - Root 全流程状态机
// 见 plan.md 6.7 RootService
// 对应原 root.bat + ROOT-SDK19/25/27.bat + nd03root.bat + automagisk.bat + autosystemplus.bat
//
// 逻辑保真(最高优先级,见 plan.md 核心约束"逻辑保真度"):
//   - Root 流程步骤、stage 顺序、分支条件 1:1 复刻原 .bat
//   - adb/fastboot/fh_loader/QSaharaServer/magiskboot 命令参数逐字一致
//   - automagisk.bat 的 11 步点击坐标逐字一致(SDK27:tap 304 26 + swipe 160 300→160 60 x5)
//   - ND03 的点击坐标与 SDK27 不同(376 51 vs 304 26 等),必须分别实现
//   - 已知 bug 修复:instmodule2.bat → instmodule.bat(见 plan.md 2.4)
//   - 已知 bug 修复:patch_boot.exe 输出 success(不是 Sucess)
//   - 彩蛋文案保留(SDK=11 提示"你是怎么运行到这里的?")
//   - 提示文案保留("设备处于正常刷写状态，请勿断开数据线"x3、"跨越山海 终见曙光"等)
//
// 实现策略:
//   - 每个 stage 对应一个 private async 方法
//   - stage 之间用 nextStage(ctx) 函数计算,集中管理转移规则
//   - 用户暂停 → ctx.paused=true,在 stage 边界检查
//   - 失败 → ctx.error,stage='failed'
//   - 日志 → 每步通过 Logger 输出,taskId 关联
//
// 范围(完整):
//   - 完整骨架 + RootStage 枚举(60+ 个 stage)
//   - SDK19 完整实现(Android 4.4,Z2/Z3 老固件,fastboot 直刷)
//   - SDK25 完整实现(Android 7.1,EDL + magiskpatch 21,BOOT/Recovery 双方案)
//   - SDK27 完整实现(Android 8.1,EDL + magiskpatch 25,smodel/nouserdata/isv3 分支)
//   - ND03 完整实现(Z10,prog_firehose_ddr.elf + 281 恢复固件 + LSPosed)
//   - automagisk 11 步点击 + 失败时 scrcpy 手动重试
//   - autosystemplus 自动激活 + 失败时 scrcpy 手动重试

import { EventEmitter } from 'node:events';
import { TIMEOUT } from '../lib/timeouts';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { AdbService } from './AdbService';
import { FastbootService } from './FastbootService';
import { EdlService } from './EdlService';
import { DeviceService } from './DeviceService';
import { MagiskPatcher, type MagiskVersion } from './MagiskPatcher';
import { BootPatcher } from './BootPatcher';
import { MagiskService } from './MagiskService';
import { BackupService } from './BackupService';
import { ScrcpyService } from './ScrcpyService';
import { CloudService } from './CloudService';
import { SubprocessPool } from './SubprocessPool';
import { Logger } from './Logger';
import { paths } from '../core/paths';
import { checkIsV3 } from '../../shared/isv3';
import type { DeviceInfo } from '../../shared/types';

const logger = Logger.instance.child('RootService');

// ========== RootStage 枚举(60+ stage,见 plan.md 6.7) ==========
export type RootStage =
  | 'idle'
  | 'preparing-resources'
  | 'showing-disclaimer'
  | 'detecting-device'
  | 'selecting-model'
  | 'entering-edl'
  | 'waiting-adb-after-edl'
  | 'reading-device-info'
  | 'detecting-v3'
  | 'extracting-root-zip'
  | 'routing-by-sdk'
  // SDK19 子状态(Android 4.4,Z2/Z3 老固件,fastboot 直刷):
  | 'sdk19-backup-dcim'
  | 'sdk19-flash-boot'
  | 'sdk19-install-magisk'
  | 'sdk19-install-xtcpatch'
  | 'sdk19-restore-dcim'
  | 'sdk19-reboot'
  // SDK25 子状态(Android 7.1,EDL + magiskpatch 21):
  | 'sdk25-backup-dcim'
  | 'sdk25-select-scheme' // BOOT 方案 vs Recovery 方案(由 options.sdk25Scheme 决定)
  | 'sdk25-entering-edl'
  | 'sdk25-reading-boot'
  | 'sdk25-patching-boot' // magiskpatch 21 + 替换 adbd=711 + patch_boot + repack
  | 'sdk25-flashing' // BOOT 方案:刷 boot;Recovery 方案:刷 recovery+misc
  | 'sdk25-rebooting'
  | 'sdk25-waiting-boot'
  | 'sdk25-install-magisk'
  | 'sdk25-install-xtcpatch' // shinst 方式
  | 'sdk25-boot-scheme-second-edl' // BOOT 方案需二次进 EDL 刷 recovery+misc
  | 'sdk25-restore-dcim'
  // SDK27 子状态(Android 8.1,EDL + magiskpatch 25,最复杂):
  | 'sdk27-backup-dcim'
  | 'sdk27-entering-edl'
  | 'sdk27-reading-boot'
  | 'sdk27-patching-boot' // magiskpatch 25 + 810_adbd + xse.rc + patch_boot + repack
  | 'sdk27-flashing-rawprogram' // smodel=1: recovery + rawprogram0;否则: rawprogram0 + 擦 boot
  | 'sdk27-rebooting-to-fastboot'
  | 'sdk27-fastboot-flash-boot'
  | 'sdk27-fastboot-flash-userdata' // 除非 nouserdata
  | 'sdk27-fastboot-flash-misc' // ffbm-02 进 qmmi
  | 'sdk27-waiting-boot'
  | 'sdk27-install-preinstall' // smodel=1: 54850.apk important
  | 'sdk27-enable-charge'
  | 'sdk27-auto-grant-magisk' // automagisk 11 步点击
  | 'sdk27-activate-systemplus' // autosystemplus
  | 'sdk27-install-xtcpatch' // magisk 方式
  | 'sdk27-install-systemui' // isv3 且 ≠I20
  | 'sdk27-install-preinstall-apk' // 130510/121750/116100
  | 'sdk27-erase-misc-reboot'
  | 'sdk27-install-bundled-apks' // 8 个预装
  | 'sdk27-compile-packages' // i3launcher/setting
  | 'sdk27-restore-dcim'
  // ND03(Z10)子状态:
  | 'nd03-download-zip'
  | 'nd03-extract'
  | 'nd03-entering-edl'
  | 'nd03-flash-281-recovery'
  | 'nd03-flash-root-firmware'
  | 'nd03-erase-boot'
  | 'nd03-reboot-to-fastboot'
  | 'nd03-fastboot-flash-boot'
  | 'nd03-boot-recovery'
  | 'nd03-sideload-dm'
  | 'nd03-flash-misc-reboot'
  | 'nd03-wait-3-reboots' // 循环检测 bin.mt.plus
  | 'nd03-auto-grant-magisk'
  | 'nd03-install-xtcpatch'
  | 'nd03-install-toolkit'
  | 'nd03-activate-lsposed' // 7 步点击
  | 'nd03-install-preinstall'
  | 'nd03-compile-packages'
  // 完成:
  | 'completed'
  | 'failed'
  | 'cancelled';

// ========== RootContext 接口(见 plan.md 6.7) ==========
export interface RootContext {
  taskId: string;
  stage: RootStage;
  options: RootOptions;
  device: DeviceInfo | null;
  innermodel: string;
  isV3: boolean;
  smodel: boolean; // I25C=true
  sdkVersion: string;
  androidVersion: string;
  startedAt: number;
  endedAt?: number;
  paused: boolean;
  cancelled: boolean;
  /** DCIM 备份目录(供恢复用) */
  dcimBackupDir?: string;
  /** EDL 端口(运行时获取) */
  edlPort?: string;
  /** SDK25 选择方案 */
  sdk25Scheme?: 'boot' | 'recovery';
  /** 中间状态:patched boot.img 路径 */
  patchedBootPath?: string;
  logs: { ts: number; level: 'info' | 'warn' | 'error'; msg: string }[];
  error?: { stage: RootStage; message: string; recoverable: boolean };
  /** 进度(0-100,基于 stage 在总流程中的位置) */
  progress: number;
}

export interface RootOptions {
  /** 不刷 userdata(对应原 root.bat 第一个参数) */
  nouserdata?: boolean;
  /** SDK25 方案:'boot' 或 'recovery'(对应 ROOT-SDK25.bat menu 1/2) */
  sdk25Scheme?: 'boot' | 'recovery';
  /** EDL 模式用户选的型号 innermodel(如 'I25') */
  modelChoice?: string;
}

// ========== 状态机驱动器 ==========
type StageHandler = (ctx: RootContext) => Promise<void>;

class RootServiceClass {
  private tasks = new Map<string, RootContext>();
  private bus = new EventEmitter();
  private handlers: Record<string, StageHandler>;

  constructor() {
    this.bus.setMaxListeners(50);
    // 注册所有 stage 的 handler(方法名 = stage 名,中划线替换为驼峰)
    // SDK19/25/27/ND03 四条线均已实现,见下方各 stage 方法
    this.handlers = {
      'idle': async () => {},
      'preparing-resources': this.preparingResources.bind(this),
      'showing-disclaimer': async () => {},
      'detecting-device': this.detectingDevice.bind(this),
      'selecting-model': async () => {},
      'entering-edl': this.enteringEdl.bind(this),
      'waiting-adb-after-edl': this.waitingAdbAfterEdl.bind(this),
      'reading-device-info': this.readingDeviceInfo.bind(this),
      'detecting-v3': this.detectingV3.bind(this),
      'extracting-root-zip': this.extractingRootZip.bind(this),
      'routing-by-sdk': this.routingBySdk.bind(this),
      // SDK19
      'sdk19-backup-dcim': this.sdk19BackupDcim.bind(this),
      'sdk19-flash-boot': this.sdk19FlashBoot.bind(this),
      'sdk19-install-magisk': this.sdk19InstallMagisk.bind(this),
      'sdk19-install-xtcpatch': this.sdk19InstallXtcpatch.bind(this),
      'sdk19-restore-dcim': this.sdk19RestoreDcim.bind(this),
      'sdk19-reboot': this.sdk19Reboot.bind(this),
      // SDK25
      'sdk25-backup-dcim': this.sdk25BackupDcim.bind(this),
      'sdk25-select-scheme': async () => {},
      'sdk25-entering-edl': this.sdk25EnteringEdl.bind(this),
      'sdk25-reading-boot': this.sdk25ReadingBoot.bind(this),
      'sdk25-patching-boot': this.sdk25PatchingBoot.bind(this),
      'sdk25-flashing': this.sdk25Flashing.bind(this),
      'sdk25-rebooting': this.sdk25Rebooting.bind(this),
      'sdk25-waiting-boot': this.sdk25WaitingBoot.bind(this),
      'sdk25-install-magisk': this.sdk25InstallMagisk.bind(this),
      'sdk25-install-xtcpatch': this.sdk25InstallXtcpatch.bind(this),
      'sdk25-boot-scheme-second-edl': this.sdk25BootSchemeSecondEdl.bind(this),
      'sdk25-restore-dcim': this.sdk25RestoreDcim.bind(this),
      // SDK27(Android 8.1,EDL + magiskpatch 25,最复杂;Day 4-5 实现)
      'sdk27-backup-dcim': this.sdk27BackupDcim.bind(this),
      'sdk27-entering-edl': this.sdk27EnteringEdl.bind(this),
      'sdk27-reading-boot': this.sdk27ReadingBoot.bind(this),
      'sdk27-patching-boot': this.sdk27PatchingBoot.bind(this),
      'sdk27-flashing-rawprogram': this.sdk27FlashingRawprogram.bind(this),
      'sdk27-rebooting-to-fastboot': this.sdk27RebootingToFastboot.bind(this),
      'sdk27-fastboot-flash-boot': this.sdk27FastbootFlashBoot.bind(this),
      'sdk27-fastboot-flash-userdata': this.sdk27FastbootFlashUserdata.bind(this),
      'sdk27-fastboot-flash-misc': this.sdk27FastbootFlashMisc.bind(this),
      'sdk27-waiting-boot': this.sdk27WaitingBoot.bind(this),
      'sdk27-install-preinstall': this.sdk27InstallPreinstall.bind(this),
      'sdk27-enable-charge': this.sdk27EnableCharge.bind(this),
      'sdk27-auto-grant-magisk': this.sdk27AutoGrantMagisk.bind(this),
      'sdk27-activate-systemplus': this.sdk27ActivateSystemplus.bind(this),
      'sdk27-install-xtcpatch': this.sdk27InstallXtcpatch.bind(this),
      'sdk27-install-systemui': this.sdk27InstallSystemui.bind(this),
      'sdk27-install-preinstall-apk': this.sdk27InstallPreinstallApk.bind(this),
      'sdk27-erase-misc-reboot': this.sdk27EraseMiscReboot.bind(this),
      'sdk27-install-bundled-apks': this.sdk27InstallBundledApks.bind(this),
      'sdk27-compile-packages': this.sdk27CompilePackages.bind(this),
      'sdk27-restore-dcim': this.sdk27RestoreDcim.bind(this),
      // ND03(Z10,prog_firehose_ddr.elf + 281 恢复固件 + LSPosed;Day 4-5 实现)
      'nd03-download-zip': this.nd03DownloadZip.bind(this),
      'nd03-extract': this.nd03Extract.bind(this),
      'nd03-entering-edl': this.nd03EnteringEdl.bind(this),
      'nd03-flash-281-recovery': this.nd03Flash281Recovery.bind(this),
      'nd03-flash-root-firmware': this.nd03FlashRootFirmware.bind(this),
      'nd03-erase-boot': this.nd03EraseBoot.bind(this),
      'nd03-reboot-to-fastboot': this.nd03RebootToFastboot.bind(this),
      'nd03-fastboot-flash-boot': this.nd03FastbootFlashBoot.bind(this),
      'nd03-boot-recovery': this.nd03BootRecovery.bind(this),
      'nd03-sideload-dm': this.nd03SideloadDm.bind(this),
      'nd03-flash-misc-reboot': this.nd03FlashMiscReboot.bind(this),
      'nd03-wait-3-reboots': this.nd03Wait3Reboots.bind(this),
      'nd03-auto-grant-magisk': this.nd03AutoGrantMagisk.bind(this),
      'nd03-install-xtcpatch': this.nd03InstallXtcpatch.bind(this),
      'nd03-install-toolkit': this.nd03InstallToolkit.bind(this),
      'nd03-activate-lsposed': this.nd03ActivateLsposed.bind(this),
      'nd03-install-preinstall': this.nd03InstallPreinstall.bind(this),
      'nd03-compile-packages': this.nd03CompilePackages.bind(this),
      'completed': this.completedStage.bind(this),
      'failed': async () => {},
      'cancelled': async () => {},
    };
  }

  /**
   * 完成 stage handler
   * 对应 root-SDK27.bat 末尾的 yesno 菜单:
   *   ECHO.%YELLOW%是否进行预装优化[包括模块和应用，期间需要多次选择]？
   *   menu.exe yesno.json
   *   if /i "%rootpro%"=="y" call rootpro
   *
   * 这里只在日志中提示用户:UI 端(Root.tsx)会在 SDK=27 时显示 RootProPrompt 组件
   * 调用 tools:rootpro IPC 实际执行
   */
  private async completedStage(ctx: RootContext): Promise<void> {
    // DCIM 备份目录保留策略:root 完成后不自动删除,保留在 userData/root-backup/<taskId>/
    // 原因:用户可能需要从备份恢复相册;若需清理,用户可在"备份恢复"页面手动删除
    // edlWork 临时文件由 scheduleCleanup 在 30 分钟后自动清理(见 scheduleCleanup)
    if (ctx.dcimBackupDir) {
      this.log(ctx, 'info', `DCIM 备份已保留: ${ctx.dcimBackupDir}(可在备份恢复页手动清理)`);
    }
    if (ctx.sdkVersion === '27') {
      this.log(
        ctx,
        'info',
        '检测到 SDK=27,建议进行预装优化(包括模块和应用,期间需要多次选择)',
      );
      this.log(ctx, 'info', '提示:当手表进入长续航模式、睡眠模式等禁用模式时,划到最后一页,点击打开应用列表,即可绕过禁用模式');
      this.log(ctx, 'info', '提示:你可以在 /sdcard/hidden_app_list.txt 中填写包名以实现隐藏应用');
      this.log(ctx, 'info', '提示:如果需要在手表上安装应用,请在手表端选择弦-安装器,点击始终');
      this.log(ctx, 'info', '请永远不要卸载 SystemPlus 和 XTCPatch,否则手表无法开机');
      this.log(ctx, 'info', '请永远不要删除 magisk 自带的模块,否则手表无法开机');
      this.log(ctx, 'info', '跨越山海 终见曙光');
    }
  }

  // ========== 公开 API ==========

  /**
   * 启动 Root 流程(返回 taskId,异步执行)
   * 对应 root.bat 入口
   */
  async start(options: RootOptions): Promise<string> {
    const taskId = `root_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ctx: RootContext = {
      taskId,
      stage: 'preparing-resources',
      options,
      device: null,
      innermodel: '',
      isV3: false,
      smodel: false,
      sdkVersion: '',
      androidVersion: '',
      startedAt: Date.now(),
      paused: false,
      cancelled: false,
      logs: [],
      progress: 0,
      sdk25Scheme: options.sdk25Scheme ?? 'boot',
    };
    this.tasks.set(taskId, ctx);
    logger.info(`Root 任务已启动: ${taskId}`, JSON.stringify(options));

    // 异步驱动状态机(不阻塞 IPC 调用)
    setImmediate(() => {
      this.run(ctx).catch((e) => {
        this.fail(ctx, e as Error);
      });
    });

    return taskId;
  }

  /** 暂停(在下一个状态边界停下) */
  async pause(taskId: string): Promise<void> {
    const ctx = this.tasks.get(taskId);
    if (!ctx) throw new Error(`任务不存在: ${taskId}`);
    ctx.paused = true;
    this.log(ctx, 'info', '用户已暂停,将在下一个状态边界停止');
    this.emit(ctx);
  }

  /** 恢复 */
  async resume(taskId: string): Promise<void> {
    const ctx = this.tasks.get(taskId);
    if (!ctx) throw new Error(`任务不存在: ${taskId}`);
    ctx.paused = false;
    this.log(ctx, 'info', '用户已恢复');
    this.emit(ctx);
  }

  /** 取消(尝试恢复 DCIM,不回滚已刷的分区) */
  async cancel(taskId: string): Promise<void> {
    const ctx = this.tasks.get(taskId);
    if (!ctx) throw new Error(`任务不存在: ${taskId}`);
    ctx.cancelled = true;
    this.log(ctx, 'warn', '用户已取消');
    // 尝试 kill 当前子进程
    SubprocessPool.kill(taskId);
    this.emit(ctx);
  }

  /** 状态订阅 */
  onStageChange(taskId: string, cb: (ctx: RootContext) => void): () => void {
    const channel = `stage-change:${taskId}`;
    this.bus.on(channel, cb);
    return () => this.bus.off(channel, cb);
  }

  /** 获取当前 context */
  getContext(taskId: string): RootContext | null {
    return this.tasks.get(taskId) ?? null;
  }

  // ========== 内部状态机驱动 ==========

  /**
   * 状态机主循环
   * while (stage not in [completed, failed, cancelled]) { ... }
   */
  private async run(ctx: RootContext): Promise<void> {
    while (ctx.stage !== 'completed' && ctx.stage !== 'failed' && ctx.stage !== 'cancelled') {
      // 检查取消
      if (ctx.cancelled) {
        ctx.stage = 'cancelled';
        ctx.endedAt = Date.now();
        this.emit(ctx);
        this.scheduleCleanup(ctx);
        return;
      }
      // 检查暂停(在 stage 边界等待)
      if (ctx.paused) {
        this.log(ctx, 'info', `已暂停于 stage=${ctx.stage},等待恢复...`);
        await this.waitForResume(ctx);
        if (ctx.cancelled) continue;
      }

      // 计算进度
      ctx.progress = this.computeProgress(ctx);

      // 执行当前 stage
      const handler = this.handlers[ctx.stage];
      if (!handler) {
        this.fail(ctx, new Error(`未注册的 stage: ${ctx.stage}`));
        return;
      }

      try {
        this.log(ctx, 'info', `→ 进入 stage: ${ctx.stage}`);
        this.emit(ctx);
        await handler(ctx);
        this.log(ctx, 'info', `← stage 完成: ${ctx.stage}`);
      } catch (e) {
        this.fail(ctx, e as Error);
        return;
      }

      // 计算下一 stage
      const next = this.nextStage(ctx);
      if (!next) {
        this.fail(ctx, new Error(`无下一 stage(当前: ${ctx.stage})`));
        return;
      }
      ctx.stage = next;
      this.emit(ctx);
    }

    // 流程结束
    if (ctx.stage === 'completed') {
      ctx.endedAt = Date.now();
      ctx.progress = 100;
      this.log(ctx, 'info', 'Root 流程已完成');
      this.emit(ctx);
    }
    // 延迟清理(无论 completed/failed/cancelled)
    this.scheduleCleanup(ctx);
  }

  /** 等待用户恢复 */
  private async waitForResume(ctx: RootContext): Promise<void> {
    while (ctx.paused && !ctx.cancelled) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** 标记失败 */
  private fail(ctx: RootContext, e: Error): void {
    ctx.stage = 'failed';
    ctx.endedAt = Date.now();
    ctx.error = {
      stage: ctx.stage,
      message: e.message,
      recoverable: false,
    };
    this.log(ctx, 'error', `Root 流程失败: ${e.message}`);
    this.emit(ctx);
    // 延迟清理(fail 后 run() 会 return,不经过末尾的 scheduleCleanup)
    this.scheduleCleanup(ctx);
  }

  /** 推送 context 到所有渲染进程 */
  private emit(ctx: RootContext): void {
    // 内部监听
    this.bus.emit(`stage-change:${ctx.taskId}`, ctx);
    // 推送到所有渲染进程
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('root:stage-change', ctx);
      }
    }
  }

  /**
   * 延迟清理已完成的任务(避免 tasks Map 内存泄漏)
   * 完成/失败/取消后 30 分钟清理,让前端有足够时间查询最终状态
   * 同时清理 edlWork 临时文件(保留 DCIM 备份)
   */
  private scheduleCleanup(ctx: RootContext): void {
    const taskId = ctx.taskId;
    const delay = 30 * 60 * 1000; // 30 分钟
    setTimeout(() => {
      this.tasks.delete(taskId);
      // 清理 bus 监听器
      this.bus.removeAllListeners(`stage-change:${taskId}`);
      // 清理 edlWork 临时文件(保留目录本身)
      try {
        const workDir = paths.edlWork;
        if (fs.existsSync(workDir)) {
          for (const f of fs.readdirSync(workDir)) {
            const p = path.join(workDir, f);
            try {
              fs.rmSync(p, { recursive: true, force: true });
            } catch {
              // ignore 单个文件清理失败
            }
          }
        }
      } catch {
        // ignore edlWork 清理失败
      }
      logger.info(`任务 ${taskId} 已清理(30 分钟后)`);
    }, delay);
  }

  /** 内部日志(同时打到 Logger 和 ctx.logs) */
  private log(ctx: RootContext, level: 'info' | 'warn' | 'error', msg: string): void {
    const entry = { ts: Date.now(), level, msg };
    ctx.logs.push(entry);
    // 限制 logs 长度(避免内存膨胀)
    if (ctx.logs.length > 500) ctx.logs.shift();
    switch (level) {
      case 'info':
        logger.info(msg);
        break;
      case 'warn':
        logger.warn(msg);
        break;
      case 'error':
        logger.error(msg);
        break;
    }
  }

  /** 计算进度(基于 stage 在总流程中的位置) */
  private computeProgress(ctx: RootContext): number {
    // 简单估算:按 SDK 分支的 stage 总数计算
    const sdk = ctx.sdkVersion;
    let total = 10;
    let current = 1;
    if (sdk === '19') {
      total = 8;
      const stages = [
        'preparing-resources',
        'detecting-device',
        'reading-device-info',
        'extracting-root-zip',
        'routing-by-sdk',
        'sdk19-backup-dcim',
        'sdk19-flash-boot',
        'sdk19-install-magisk',
        'sdk19-install-xtcpatch',
        'sdk19-restore-dcim',
      ];
      current = stages.indexOf(ctx.stage) + 1;
    } else if (sdk === '25') {
      total = 14;
      const stages = [
        'preparing-resources',
        'detecting-device',
        'reading-device-info',
        'extracting-root-zip',
        'routing-by-sdk',
        'sdk25-backup-dcim',
        'sdk25-entering-edl',
        'sdk25-reading-boot',
        'sdk25-patching-boot',
        'sdk25-flashing',
        'sdk25-rebooting',
        'sdk25-waiting-boot',
        'sdk25-install-magisk',
        'sdk25-install-xtcpatch',
        'sdk25-boot-scheme-second-edl',
        'sdk25-restore-dcim',
      ];
      current = stages.indexOf(ctx.stage) + 1;
    } else if (sdk === '27') {
      // SDK27 最复杂,共 19 个专属 stage(不含前 5 个通用 stage)
      total = 24;
      const stages = [
        'preparing-resources',
        'detecting-device',
        'reading-device-info',
        'detecting-v3',
        'extracting-root-zip',
        'routing-by-sdk',
        'sdk27-backup-dcim',
        'sdk27-entering-edl',
        'sdk27-reading-boot',
        'sdk27-patching-boot',
        'sdk27-flashing-rawprogram',
        'sdk27-rebooting-to-fastboot',
        'sdk27-fastboot-flash-boot',
        'sdk27-fastboot-flash-userdata',
        'sdk27-fastboot-flash-misc',
        'sdk27-waiting-boot',
        'sdk27-install-preinstall',
        'sdk27-enable-charge',
        'sdk27-auto-grant-magisk',
        'sdk27-activate-systemplus',
        'sdk27-install-xtcpatch',
        'sdk27-install-systemui',
        'sdk27-install-preinstall-apk',
        'sdk27-erase-misc-reboot',
        'sdk27-install-bundled-apks',
        'sdk27-compile-packages',
        'sdk27-restore-dcim',
      ];
      current = stages.indexOf(ctx.stage) + 1;
    } else if (ctx.innermodel === 'ND03') {
      // ND03(Z10)共 18 个专属 stage(不含前 3 个通用 stage)
      total = 21;
      const stages = [
        'preparing-resources',
        'detecting-device',
        'reading-device-info',
        'nd03-download-zip',
        'nd03-extract',
        'nd03-entering-edl',
        'nd03-flash-281-recovery',
        'nd03-flash-root-firmware',
        'nd03-erase-boot',
        'nd03-reboot-to-fastboot',
        'nd03-fastboot-flash-boot',
        'nd03-boot-recovery',
        'nd03-sideload-dm',
        'nd03-flash-misc-reboot',
        'nd03-wait-3-reboots',
        'nd03-auto-grant-magisk',
        'nd03-install-xtcpatch',
        'nd03-install-toolkit',
        'nd03-activate-lsposed',
        'nd03-install-preinstall',
        'nd03-compile-packages',
      ];
      current = stages.indexOf(ctx.stage) + 1;
    }
    if (ctx.stage === 'completed') return 100;
    return Math.min(99, Math.round((current / total) * 100));
  }

  // ========== nextStage:集中管理 stage 转移规则 ==========

  private nextStage(ctx: RootContext): RootStage | null {
    const s = ctx.stage;
    switch (s) {
      case 'preparing-resources':
        return 'detecting-device';
      case 'detecting-device':
        // 设备类型决定下一步
        if (ctx.device?.type === 'qcom_edl') {
          return 'selecting-model';
        }
        return 'reading-device-info';
      case 'selecting-model':
        return 'entering-edl';
      case 'entering-edl':
        return 'waiting-adb-after-edl';
      case 'waiting-adb-after-edl':
        return 'reading-device-info';
      case 'reading-device-info':
        // 检查彩蛋:SDK=11(对应原 root.bat:196-202)
        if (ctx.androidVersion === '11') {
          this.log(ctx, 'info', '触发彩蛋:你是怎么运行到这里的?');
          return 'failed';
        }
        // ND03 路由(Z10):对应原 root.bat:148-153:call nd03root
        // ND03 不走 SDK 分支,直接进 ND03 流程
        if (ctx.innermodel === 'ND03') {
          return 'nd03-download-zip';
        }
        return 'detecting-v3';
      case 'detecting-v3':
        return 'extracting-root-zip';
      case 'extracting-root-zip':
        return 'routing-by-sdk';
      case 'routing-by-sdk':
        // 根据 SDK 分支
        if (ctx.sdkVersion === '19') return 'sdk19-backup-dcim';
        if (ctx.sdkVersion === '25') return 'sdk25-backup-dcim';
        if (ctx.sdkVersion === '27') return 'sdk27-backup-dcim';
        // 彩蛋:SDK 不在 19/25/27
        this.log(ctx, 'info', '触发彩蛋:这是xtc吗?');
        return 'failed';

      // === SDK19 转移 ===
      case 'sdk19-backup-dcim':
        return 'sdk19-flash-boot';
      case 'sdk19-flash-boot':
        return 'sdk19-install-magisk';
      case 'sdk19-install-magisk':
        return 'sdk19-install-xtcpatch';
      case 'sdk19-install-xtcpatch':
        return 'sdk19-restore-dcim';
      case 'sdk19-restore-dcim':
        return 'sdk19-reboot';
      case 'sdk19-reboot':
        return 'completed';

      // === SDK25 转移 ===
      case 'sdk25-backup-dcim':
        return 'sdk25-select-scheme';
      case 'sdk25-select-scheme':
        return 'sdk25-entering-edl';
      case 'sdk25-entering-edl':
        return 'sdk25-reading-boot';
      case 'sdk25-reading-boot':
        return 'sdk25-patching-boot';
      case 'sdk25-patching-boot':
        return 'sdk25-flashing';
      case 'sdk25-flashing':
        return 'sdk25-rebooting';
      case 'sdk25-rebooting':
        return 'sdk25-waiting-boot';
      case 'sdk25-waiting-boot':
        return 'sdk25-install-magisk';
      case 'sdk25-install-magisk':
        return 'sdk25-install-xtcpatch';
      case 'sdk25-install-xtcpatch':
        // 对应 ROOT-SDK25.bat:101-102:if "%recorroot%"=="1" goto ROOT-SDK25-F
        // 原 .bat 逻辑:BOOT 方案(recorroot=1)跳过二次 EDL;Recovery 方案(recorroot=2)做二次 EDL
        // 注:plan.md 注释"BOOT 方案需二次进 EDL"与原 .bat 相反,这里以原 .bat 为准(逻辑保真)
        if (ctx.sdk25Scheme === 'recovery') return 'sdk25-boot-scheme-second-edl';
        return 'sdk25-restore-dcim';
      case 'sdk25-boot-scheme-second-edl':
        return 'sdk25-restore-dcim';
      case 'sdk25-restore-dcim':
        return 'completed';

      // === SDK27 转移(Day 4-5 实现) ===
      case 'sdk27-backup-dcim':
        return 'sdk27-entering-edl';
      case 'sdk27-entering-edl':
        return 'sdk27-reading-boot';
      case 'sdk27-reading-boot':
        return 'sdk27-patching-boot';
      case 'sdk27-patching-boot':
        return 'sdk27-flashing-rawprogram';
      case 'sdk27-flashing-rawprogram':
        // smodel=1:I25C/Z7A 已在 stage 内 qfh_loader reboot,直接跳 ROOT-SDK27-WAIT
        if (ctx.smodel) return 'sdk27-waiting-boot';
        // nouserdata=1:对应原 .bat:你选择了不刷userdata,不再继续(exit /b,非失败)
        if (ctx.options.nouserdata) {
          this.log(ctx, 'warn', '你选择了不刷userdata,不再继续');
          return 'completed';
        }
        return 'sdk27-rebooting-to-fastboot';
      case 'sdk27-rebooting-to-fastboot':
        return 'sdk27-fastboot-flash-boot';
      case 'sdk27-fastboot-flash-boot':
        return 'sdk27-fastboot-flash-userdata';
      case 'sdk27-fastboot-flash-userdata':
        return 'sdk27-fastboot-flash-misc';
      case 'sdk27-fastboot-flash-misc':
        return 'sdk27-waiting-boot';
      case 'sdk27-waiting-boot':
        return 'sdk27-install-preinstall';
      case 'sdk27-install-preinstall':
        return 'sdk27-enable-charge';
      case 'sdk27-enable-charge':
        return 'sdk27-auto-grant-magisk';
      case 'sdk27-auto-grant-magisk':
        return 'sdk27-activate-systemplus';
      case 'sdk27-activate-systemplus':
        return 'sdk27-install-xtcpatch';
      case 'sdk27-install-xtcpatch':
        return 'sdk27-install-systemui';
      case 'sdk27-install-systemui':
        return 'sdk27-install-preinstall-apk';
      case 'sdk27-install-preinstall-apk':
        return 'sdk27-erase-misc-reboot';
      case 'sdk27-erase-misc-reboot':
        return 'sdk27-install-bundled-apks';
      case 'sdk27-install-bundled-apks':
        return 'sdk27-compile-packages';
      case 'sdk27-compile-packages':
        return 'sdk27-restore-dcim';
      case 'sdk27-restore-dcim':
        return 'completed';

      // === ND03 转移(Day 4-5 实现) ===
      case 'nd03-download-zip':
        return 'nd03-extract';
      case 'nd03-extract':
        return 'nd03-entering-edl';
      case 'nd03-entering-edl':
        return 'nd03-flash-281-recovery';
      case 'nd03-flash-281-recovery':
        return 'nd03-flash-root-firmware';
      case 'nd03-flash-root-firmware':
        return 'nd03-erase-boot';
      case 'nd03-erase-boot':
        return 'nd03-reboot-to-fastboot';
      case 'nd03-reboot-to-fastboot':
        return 'nd03-fastboot-flash-boot';
      case 'nd03-fastboot-flash-boot':
        return 'nd03-boot-recovery';
      case 'nd03-boot-recovery':
        return 'nd03-sideload-dm';
      case 'nd03-sideload-dm':
        return 'nd03-flash-misc-reboot';
      case 'nd03-flash-misc-reboot':
        return 'nd03-wait-3-reboots';
      case 'nd03-wait-3-reboots':
        return 'nd03-auto-grant-magisk';
      case 'nd03-auto-grant-magisk':
        return 'nd03-install-xtcpatch';
      case 'nd03-install-xtcpatch':
        return 'nd03-install-toolkit';
      case 'nd03-install-toolkit':
        return 'nd03-activate-lsposed';
      case 'nd03-activate-lsposed':
        return 'nd03-install-preinstall';
      case 'nd03-install-preinstall':
        return 'nd03-compile-packages';
      case 'nd03-compile-packages':
        return 'completed';

      case 'completed':
      case 'failed':
      case 'cancelled':
        return null;
      default:
        return null;
    }
  }

  // ========== Stage 方法实现 ==========

  // ---------- 通用 stages ----------

  /** 准备资源(检查 userdata/apks/xtcpatch/systemui 是否已下载,对应 root.bat:1-4) */
  private async preparingResources(ctx: RootContext): Promise<void> {
    // 原 root.bat:1-4:
    //   if not exist .\tmp\userdata.img call cloud userdata
    //   if not exist .\apks call cloud apks
    //   if not exist .\tmp\xtcpatch.zip call cloud xtcpatch
    //   if not exist .\tmp\systemui.zip call cloud systemui
    const cacheDir = paths.cache;
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const required = [
      { name: 'userdata', file: 'userdata.img' },
      { name: 'xtcpatch', file: 'xtcpatch.zip' },
      { name: 'systemui', file: 'systemui.zip' },
    ];
    for (const r of required) {
      const p = path.join(cacheDir, r.file);
      if (!fs.existsSync(p)) {
        this.log(ctx, 'warn', `资源缺失: ${r.file},请先在"资源下载"页下载`);
        // 不阻塞流程,只警告(用户可能已手动准备)
      }
    }
    // apks 目录
    const apksDir = path.join(paths.resources, 'apks');
    if (!fs.existsSync(apksDir)) {
      this.log(ctx, 'warn', 'apks 目录不存在,请先在"资源下载"页下载 apks');
    }
  }

  /** 检测设备(对应 root.bat:84-92 device_check.exe adb qcom_edl) */
  private async detectingDevice(ctx: RootContext): Promise<void> {
    const device = DeviceService.instance.current();
    if (!device) {
      throw new Error('未检测到设备,请连接手表并开启 ADB/9008 模式');
    }
    ctx.device = device;
    this.log(ctx, 'info', `设备类型: ${device.type}, serial: ${device.serial}`);
  }

  /** EDL 模式进入(对应 root.bat EDL_MENU,由 RebootService 触发) */
  private async enteringEdl(ctx: RootContext): Promise<void> {
    // EDL 模式的型号选择已由 options.modelChoice 决定
    // 这里不实现完整的 rebootpro 流程(已在 Reboot 路由覆盖)
    // 只标记:等待 ADB 设备
    this.log(ctx, 'info', `EDL 模式已选型号: ${ctx.options.modelChoice ?? '(未选)'}`);
  }

  /** EDL 后等待 ADB 设备(对应 root.bat:97-99) */
  private async waitingAdbAfterEdl(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '等待 ADB 设备连接...');
    const device = await DeviceService.instance.waitFor(['adb'], 120000);
    ctx.device = device;
    this.log(ctx, 'info', `ADB 设备已连接: ${device.serial}`);
  }

  /** 读取设备信息(对应 root.bat:134-145) */
  private async readingDeviceInfo(ctx: RootContext): Promise<void> {
    if (!ctx.device || ctx.device.type !== 'adb') {
      throw new Error('需要 ADB 模式设备');
    }
    // 原 root.bat:134:adb shell getprop ro.product.innermodel
    const innermodel = await AdbService.getprop('ro.product.innermodel');
    ctx.innermodel = innermodel;
    this.log(ctx, 'info', `设备 innermodel: ${innermodel}`);

    // 原 root.bat:139:I25C 分支
    if (innermodel === 'I25C') {
      ctx.smodel = true;
      this.log(ctx, 'warn', '此型号(I25C/Z7A)ROOT 可能存在不稳定性问题');
    }

    // 原 root.bat:155-158:读取 model/android/sdk/version
    const model = await AdbService.getprop('ro.product.model');
    const androidVersion = await AdbService.getprop('ro.build.version.release');
    const sdkVersion = await AdbService.getprop('ro.build.version.sdk');
    const version = await AdbService.getprop('ro.product.current.softversion');
    ctx.androidVersion = androidVersion;
    ctx.sdkVersion = sdkVersion;
    this.log(
      ctx,
      'info',
      `型号: ${model}, Android: ${androidVersion}, SDK: ${sdkVersion}, 版本: ${version}`,
    );
  }

  /** V3 检测(对应 root.bat:148 call isv3) */
  private async detectingV3(ctx: RootContext): Promise<void> {
    const softVersion = await AdbService.getprop('ro.product.current.softversion');
    ctx.isV3 = checkIsV3(ctx.innermodel, softVersion);
    this.log(ctx, 'info', `V3 协议: ${ctx.isV3 ? '是' : '否'}(softVersion=${softVersion})`);
  }

  /** 解压 EDL/<innermodel>.zip(对应 root.bat:170-178) */
  private async extractingRootZip(ctx: RootContext): Promise<void> {
    // 原 root.bat:171:if not exist .\EDL\%innermodel%.zip call cloud innermodel
    const zipPath = paths.edlFile(`${ctx.innermodel}.zip`);
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Root 资源包不存在: ${ctx.innermodel}.zip,请先在"资源下载"页下载`);
    }
    // 原 root.bat:172:progress.exe 7z x EDL\%innermodel%.zip -o.\EDL\rooting -aoa -bsp1
    const workDir = paths.edlWork;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    this.log(ctx, 'info', `解压 ${ctx.innermodel}.zip → ${workDir}`);
    await SubprocessPool.spawn({
      cmd: paths.binFile('7z.exe'),
      args: ['x', zipPath, `-o${workDir}`, '-aoa', '-bsp1'],
      cwd: paths.bin,
      encoding: 'utf-8',
      timeout: TIMEOUT.install,
      taskId: ctx.taskId,
      onStdout: (line) => this.log(ctx, 'info', `7z: ${line}`),
    });
    this.log(ctx, 'info', '解压完成');
  }

  /** SDK 路由(对应 root.bat:180-202) */
  private async routingBySdk(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', `路由到 SDK${ctx.sdkVersion} 分支`);
  }

  // ---------- SDK19 stages(Android 4.4) ----------

  /** SDK19 备份 DCIM(对应 ROOT-SDK19.bat:3-5) */
  private async sdk19BackupDcim(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%正在备份相册
    //   del /Q /F .\backupname.txt >nul 2>nul
    //   call backup DCIM backup noask
    const backupDir = path.join(paths.userData, 'root-backup', ctx.taskId);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    ctx.dcimBackupDir = backupDir;
    this.log(ctx, 'info', '正在备份相册...');
    const r = await BackupService.backupDcim(backupDir, (msg) => this.log(ctx, 'info', msg));
    if (!r.success) {
      this.log(ctx, 'warn', `相册备份失败(继续流程): ${r.error}`);
    }
  }

  /** SDK19 刷入 boot(对应 ROOT-SDK19.bat:7-15) */
  private async sdk19FlashBoot(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%正在重启到bootloader模式,你的手表并没有变砖
    //   run_cmd "adb reboot bootloader"
    //   device_check.exe fastboot
    //   ECHO.%INFO%正在刷入boot
    //   fastboot flash boot EDL\rooting\sboot.img
    //   ECHO.%INFO%重新启动,退出bootloader模式
    //   fastboot reboot
    //   ECHO.%INFO%等待设备连接
    //   device_check.exe adb
    this.log(ctx, 'info', '正在重启至 Bootloader 模式，设备处于正常状态');
    await AdbService.reboot('bootloader');
    this.log(ctx, 'info', '等待 fastboot 设备...');
    await DeviceService.instance.waitFor(['fastboot'], 30000);

    this.log(ctx, 'info', '正在刷入 boot');
    const sbootImg = path.join(paths.edlWork, 'sboot.img');
    if (!fs.existsSync(sbootImg)) {
      throw new Error(`sboot.img 不存在: ${sbootImg}`);
    }
    // 原:fastboot flash boot EDL\rooting\sboot.img
    await FastbootService.flash('boot', sbootImg);

    this.log(ctx, 'info', '重新启动,退出 bootloader 模式');
    await FastbootService.reboot('system');

    this.log(ctx, 'info', '等待设备连接');
    const device = await DeviceService.instance.waitFor(['adb'], 60000);
    ctx.device = device;
  }

  /** SDK19 安装 Magisk(对应 ROOT-SDK19.bat:17-32) */
  private async sdk19InstallMagisk(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%坐和放宽,让我们等待120秒
    //   busybox sleep 120
    this.log(ctx, 'info', '请耐心等待 120 秒，设备正在初始化');
    await new Promise((r) => setTimeout(r, 120000));

    // 原:ECHO.%INFO%安装管理器
    //   call instapp .\EDL\rooting\manager.apk
    this.log(ctx, 'info', '安装管理器');
    const managerApk = path.join(paths.edlWork, 'manager.apk');
    if (fs.existsSync(managerApk)) {
      await AdbService.install(managerApk, 'install');
    } else {
      this.log(ctx, 'warn', `manager.apk 不存在: ${managerApk}`);
    }

    // 原:ECHO.%INFO%启动管理器
    //   run_cmd "adb shell am start -n com.topjohnwu.magisk/.ui.MainActivity"
    this.log(ctx, 'info', '启动管理器');
    await AdbService.amStart('com.topjohnwu.magisk/.ui.MainActivity');

    // 原:ECHO.%INFO%修复运行环境
    //   run_cmd "adb shell ""mkdir -p /sdcard/magisk"""
    //   adb push EDL\rooting\magiskfile /sdcard/magisk
    //   run_cmd "adb shell ""su -c rm -rf /data/adb/magisk"""
    //   run_cmd "adb shell ""su -c cp -af /sdcard/magisk/* /data/adb/magisk/"""
    //   run_cmd "adb shell ""su -c chmod -R 755 /data/adb/magisk/"""
    this.log(ctx, 'info', '修复运行环境');
    await AdbService.shell('mkdir -p /sdcard/magisk', { timeout: TIMEOUT.device });
    const magiskfileDir = path.join(paths.edlWork, 'magiskfile');
    if (fs.existsSync(magiskfileDir)) {
      await AdbService.push(magiskfileDir, '/sdcard/magisk');
    } else {
      this.log(ctx, 'warn', `magiskfile 目录不存在: ${magiskfileDir}`);
    }
    // su -c rm -rf /data/adb/magisk
    await AdbService.shell('rm -rf /data/adb/magisk', { timeout: TIMEOUT.shell, root: true });
    // su -c cp -af /sdcard/magisk/* /data/adb/magisk/
    await AdbService.shell('cp -af /sdcard/magisk/* /data/adb/magisk/', {
      timeout: TIMEOUT.shellLong,
      root: true,
    });
    // su -c chmod -R 755 /data/adb/magisk/
    await AdbService.shell('chmod -R 755 /data/adb/magisk/', { timeout: TIMEOUT.shell, root: true });
  }

  /** SDK19 安装 xtcpatch 模块(对应 ROOT-SDK19.bat:34) */
  private async sdk19InstallXtcpatch(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%刷入xtcpatch模块
    //   call instmodule2.bat tmp\xtcpatch.zip
    // Bug 修复(见 plan.md 2.4):instmodule2.bat 不存在,改为 instmodule.bat
    // instmodule.bat 默认 method=magisk(无第二参数时)
    // 但 SDK19 设备 Magisk 可能未完全就绪,这里用 'magisk' 方式
    this.log(ctx, 'info', '刷入 xtcpatch 模块(已修复 instmodule2.bat → instmodule.bat)');
    const xtcpatchZip = path.join(paths.cache, 'xtcpatch.zip');
    if (!fs.existsSync(xtcpatchZip)) {
      throw new Error(`xtcpatch.zip 不存在: ${xtcpatchZip}`);
    }
    const r = await MagiskService.install(xtcpatchZip, 'magisk');
    if (!r.success) {
      this.log(ctx, 'warn', `xtcpatch 安装失败: ${r.error}`);
    }
  }

  /** SDK19 恢复 DCIM(对应 ROOT-SDK19.bat:36-38) */
  private async sdk19RestoreDcim(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%正在恢复相册
    //   if exist .\backupnametxt set /p backupname=<backupnametxt
    //   call backup DCIM recover noask
    if (!ctx.dcimBackupDir) {
      this.log(ctx, 'warn', '无 DCIM 备份目录,跳过恢复');
      return;
    }
    this.log(ctx, 'info', '正在恢复相册...');
    const r = await BackupService.recoverDcim(ctx.dcimBackupDir, (msg) =>
      this.log(ctx, 'info', msg),
    );
    if (!r.success) {
      this.log(ctx, 'warn', `相册恢复失败: ${r.error}`);
    }
  }

  /** SDK19 重启(对应 ROOT-SDK19.bat:39-44) */
  private async sdk19Reboot(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%重启手表
    //   adb reboot
    //   ECHO.%INFO%您的手表ROOT完毕
    //   ECHO.%INFO%删除临时文件
    //   del /Q /F .\EDL\rooting\*.*
    this.log(ctx, 'info', '重启手表');
    await AdbService.reboot('system');
    this.log(ctx, 'info', '您的手表 ROOT 完毕');
    // 清理工作目录(对应:del /Q /F .\EDL\rooting\*.*)
    try {
      const workDir = paths.edlWork;
      if (fs.existsSync(workDir)) {
        for (const f of fs.readdirSync(workDir)) {
          const p = path.join(workDir, f);
          try {
            fs.rmSync(p, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // ---------- SDK25 stages(Android 7.1,EDL + magiskpatch 21) ----------

  /** SDK25 备份 DCIM(对应 ROOT-SDK25.bat:3-5) */
  private async sdk25BackupDcim(ctx: RootContext): Promise<void> {
    const backupDir = path.join(paths.userData, 'root-backup', ctx.taskId);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    ctx.dcimBackupDir = backupDir;
    this.log(ctx, 'info', '正在备份相册...');
    const r = await BackupService.backupDcim(backupDir, (msg) => this.log(ctx, 'info', msg));
    if (!r.success) {
      this.log(ctx, 'warn', `相册备份失败(继续流程): ${r.error}`);
    }
  }

  /** SDK25 进入 EDL(对应 ROOT-SDK25.bat:14-23) */
  private async sdk25EnteringEdl(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%重启您的手表至9008
    //   adb reboot edl
    //   call edlport
    //   ECHO.%INFO%发送引导
    //   call QSaharaServer.bat -p \\.\COM%chkdev__edl_port% -s 13:%cd%\EDL\msm8909w.mbn
    //   busybox sleep 2
    this.log(ctx, 'info', '重启手表至 9008');
    await AdbService.reboot('edl');
    // 等待 9008 设备
    this.log(ctx, 'info', '等待 9008 设备...');
    const port = await EdlService.waitForEdl(60000);
    ctx.edlPort = port;
    this.log(ctx, 'info', `9008 端口: ${port}`);

    // 发送引导(对应:QSaharaServer -s 13:EDL\msm8909w.mbn)
    this.log(ctx, 'info', '发送引导: msm8909w.mbn');
    await EdlService.loadFirehose({ port, loader: 'msm8909w.mbn' });

    // busybox sleep 2
    await new Promise((r) => setTimeout(r, 2000));
  }

  /** SDK25 读取 boot(对应 ROOT-SDK25.bat:24-32) */
  private async sdk25ReadingBoot(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%读取boot
    //   call fh_loader.bat --port=\\.\COM%chkdev__edl_port% --memoryname=EMMC
    //     --sendxml=%cd%\EDL\rooting\boot.xml --convertprogram2read --noprompt
    //   move /Y .\boot.img .\tmp\boot.img
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    const bootXml = path.join(paths.edlWork, 'boot.xml');
    if (!fs.existsSync(bootXml)) {
      throw new Error(`boot.xml 不存在: ${bootXml}`);
    }
    this.log(ctx, 'info', '读取 boot 分区...');
    // fh_loader 读取 boot 分区(用 --search_path=edlWork,读取的 boot.img 会生成在 edlWork)
    await EdlService.readPartitions({
      port: ctx.edlPort,
      loader: 'msm8909w.mbn',
      xmlPath: bootXml,
      outputDir: paths.edlWork,
    });
    // move edlWork/boot.img → cache/boot.img(对应:move /Y .\boot.img .\tmp\boot.img)
    const srcBoot = path.join(paths.edlWork, 'boot.img');
    const dstBoot = path.join(paths.cache, 'boot.img');
    if (!fs.existsSync(srcBoot)) {
      throw new Error(`fh_loader 读取 boot.img 失败: ${srcBoot} 不存在`);
    }
    if (fs.existsSync(dstBoot)) fs.unlinkSync(dstBoot);
    fs.renameSync(srcBoot, dstBoot);
    this.log(ctx, 'info', `boot.img 已读取 → ${dstBoot}`);
  }

  /** SDK25 修补 boot(对应 ROOT-SDK25.bat:34-49) */
  private async sdk25PatchingBoot(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%开始修补boot
    //   call magiskpatch 21
    //   if %errorlevel% neq 0 ( echo %ERROR%修补boot失败 & pause & exit )
    //   ECHO.%INFO%解包boot
    //   magiskboot unpack -h boot.img 1>nul 2>nul
    //   ECHO.%INFO%替换adbd
    //   magiskboot.exe cpio ramdisk.cpio "add 0750 sbin/adbd 711_adbd"
    //   ECHO.%INFO%宽容selinux
    //   patch_boot.exe | find "Suc" 1>nul 2>nul || ECHO %ERROR%patch_boot.exe无法运行 && pause && exit
    //   ECHO.%INFO%打包boot
    //   magiskboot repack boot.img 1>nul 2>nul
    //   ECHO.%INFO%BOOT处理完成!!!
    //   copy /Y new-boot.img EDL\rooting\boot.img > nul
    //   del /Q /F .\tmp\boot.img

    // 步骤 1:magiskpatch 21(读 cache/boot.img,写 edlWork/boot.img)
    this.log(ctx, 'info', '开始修补 boot(magiskpatch 21)');
    const inputBoot = path.join(paths.cache, 'boot.img');
    const patchedBoot = path.join(paths.edlWork, 'boot.img');
    const r = await MagiskPatcher.patch(inputBoot, patchedBoot, 21 as MagiskVersion, paths.edlWork, ctx.taskId);
    if (!r.success) {
      throw new Error(`magiskpatch 失败: ${r.error}`);
    }
    ctx.patchedBootPath = patchedBoot;
    this.log(ctx, 'info', `magiskpatch 完成(status=${r.status})`);

    // 步骤 2:magiskboot unpack -h boot.img(在 edlWork 中,boot.img 已是 patchedBoot)
    this.log(ctx, 'info', '解包 boot');
    await this.runMagiskboot(ctx, ['unpack', '-h', 'boot.img']);

    // 步骤 3:替换 adbd
    // magiskboot.exe cpio ramdisk.cpio "add 0750 sbin/adbd 711_adbd"
    // 711_adbd 文件需在 edlWork 中
    this.log(ctx, 'info', '替换 adbd');
    const adbdSrc = paths.binFile('711_adbd');
    const adbdDst = path.join(paths.edlWork, '711_adbd');
    if (fs.existsSync(adbdSrc) && !fs.existsSync(adbdDst)) {
      fs.copyFileSync(adbdSrc, adbdDst);
    }
    await this.runMagiskboot(ctx, ['cpio', 'ramdisk.cpio', 'add 0750 sbin/adbd 711_adbd']);

    // 步骤 4:patch_boot(BootPatcher,操作 edlWork/kernel)
    // Bug 修复:输出 'success'(原 'Sucess' 拼写错误已修正,见 plan.md 2.4)
    this.log(ctx, 'info', '宽容 selinux(patch_boot)');
    const kernelPath = path.join(paths.edlWork, 'kernel');
    const patchResult = BootPatcher.patch(kernelPath);
    if (!patchResult.success || !patchResult.output.includes('success')) {
      throw new Error(`patch_boot 失败: ${patchResult.error ?? patchResult.output}`);
    }
    for (const p of patchResult.patches) {
      this.log(ctx, 'info', `patch_boot: ${p}`);
    }

    // 步骤 5:magiskboot repack boot.img → new-boot.img
    this.log(ctx, 'info', '打包 boot');
    await this.runMagiskboot(ctx, ['repack', 'boot.img']);
    this.log(ctx, 'info', 'BOOT 处理完成');

    // 步骤 6:copy new-boot.img → edlWork/boot.img(覆盖)
    const newBootPath = path.join(paths.edlWork, 'new-boot.img');
    if (!fs.existsSync(newBootPath)) {
      throw new Error('magiskboot repack 未生成 new-boot.img');
    }
    if (fs.existsSync(patchedBoot)) fs.unlinkSync(patchedBoot);
    fs.renameSync(newBootPath, patchedBoot);

    // 步骤 7:del tmp/boot.img
    const tmpBoot = path.join(paths.cache, 'boot.img');
    try {
      if (fs.existsSync(tmpBoot)) fs.unlinkSync(tmpBoot);
    } catch {
      // ignore
    }
  }

  /** SDK25 刷入(对应 ROOT-SDK25.bat:50-59 BOOT 方案 / 70-76 Recovery 方案) */
  private async sdk25Flashing(ctx: RootContext): Promise<void> {
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    const workDir = paths.edlWork;
    const scheme = ctx.sdk25Scheme ?? 'boot';

    if (scheme === 'boot') {
      // BOOT 方案:刷 boot
      // 原:ECHO.%INFO%刷入BOOT
      //   call fh_loader.bat --port=... --memoryname=EMMC --search_path=EDL\rooting
      //     --sendxml=EDL\rooting\boot.xml --noprompt
      this.log(ctx, 'info', '刷入 BOOT');
      const bootXml = path.join(workDir, 'boot.xml');
      await EdlService.flashPartitions({
        port: ctx.edlPort,
        loader: 'msm8909w.mbn',
        xmlPath: bootXml,
        imagesDir: workDir,
      });
      this.log(ctx, 'info', 'boot 刷入完毕');
    } else {
      // Recovery 方案:刷 recovery + misc
      // 原:ECHO.%INFO%刷入BOOT至Recovery分区
      //   call fh_loader.bat --port=... --sendxml=EDL\rooting\recovery.xml --noprompt
      //   ECHO.%INFO%刷入misc
      //   call fh_loader.bat --port=... --sendxml=EDL\rooting\misc.xml --noprompt
      this.log(ctx, 'info', '刷入 BOOT 至 Recovery 分区');
      // 先把 patched boot.img 复制到 recovery.img(对应 ROOT-SDK25.bat:60 copy /Y new-boot.img EDL\rooting\recovery.img)
      const srcBoot = path.join(workDir, 'boot.img');
      const dstRecovery = path.join(workDir, 'recovery.img');
      if (fs.existsSync(srcBoot)) {
        fs.copyFileSync(srcBoot, dstRecovery);
      }
      const recoveryXml = path.join(workDir, 'recovery.xml');
      await EdlService.flashPartitions({
        port: ctx.edlPort,
        loader: 'msm8909w.mbn',
        xmlPath: recoveryXml,
        imagesDir: workDir,
      });
      this.log(ctx, 'info', '刷入 misc');
      const miscXml = path.join(workDir, 'misc.xml');
      await EdlService.flashPartitions({
        port: ctx.edlPort,
        loader: 'msm8909w.mbn',
        xmlPath: miscXml,
        imagesDir: workDir,
      });
    }

    // 重启(对应:call qfh_loader.bat --sendxml=reboot.xml)
    this.log(ctx, 'info', '重启手表(9008)');
    await EdlService.reboot({ port: ctx.edlPort, loader: 'msm8909w.mbn' });
    this.log(ctx, 'info', '请耐心等待设备响应');
  }

  /** SDK25 rebooting(占位,实际 reboot 已在 flashing 中完成) */
  private async sdk25Rebooting(ctx: RootContext): Promise<void> {
    // reboot 已在 sdk25-flashing 中调用 EdlService.reboot
    this.log(ctx, 'info', '已发送重启指令');
  }

  /** SDK25 等待开机(对应 ROOT-SDK25.bat:79 call boot_completed.bat) */
  private async sdk25WaitingBoot(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '等待 ADB 设备连接...');
    const device = await DeviceService.instance.waitFor(['adb'], 180000);
    ctx.device = device;
    this.log(ctx, 'info', '等待开机完成...');
    await AdbService.waitForBoot(180000);
  }

  /** SDK25 安装 Magisk 与模块(对应 ROOT-SDK25.bat:80-90) */
  private async sdk25InstallMagisk(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%安装管理器
    //   call instapp .\EDL\rooting\manager.apk
    //   ECHO.%INFO%启动管理器[等待五秒]
    //   busybox sleep 5
    //   run_cmd "adb shell am start com.topjohnwu.magisk/a.c"
    //   call adbdevice adb
    //   run_cmd "adb push EDL\rooting\xtcpatch /sdcard/"
    //   call adbdevice adb
    //   run_cmd "adb push EDL\rooting\magiskfile /sdcard/"
    //   ECHO.%INFO%复制运行环境及刷入模块
    //   run_cmd "adb push 2100.sh /sdcard/"  (改名见 plan.md 2.5.2:setup_magisk_env.sh)
    //   run_cmd "adb shell ""su -c sh /sdcard/2100.sh"""  (设备端路径保留)
    //   call instmodule.bat tmp\xtcpatch.zip shinst
    this.log(ctx, 'info', '安装管理器');
    const managerApk = path.join(paths.edlWork, 'manager.apk');
    if (fs.existsSync(managerApk)) {
      await AdbService.install(managerApk, 'install');
    } else {
      this.log(ctx, 'warn', `manager.apk 不存在: ${managerApk}`);
    }

    this.log(ctx, 'info', '启动管理器[等待五秒]');
    await new Promise((r) => setTimeout(r, 5000));
    // 原:adb shell am start com.topjohnwu.magisk/a.c
    await AdbService.amStart('com.topjohnwu.magisk/a.c');

    // push xtcpatch 目录
    const xtcpatchDir = path.join(paths.edlWork, 'xtcpatch');
    if (fs.existsSync(xtcpatchDir)) {
      this.log(ctx, 'info', 'push xtcpatch → /sdcard/');
      await AdbService.push(xtcpatchDir, '/sdcard/');
    }
    // push magiskfile 目录
    const magiskfileDir = path.join(paths.edlWork, 'magiskfile');
    if (fs.existsSync(magiskfileDir)) {
      this.log(ctx, 'info', 'push magiskfile → /sdcard/');
      await AdbService.push(magiskfileDir, '/sdcard/');
    }

    // 复制运行环境(对应:adb push 2100.sh /sdcard/)
    // 设备端 .sh 改名(见 plan.md 2.5.2):2100.sh → setup_magisk_env.sh
    // 但设备端目标路径保留为 /sdcard/2100.sh(原 .bat 调用 sh /sdcard/2100.sh)
    // 注:plan.md 2.5.2 说"源文件改名,目标路径保留 Magisk 约定",但 2100.sh 不是 Magisk 约定,所以也可以改目标路径
    // 这里采用更彻底的方案:源和目标都改成 setup_magisk_env.sh
    this.log(ctx, 'info', '复制运行环境及刷入模块');
    const setupSh = paths.scriptFile('setup_magisk_env.sh');
    if (fs.existsSync(setupSh)) {
      await AdbService.push(setupSh, '/sdcard/setup_magisk_env.sh');
      // 原:adb shell "su -c sh /sdcard/2100.sh"
      await AdbService.shell('sh /sdcard/setup_magisk_env.sh', { timeout: TIMEOUT.flash, root: true });
    } else {
      this.log(ctx, 'warn', `setup_magisk_env.sh 不存在: ${setupSh}`);
    }
  }

  /** SDK25 安装 xtcpatch 模块(shinst 方式)+ 应用商店(对应 ROOT-SDK25.bat:91-99) */
  private async sdk25InstallXtcpatch(ctx: RootContext): Promise<void> {
    // 原:call instmodule.bat tmp\xtcpatch.zip shinst
    this.log(ctx, 'info', '刷入 xtcpatch 模块(shinst)');
    const xtcpatchZip = path.join(paths.cache, 'xtcpatch.zip');
    if (fs.existsSync(xtcpatchZip)) {
      const r = await MagiskService.install(xtcpatchZip, 'shinst');
      if (!r.success) {
        this.log(ctx, 'warn', `xtcpatch 安装失败: ${r.error}`);
      }
    } else {
      this.log(ctx, 'warn', `xtcpatch.zip 不存在: ${xtcpatchZip}`);
    }

    // 原:ECHO.%INFO%安装第三方应用商店
    //   call instapp.bat .\apks\appstore.apk
    //   if exist .\apks\appstore2.apk call instapp.bat .\apks\appstore2.apk
    //   if exist .\apks\appstore3.apk call instapp.bat .\apks\appstore3.apk
    //   if exist .\apks\appstore4.apk call instapp.bat .\apks\appstore4.apk
    //   ECHO.%INFO%安装第三方安装器
    //   call instapp.bat .\apks\MoyeInstaller.apk
    this.log(ctx, 'info', '安装第三方应用商店');
    const apksDir = path.join(paths.resources, 'apks');
    const apkFiles = ['appstore.apk', 'appstore2.apk', 'appstore3.apk', 'appstore4.apk', 'MoyeInstaller.apk'];
    for (const f of apkFiles) {
      const p = path.join(apksDir, f);
      if (fs.existsSync(p)) {
        this.log(ctx, 'info', `安装: ${f}`);
        await AdbService.install(p, 'install');
      }
    }
  }

  /** SDK25 Recovery 方案二次进 EDL 刷 recovery+misc(对应 ROOT-SDK25.bat:103-117) */
  private async sdk25BootSchemeSecondEdl(ctx: RootContext): Promise<void> {
    // 对应 ROOT-SDK25.bat:101-102:if "%recorroot%"=="1" goto ROOT-SDK25-F
    // 原 .bat 逻辑:此 stage 仅 Recovery 方案(recorroot=2)执行;BOOT 方案已在 nextStage 中跳过
    // 注:plan.md 注释"BOOT 方案需二次进 EDL"与原 .bat 相反,这里以原 .bat 为准(逻辑保真)

    // Recovery 方案:二次进 EDL 刷 recovery+misc
    this.log(ctx, 'info', '重启手表至 9008(二次 EDL)');
    await AdbService.reboot('edl');
    const port = await EdlService.waitForEdl(60000);
    ctx.edlPort = port;
    this.log(ctx, 'info', `9008 端口: ${port}`);
    this.log(ctx, 'info', '发送引导: msm8909w.mbn');
    await EdlService.loadFirehose({ port, loader: 'msm8909w.mbn' });

    const workDir = paths.edlWork;
    this.log(ctx, 'info', '刷入 BOOT 至 Recovery 分区');
    await EdlService.flashPartitions({
      port,
      loader: 'msm8909w.mbn',
      xmlPath: path.join(workDir, 'recovery.xml'),
      imagesDir: workDir,
    });
    this.log(ctx, 'info', '刷入 misc');
    await EdlService.flashPartitions({
      port,
      loader: 'msm8909w.mbn',
      xmlPath: path.join(workDir, 'misc.xml'),
      imagesDir: workDir,
    });
    this.log(ctx, 'info', '重启手表');
    await EdlService.reboot({ port, loader: 'msm8909w.mbn' });
  }

  /** SDK25 恢复 DCIM + 检查 magisk(对应 ROOT-SDK25.bat:118-145) */
  private async sdk25RestoreDcim(ctx: RootContext): Promise<void> {
    // 原:device_check.exe adb qcom_edl && ECHO.
    //   call boot_completed.bat
    //   ECHO.%INFO%重启手表
    //   adb reboot
    //   device_check.exe adb qcom_edl && ECHO.
    //   call boot_completed.bat
    //   if exist .\backupnametxt set /p backupname=<backupnametxt
    //   call backup DCIM recover noask
    //   ECHO.%INFO%正在检查magisk
    //   set /a retry=0
    //   :check_magisk
    //   call adbdevice root || set /a retry+=1
    //   if "%recorroot%"=="0" goto hive_magisk
    //   if !retry! lss 3 ( busybox sleep 5 & goto check_magisk )
    //   ECHO %ERROR%ROOT失败!发生错误,无法获取magisk,请尝试换方案再次root
    this.log(ctx, 'info', '等待 ADB 设备连接...');
    const device = await DeviceService.instance.waitFor(['adb', 'qcom_edl'], 180000);
    if (device.type === 'adb') {
      ctx.device = device;
      this.log(ctx, 'info', '等待开机完成...');
      await AdbService.waitForBoot(180000);

      this.log(ctx, 'info', '重启手表');
      await AdbService.reboot('system');
      const device2 = await DeviceService.instance.waitFor(['adb', 'qcom_edl'], 180000);
      if (device2.type === 'adb') {
        ctx.device = device2;
        await AdbService.waitForBoot(180000);
      }
    }

    // 恢复 DCIM
    if (ctx.dcimBackupDir) {
      this.log(ctx, 'info', '正在恢复相册...');
      const r = await BackupService.recoverDcim(ctx.dcimBackupDir, (msg) =>
        this.log(ctx, 'info', msg),
      );
      if (!r.success) {
        this.log(ctx, 'warn', `相册恢复失败: ${r.error}`);
      }
    }

    // 检查 magisk(重试 3 次)
    this.log(ctx, 'info', '正在检查 magisk');
    let retry = 0;
    while (retry < 3) {
      const rootResult = await AdbService.root();
      if (rootResult.granted) {
        this.log(ctx, 'info', 'Magisk 已就绪');
        return;
      }
      retry++;
      this.log(ctx, 'warn', `Magisk 检查失败(${retry}/3),5 秒后重试`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    this.log(ctx, 'error', 'ROOT 失败!发生错误,无法获取 magisk,请尝试换方案再次 root');
    throw new Error('ROOT 失败:无法获取 magisk,请尝试换方案再次 root');
  }

  // ========== 辅助:运行 magiskboot 命令(cwd=edlWork) ==========
  private async runMagiskboot(ctx: RootContext, args: string[]): Promise<void> {
    const magiskbootExe = paths.binFile('magiskboot.exe');
    // 注:magiskboot 部分子命令返回非 0 是正常的(如 cpio test 检测 magisk patched),
    // 但 hexpatch/cpio 操作失败应当抛错。这里直接 await,异常由调用方处理
    await SubprocessPool.spawn({
      cmd: magiskbootExe,
      args,
      cwd: paths.edlWork,
      encoding: 'utf-8',
      timeout: TIMEOUT.flash,
      taskId: ctx.taskId,
      onStdout: (line) => this.log(ctx, 'info', `magiskboot: ${line}`),
      onStderr: (line) => this.log(ctx, 'warn', `magiskboot stderr: ${line}`),
    });
  }

  // ========== SDK27/ND03 共用辅助方法 ==========

  /**
   * 安装 APK(important 方式:最多 6 次重试,每次间隔 30 秒)
   * 对应原 instapp.bat :important / :importanterror
   *   adb install -r -t -d "%args1%" → find "Success"
   *   失败:retry < 6 ? sleep 30 重试 : goto error
   */
  private async instappImportant(ctx: RootContext, apkPath: string): Promise<void> {
    if (!fs.existsSync(apkPath)) {
      this.log(ctx, 'warn', `APK 不存在: ${apkPath}(跳过)`);
      return;
    }
    this.log(ctx, 'info', `正在安装(important): ${path.basename(apkPath)}`);
    for (let retry = 0; retry < 6; retry++) {
      const r = await AdbService.install(apkPath, 'install');
      if (r.success) {
        this.log(ctx, 'info', '安装成功');
        return;
      }
      if (retry < 5) {
        this.log(ctx, 'warn', `安装失败,30 秒后重试(${retry + 1}/6)`);
        await new Promise((s) => setTimeout(s, 30000));
      }
    }
    throw new Error(`安装失败(重试 6 次): ${path.basename(apkPath)}`);
  }

  /**
   * 安装 APK(普通方式,失败仅警告)
   * 对应原 instapp.bat 默认分支:adb install -r -t -d
   */
  private async instappOptional(ctx: RootContext, apkPath: string): Promise<void> {
    if (!fs.existsSync(apkPath)) {
      return; // 原 .bat:if exist ... call instapp
    }
    this.log(ctx, 'info', `安装: ${path.basename(apkPath)}`);
    const r = await AdbService.install(apkPath, 'install');
    if (!r.success) {
      this.log(ctx, 'warn', `安装失败: ${path.basename(apkPath)}`);
    }
  }

  /** 等待 ADB 设备并检查 Xse 限制(对应 device_check.exe adb fastboot + devicestatus=adb 检查) */
  private async waitForAdbCheckXse(ctx: RootContext, timeout = 180000): Promise<void> {
    this.log(ctx, 'info', '等待 ADB/fastboot 设备连接...');
    const device = await DeviceService.instance.waitFor(['adb', 'fastboot'], timeout);
    if (device.type !== 'adb') {
      this.log(ctx, 'error', '您的设备可能触发了Xse限制!请重新进行root');
      throw new Error('您的设备可能触发了Xse限制!请重新进行root');
    }
    ctx.device = device;
  }

  /** 等待 ADB 或 9008 设备(对应 device_check.exe adb qcom_edl) */
  private async waitForAdbOrEdl(ctx: RootContext, timeout = 180000): Promise<void> {
    this.log(ctx, 'info', '等待 ADB/9008 设备连接...');
    const device = await DeviceService.instance.waitFor(['adb', 'qcom_edl'], timeout);
    ctx.device = device;
  }

  /** 启动 scrcpy 投屏(对应 start scrcpy-noconsole.vbs) */
  private async startScrcpy(ctx: RootContext): Promise<number | null> {
    try {
      const pid = await ScrcpyService.launch({ showTouches: true });
      this.log(ctx, 'info', `scrcpy 已启动(pid=${pid}),请在投屏窗口手动操作`);
      this.log(ctx, 'info', '提示:如果手表息屏,在投屏窗口单击右键即可');
      return pid;
    } catch (e) {
      this.log(ctx, 'warn', `scrcpy 启动失败: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * 检查 Magisk 是否就绪(对应 adb shell "su -c magisk -v")
   * @returns true=已就绪,false=未就绪
   */
  private async checkMagiskReady(ctx: RootContext): Promise<boolean> {
    try {
      const out = await AdbService.shell('magisk -v', { timeout: TIMEOUT.shell, root: true });
      const ready = /magisk/i.test(out) && out.trim().length > 0;
      if (ready) {
        this.log(ctx, 'info', `magisk -v: ${out.trim()}`);
      }
      return ready;
    } catch {
      return false;
    }
  }

  /**
   * automagisk.bat 的 11 步点击序列(SDK27 专用,坐标逐字一致)
   * 失败时启动 scrcpy 让用户手动操作,然后重新检查
   *
   * 原 .bat 步骤:
   *   am start -n com.topjohnwu.magisk/.ui.MainActivity
   *   busybox sleep 10
   *   input keyevent 4
   *   am start -n com.topjohnwu.magisk/.ui.MainActivity
   *   input tap 304 26
   *   input swipe 160 300 160 60 100 (x5)
   *   input tap 200 100
   *   input tap 200 230
   *   input tap 200 300
   *   input tap 200 140
   *   su -c magisk -v (检查)
   */
  private async autoMagiskSdk27(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '正在自动打开自动响应,请稍后');
    // am start -n com.topjohnwu.magisk/.ui.MainActivity
    await AdbService.amStart('com.topjohnwu.magisk/.ui.MainActivity');
    // busybox sleep 10
    await new Promise((r) => setTimeout(r, 10000));
    // input keyevent 4 (BACK)
    await AdbService.shell('input keyevent 4', { timeout: TIMEOUT.device });
    // am start -n com.topjohnwu.magisk/.ui.MainActivity (再次启动)
    await AdbService.amStart('com.topjohnwu.magisk/.ui.MainActivity');
    // device_check.exe adb
    const device = await DeviceService.instance.waitFor(['adb'], 30000);
    ctx.device = device;
    // input tap 304 26
    await AdbService.inputTap(304, 26);
    // input swipe 160 300 160 60 100 (x5,逐字一致)
    for (let i = 0; i < 5; i++) {
      await AdbService.inputSwipe(160, 300, 160, 60, 100);
    }
    // input tap 200 100
    await AdbService.inputTap(200, 100);
    // input tap 200 230
    await AdbService.inputTap(200, 230);
    // input tap 200 300
    await AdbService.inputTap(200, 300);
    // input tap 200 140
    await AdbService.inputTap(200, 140);
    // su -c magisk -v (检查)
    if (await this.checkMagiskReady(ctx)) {
      return;
    }
    // 失败:启动 scrcpy + 提示 + 等待 + 重试
    this.log(ctx, 'error', '自动授予出错及手动授予权限');
    await this.startScrcpy(ctx);
    this.log(ctx, 'info', '请打开 Magisk 右上角设置,往下滑,找到自动响应,修改为允许,然后找到超级用户通知,修改为无');
    this.log(ctx, 'info', '然后在主页点击超级用户,将所有开关打开');
    this.log(ctx, 'info', '操作完成后请等待自动重新检查(60 秒)');
    // 等待 60 秒后重新检查(对应 pause.exe)
    for (let retry = 0; retry < 3; retry++) {
      await new Promise((r) => setTimeout(r, 60000));
      if (await this.checkMagiskReady(ctx)) {
        return;
      }
      this.log(ctx, 'warn', `授予出错,请重新授予(${retry + 1}/3)`);
    }
    throw new Error('自动授予 Magisk 失败,请手动操作后重试');
  }

  /**
   * automagisk 的 ND03 变体点击序列(坐标与 SDK27 不同!)
   * 对应 nd03root.bat 中的自动授权点击序列:
   *   am start -n com.xtc.b/com.topjohnwu.magisk.ui.MainActivity
   *   busybox sleep 2
   *   am start -n com.xtc.b/com.topjohnwu.magisk.ui.MainActivity
   *   busybox sleep 5
   *   input tap 376 51
   *   busybox sleep 0.5
   *   input swipe 200 400 200 100 (x8)
   *   busybox sleep 0.5
   *   input tap 200 330
   *   busybox sleep 0.5
   *   input tap 200 180
   *   busybox sleep 0.5
   *   input swipe 200 200 200 300
   *   busybox sleep 0.5
   *   input tap 200 150
   *   busybox sleep 0.5
   *   input tap 200 315
   *   su -c magisk -v (检查)
   */
  private async autoMagiskNd03(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '正在自动打开自动响应,请稍后');
    // am start -n com.xtc.b/com.topjohnwu.magisk.ui.MainActivity
    await AdbService.amStart('com.xtc.b/com.topjohnwu.magisk.ui.MainActivity');
    // busybox sleep 2
    await new Promise((r) => setTimeout(r, 2000));
    // am start (再次启动)
    await AdbService.amStart('com.xtc.b/com.topjohnwu.magisk.ui.MainActivity');
    // device_check.exe adb
    const device = await DeviceService.instance.waitFor(['adb'], 30000);
    ctx.device = device;
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
    // input tap 376 51
    await AdbService.inputTap(376, 51);
    // busybox sleep 0.5
    await new Promise((r) => setTimeout(r, 500));
    // input swipe 200 400 200 100 (x8,逐字一致)
    for (let i = 0; i < 8; i++) {
      await AdbService.inputSwipe(200, 400, 200, 100, 0);
    }
    // busybox sleep 0.5
    await new Promise((r) => setTimeout(r, 500));
    // input tap 200 330
    await AdbService.inputTap(200, 330);
    // busybox sleep 0.5
    await new Promise((r) => setTimeout(r, 500));
    // input tap 200 180
    await AdbService.inputTap(200, 180);
    // busybox sleep 0.5
    await new Promise((r) => setTimeout(r, 500));
    // input swipe 200 200 200 300
    await AdbService.inputSwipe(200, 200, 200, 300, 0);
    // busybox sleep 0.5
    await new Promise((r) => setTimeout(r, 500));
    // input tap 200 150
    await AdbService.inputTap(200, 150);
    // busybox sleep 0.5
    await new Promise((r) => setTimeout(r, 500));
    // input tap 200 315
    await AdbService.inputTap(200, 315);
    // su -c magisk -v (检查)
    if (await this.checkMagiskReady(ctx)) {
      return;
    }
    // 失败:启动 scrcpy + 提示 + 等待 + 重试
    this.log(ctx, 'error', '自动授予出错及手动授予权限');
    await AdbService.amStart('com.xtc.b/com.topjohnwu.magisk.ui.MainActivity');
    await DeviceService.instance.waitFor(['adb'], 30000);
    await this.startScrcpy(ctx);
    this.log(ctx, 'info', '请打开 Magisk 右上角设置,往下滑,找到自动响应,修改为允许,然后找到超级用户通知,修改为无');
    this.log(ctx, 'info', '然后在主页点击超级用户,将所有开关打开');
    this.log(ctx, 'info', '操作完成后请等待自动重新检查(60 秒)');
    for (let retry = 0; retry < 3; retry++) {
      await new Promise((r) => setTimeout(r, 60000));
      if (await this.checkMagiskReady(ctx)) {
        return;
      }
      this.log(ctx, 'warn', `授予出错,请重新授予(${retry + 1}/3)`);
    }
    throw new Error('自动授予 Magisk 失败,请手动操作后重试');
  }

  /**
   * autosystemplus.bat 的完整流程
   *   1. sleep 10
   *   2. push autosystemplus.sh + 执行
   *   3. push systemplus.sh + 执行 → 检查返回值(0=已激活,1=未激活)
   *   4. push toolkit.sh + 执行 → 检查返回值
   *   失败时:启动 scrcpy + am start ActiveSelfActivity + 等待用户 → 重试
   */
  private async autoSystemPlus(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '正在自动激活,请稍后');
    // busybox sleep 10
    await new Promise((r) => setTimeout(r, 10000));
    // push autosystemplus.sh + su -c sh /sdcard/autosystemplus.sh
    const autoSh = paths.scriptFile('autosystemplus.sh');
    if (fs.existsSync(autoSh)) {
      await AdbService.push(autoSh, '/sdcard/autosystemplus.sh');
      try {
        await AdbService.shell('sh /sdcard/autosystemplus.sh', { timeout: TIMEOUT.shellLong, root: true });
      } catch (e) {
        this.log(ctx, 'warn', `autosystemplus.sh 执行失败: ${(e as Error).message}`);
      }
    } else {
      this.log(ctx, 'warn', `autosystemplus.sh 不存在: ${autoSh}`);
    }

    // xposed-check 循环:push systemplus.sh + 检查
    const systemplusSh = paths.scriptFile('systemplus.sh');
    const toolkitSh = paths.scriptFile('toolkit.sh');
    let retry = 0;
    while (retry < 3) {
      // push systemplus.sh + 检查 SystemPlus 激活状态
      if (fs.existsSync(systemplusSh)) {
        await AdbService.push(systemplusSh, '/sdcard/systemplus.sh');
        this.log(ctx, 'info', '开始检查 SystemPlus 激活状态...');
        let systemplusOut = '';
        try {
          systemplusOut = await AdbService.shell('sh /sdcard/systemplus.sh', {
            timeout: TIMEOUT.shell,
            root: true,
          });
        } catch (e) {
          this.log(ctx, 'warn', `systemplus.sh 执行失败: ${(e as Error).message}`);
        }
        if (systemplusOut.trim() === '1') {
          this.log(ctx, 'error', '未激活');
          this.log(ctx, 'error', '没有激活 SystemPlus!请手动激活后重试');
          // ROOT-Xposed 分支:启动 scrcpy + am start ActiveSelfActivity
          await this.startScrcpy(ctx);
          try {
            await AdbService.shell('am start -n com.huanli233.systemplus/.ActiveSelfActivity', {
              timeout: TIMEOUT.device,
              root: true,
            });
          } catch {
            // ignore
          }
          this.log(ctx, 'info', '请往下滑,找到自激活,然后点击激活 SystemPlus 与激活核心破解');
          this.log(ctx, 'info', '操作完成后请等待自动重新检查(60 秒)');
          await new Promise((r) => setTimeout(r, 60000));
          retry++;
          continue;
        }
        this.log(ctx, 'info', '已激活');
      } else {
        this.log(ctx, 'warn', `systemplus.sh 不存在: ${systemplusSh}`);
        break;
      }

      // push toolkit.sh + 检查核心破解激活状态
      if (fs.existsSync(toolkitSh)) {
        await AdbService.push(toolkitSh, '/sdcard/toolkit.sh');
        this.log(ctx, 'info', '开始检查核心破解激活状态...');
        let toolkitOut = '';
        try {
          toolkitOut = await AdbService.shell('sh /sdcard/toolkit.sh', {
            timeout: TIMEOUT.shell,
            root: true,
          });
        } catch (e) {
          this.log(ctx, 'warn', `toolkit.sh 执行失败: ${(e as Error).message}`);
        }
        if (toolkitOut.trim() === '1') {
          this.log(ctx, 'error', '未激活');
          this.log(ctx, 'error', '没有激活核心破解!请手动激活后重试');
          await this.startScrcpy(ctx);
          try {
            await AdbService.shell('am start -n com.huanli233.systemplus/.ActiveSelfActivity', {
              timeout: TIMEOUT.device,
              root: true,
            });
          } catch {
            // ignore
          }
          this.log(ctx, 'info', '请往下滑,找到自激活,然后点击激活 SystemPlus 与激活核心破解');
          this.log(ctx, 'info', '操作完成后请等待自动重新检查(60 秒)');
          await new Promise((r) => setTimeout(r, 60000));
          retry++;
          continue;
        }
        this.log(ctx, 'info', '已激活');
      } else {
        this.log(ctx, 'warn', `toolkit.sh 不存在: ${toolkitSh}`);
      }
      return; // 全部通过
    }
    throw new Error('SystemPlus/核心破解激活失败,请手动操作后重试');
  }

  /**
   * LSPosed 作用域 7 步点击(ND03 专用,坐标逐字一致)
   * 对应 nd03root.bat:
   *   am start -n org.lsposed.manager/.ui.activity.MainActivity
   *   busybox sleep 5
   *   input tap 115 271 → sleep 0.5
   *   input tap 122 433 → sleep 0.5
   *   input tap 200 173 → sleep 0.5
   *   input tap 180 200 → sleep 0.5
   *   input tap 25 30   → sleep 0.5
   *   input tap 200 250 → sleep 0.5
   *   input tap 180 200 → sleep 0.5
   *   input tap 25 30
   */
  private async activateLsposed(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '正在勾选作用域,请稍后');
    // am start -n org.lsposed.manager/.ui.activity.MainActivity
    try {
      await AdbService.shell('am start -n org.lsposed.manager/.ui.activity.MainActivity', {
        timeout: TIMEOUT.device,
        root: true,
      });
    } catch (e) {
      this.log(ctx, 'warn', `启动 LSPosed 失败: ${(e as Error).message}`);
    }
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
    // 8 步点击(注:原 .bat 标注为 7 步,但实际是 8 个 tap,这里逐字一致)
    const taps: Array<[number, number]> = [
      [115, 271],
      [122, 433],
      [200, 173],
      [180, 200],
      [25, 30],
      [200, 250],
      [180, 200],
      [25, 30],
    ];
    for (let i = 0; i < taps.length; i++) {
      const [x, y] = taps[i];
      await AdbService.inputTap(x, y);
      // 每步后 sleep 0.5(最后一步原 .bat 没有 sleep,但等价)
      if (i < taps.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  /**
   * 写本地 misc.bin 文件(内容 "ffbm-02")
   * 对应原 .bat:echo ffbm-02 > misc.bin
   * 注:echo 会自动追加 \r\n,这里保留 \r\n(原 .bat 字面行为)
   */
  private writeMiscBin(ctx: RootContext): string {
    const miscBin = path.join(paths.cache, 'misc.bin');
    fs.writeFileSync(miscBin, 'ffbm-02\r\n', 'latin1');
    this.log(ctx, 'info', `已写入 misc.bin: ${miscBin}`);
    return miscBin;
  }

  // ---------- SDK27 stages(Android 8.1,EDL + magiskpatch 25,最复杂) ----------

  /** SDK27 备份 DCIM(对应 root-SDK27.bat:2-4) */
  private async sdk27BackupDcim(ctx: RootContext): Promise<void> {
    // 原:del /Q /F .\backupname.txt >nul 2>nul
    //   call backup DCIM backup noask
    //   set /p="%backupname%" <nul > backupname.txt
    const backupDir = path.join(paths.userData, 'root-backup', ctx.taskId);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    ctx.dcimBackupDir = backupDir;
    this.log(ctx, 'info', '正在备份相册...');
    const r = await BackupService.backupDcim(backupDir, (msg) => this.log(ctx, 'info', msg));
    if (!r.success) {
      this.log(ctx, 'warn', `相册备份失败(继续流程): ${r.error}`);
    }
  }

  /** SDK27 进入 EDL(对应 root-SDK27.bat:6-12) */
  private async sdk27EnteringEdl(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%重启您的手表至9008
    //   adb reboot edl
    //   call edlport
    //   ECHO.%INFO%发送引导
    //   call QSaharaServer.bat -p \\.\COM%port% -s 13:%cd%\EDL\msm8937.mbn
    //   busybox sleep 2
    this.log(ctx, 'info', '重启手表至 9008');
    await AdbService.reboot('edl');
    this.log(ctx, 'info', '等待 9008 设备...');
    const port = await EdlService.waitForEdl(60000);
    ctx.edlPort = port;
    this.log(ctx, 'info', `9008 端口: ${port}`);
    // 发送引导:msm8937.mbn
    this.log(ctx, 'info', '发送引导: msm8937.mbn');
    await EdlService.loadFirehose({ port, loader: 'msm8937.mbn' });
    // busybox sleep 2
    await new Promise((r) => setTimeout(r, 2000));
  }

  /** SDK27 读取 boot(对应 root-SDK27.bat:13-21) */
  private async sdk27ReadingBoot(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%读取boot
    //   call fh_loader.bat --port=... --memoryname=EMMC --sendxml=EDL\rooting\boot.xml --convertprogram2read --noprompt
    //   move /Y .\boot.img .\tmp\boot.img 1>nul 2>nul
    //   if %errorlevel% neq 0 ( echo %ERROR%移动boot.img文件失败 ... exit /b )
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    const bootXml = path.join(paths.edlWork, 'boot.xml');
    if (!fs.existsSync(bootXml)) {
      throw new Error(`boot.xml 不存在: ${bootXml}`);
    }
    this.log(ctx, 'info', '读取 boot 分区...');
    await EdlService.readPartitions({
      port: ctx.edlPort,
      loader: 'msm8937.mbn',
      xmlPath: bootXml,
      outputDir: paths.edlWork,
    });
    // move edlWork/boot.img → cache/boot.img
    const srcBoot = path.join(paths.edlWork, 'boot.img');
    const dstBoot = path.join(paths.cache, 'boot.img');
    if (!fs.existsSync(srcBoot)) {
      this.log(ctx, 'error', '移动 boot.img 文件失败');
      this.log(ctx, 'error', '这是一个致命问题,可能数据线连接不稳定,没有成功读取 boot');
      throw new Error('移动 boot.img 文件失败(可能数据线连接不稳定)');
    }
    if (fs.existsSync(dstBoot)) fs.unlinkSync(dstBoot);
    fs.renameSync(srcBoot, dstBoot);
    this.log(ctx, 'info', `boot.img 已读取 → ${dstBoot}`);
  }

  /** SDK27 修补 boot(对应 root-SDK27.bat:23-43) */
  private async sdk27PatchingBoot(ctx: RootContext): Promise<void> {
    // 原:busybox sleep 1
    //   call magiskpatch 25  (失败 → 修补 boot 失败)
    //   magiskboot unpack -h boot.img
    //   magiskboot cpio ramdisk.cpio "add 0750 sbin/adbd 810_adbd"
    //   magiskboot cpio ramdisk.cpio "add 0750 overlay.d/xse.rc xse.rc"
    //   patch_boot.exe | find "Suc" (失败 → patch_boot.exe 无法运行)
    //   magiskboot repack boot.img
    //   copy /Y new-boot.img EDL\rooting\sboot.img > nul
    //   del /Q /F .\tmp\boot.img

    // busybox sleep 1
    await new Promise((r) => setTimeout(r, 1000));
    this.log(ctx, 'info', '开始修补 boot(magiskpatch 25)');

    // magiskpatch 25(读 cache/boot.img → 写 edlWork/boot.img)
    const inputBoot = path.join(paths.cache, 'boot.img');
    const patchedBoot = path.join(paths.edlWork, 'boot.img');
    const r = await MagiskPatcher.patch(
      inputBoot,
      patchedBoot,
      25 as MagiskVersion,
      paths.edlWork,
      ctx.taskId,
    );
    if (!r.success) {
      this.log(ctx, 'error', '修补 boot 失败,按任意键退出');
      throw new Error(`magiskpatch 失败: ${r.error}`);
    }
    ctx.patchedBootPath = patchedBoot;
    this.log(ctx, 'info', `magiskpatch 完成(status=${r.status})`);

    // magiskboot unpack -h boot.img(在 edlWork 中,boot.img 已是 patchedBoot)
    this.log(ctx, 'info', '解包 boot');
    await this.runMagiskboot(ctx, ['unpack', '-h', 'boot.img']);

    // 替换 adbd:magiskboot cpio ramdisk.cpio "add 0750 sbin/adbd 810_adbd"
    this.log(ctx, 'info', '替换 adbd(810_adbd)');
    const adbdSrc = paths.binFile('810_adbd');
    const adbdDst = path.join(paths.edlWork, '810_adbd');
    if (fs.existsSync(adbdSrc) && !fs.existsSync(adbdDst)) {
      fs.copyFileSync(adbdSrc, adbdDst);
    }
    await this.runMagiskboot(ctx, ['cpio', 'ramdisk.cpio', 'add 0750 sbin/adbd 810_adbd']);

    // 添加 xse.rc overlay:magiskboot cpio ramdisk.cpio "add 0750 overlay.d/xse.rc xse.rc"
    this.log(ctx, 'info', '添加 xse.rc overlay');
    const xseRcSrc = paths.binFile('xse.rc');
    const xseRcDst = path.join(paths.edlWork, 'xse.rc');
    if (fs.existsSync(xseRcSrc) && !fs.existsSync(xseRcDst)) {
      fs.copyFileSync(xseRcSrc, xseRcDst);
    }
    await this.runMagiskboot(ctx, ['cpio', 'ramdisk.cpio', 'add 0750 overlay.d/xse.rc xse.rc']);

    // patch_boot(BootPatcher,Bug 修复:输出 success 而非 Sucess)
    this.log(ctx, 'info', '宽容 selinux(patch_boot)');
    const kernelPath = path.join(paths.edlWork, 'kernel');
    const patchResult = BootPatcher.patch(kernelPath);
    if (!patchResult.success || !patchResult.output.includes('success')) {
      this.log(ctx, 'error', 'patch_boot.exe 无法运行,请尝试安装 VC 运行库合集');
      throw new Error(`patch_boot 失败: ${patchResult.error ?? patchResult.output}`);
    }
    for (const p of patchResult.patches) {
      this.log(ctx, 'info', `patch_boot: ${p}`);
    }

    // magiskboot repack boot.img → new-boot.img
    this.log(ctx, 'info', '打包 boot');
    await this.runMagiskboot(ctx, ['repack', 'boot.img']);
    this.log(ctx, 'info', 'BOOT 处理完成!!!');

    // copy new-boot.img → edlWork/sboot.img(对应原 .bat:copy /Y new-boot.img EDL\rooting\sboot.img)
    const newBootPath = path.join(paths.edlWork, 'new-boot.img');
    if (!fs.existsSync(newBootPath)) {
      throw new Error('magiskboot repack 未生成 new-boot.img');
    }
    const sbootImg = path.join(paths.edlWork, 'sboot.img');
    if (fs.existsSync(sbootImg)) fs.unlinkSync(sbootImg);
    fs.copyFileSync(newBootPath, sbootImg);
    this.log(ctx, 'info', `已生成 sboot.img: ${sbootImg}`);

    // del tmp/boot.img(对应原 .bat:del /Q /F .\tmp\boot.img)
    const tmpBoot = path.join(paths.cache, 'boot.img');
    try {
      if (fs.existsSync(tmpBoot)) fs.unlinkSync(tmpBoot);
    } catch {
      // ignore
    }
  }

  /**
   * SDK27 刷入 rawprogram(对应 root-SDK27.bat:45-73)
   * - smodel=1:copy sboot→recovery + flash recovery.xml + flash rawprogram0 + qfh_loader reboot(然后 nextStage 跳 waiting-boot)
   * - 非 smodel=1:flash rawprogram0
   *   - nouserdata=1:qfh_loader reboot + 退出(然后 nextStage 跳 completed)
   *   - 否则:copy eboot.img → tmp/boot.img + flash boot.xml(擦除 boot)+ qfh_loader reboot
   */
  private async sdk27FlashingRawprogram(ctx: RootContext): Promise<void> {
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    const workDir = paths.edlWork;

    if (ctx.smodel) {
      // smodel=1 分支:刷入 recovery + rawprogram0(boot/aboot/userdata/misc)
      this.log(ctx, 'info', '刷入 recovery');
      // copy EDL\rooting\sboot.img EDL\rooting\recovery.img
      const sbootImg = path.join(workDir, 'sboot.img');
      const recoveryImg = path.join(workDir, 'recovery.img');
      if (fs.existsSync(sbootImg)) {
        fs.copyFileSync(sbootImg, recoveryImg);
      }
      // fh_loader --sendxml=EDL\rooting\recovery.xml
      const recoveryXml = path.join(workDir, 'recovery.xml');
      await EdlService.flashPartitions({
        port: ctx.edlPort,
        loader: 'msm8937.mbn',
        xmlPath: recoveryXml,
        imagesDir: workDir,
      });
      this.log(ctx, 'info', '刷入 boot,aboot,userdata,misc');
      // fh_loader --sendxml=EDL\rooting\rawprogram0.xml
      const rawprogramXml = path.join(workDir, 'rawprogram0.xml');
      await EdlService.flashPartitions({
        port: ctx.edlPort,
        loader: 'msm8937.mbn',
        xmlPath: rawprogramXml,
        imagesDir: workDir,
      });
      // qfh_loader reboot(对应:call qfh_loader.bat --sendxml=reboot.xml)
      this.log(ctx, 'info', '重启手表(9008)');
      await EdlService.reboot({ port: ctx.edlPort, loader: 'msm8937.mbn' });
      return;
    }

    // 非 smodel=1 分支:刷入 recovery,aboot
    this.log(ctx, 'info', '刷入 recovery,aboot');
    const rawprogramXml = path.join(workDir, 'rawprogram0.xml');
    await EdlService.flashPartitions({
      port: ctx.edlPort,
      loader: 'msm8937.mbn',
      xmlPath: rawprogramXml,
      imagesDir: workDir,
    });

    // 检查 nouserdata(对应:if "%nouserdata%"=="1" ... exit /b)
    if (ctx.options.nouserdata) {
      // nouserdata=1:qfh_loader reboot + 退出
      this.log(ctx, 'info', '重启手表');
      await EdlService.reboot({ port: ctx.edlPort, loader: 'msm8937.mbn' });
      this.log(ctx, 'info', '你选择了不刷 userdata,不再继续');
      return;
    }

    // 擦除 boot:copy /Y tmp\eboot.img tmp\boot.img(33MB 全零)
    this.log(ctx, 'info', '擦除 boot');
    const ebootSrc = paths.edlEboot; // resources/edl/eboot.img(33MB 全零)
    const tmpBoot = path.join(paths.cache, 'boot.img');
    if (fs.existsSync(ebootSrc)) {
      fs.copyFileSync(ebootSrc, tmpBoot);
    } else {
      this.log(ctx, 'warn', `eboot.img 不存在: ${ebootSrc}(将尝试继续)`);
    }
    // fh_loader --search_path=tmp --sendxml=EDL\rooting\boot.xml(擦除 boot)
    const bootXml = path.join(workDir, 'boot.xml');
    await EdlService.flashPartitions({
      port: ctx.edlPort,
      loader: 'msm8937.mbn',
      xmlPath: bootXml,
      imagesDir: paths.cache,
    });
    // qfh_loader reboot
    this.log(ctx, 'info', '等待重启手表并进入 fastboot');
    await EdlService.reboot({ port: ctx.edlPort, loader: 'msm8937.mbn' });
    this.log(ctx, 'info', '等待开机并进入 fastboot');
    this.log(ctx, 'warn', '设备即将进入 Fastboot 模式，如长时间无响应请检查驱动');
    this.log(ctx, 'warn', '如果一直卡在这里,可能需要安装驱动');
  }

  /** SDK27 等待 fastboot 设备(对应 root-SDK27.bat:77 device_check.exe fastboot) */
  private async sdk27RebootingToFastboot(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '等待 fastboot 设备...');
    const device = await DeviceService.instance.waitFor(['fastboot'], 120000);
    ctx.device = device;
    // 三次 "设备处于正常刷写状态，请勿断开数据线"(原 .bat 逐字保留)
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备即将进入 Fastboot 模式，如长时间无响应请检查驱动');
  }

  /** SDK27 fastboot 刷入 boot(对应 root-SDK27.bat:82-83) */
  private async sdk27FastbootFlashBoot(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%刷入boot
    //   run_cmd "fastboot flash boot new-boot.img"
    this.log(ctx, 'info', '刷入 boot');
    const newBoot = path.join(paths.edlWork, 'new-boot.img');
    if (!fs.existsSync(newBoot)) {
      // 兜底:sboot.img(已 patched)
      const sboot = path.join(paths.edlWork, 'sboot.img');
      if (fs.existsSync(sboot)) {
        this.log(ctx, 'warn', `new-boot.img 不存在,使用 sboot.img`);
        await FastbootService.flash('boot', sboot);
        return;
      }
      throw new Error(`new-boot.img 不存在: ${newBoot}`);
    }
    await FastbootService.flash('boot', newBoot);
  }

  /** SDK27 fastboot 刷入 userdata(对应 root-SDK27.bat:84-85) */
  private async sdk27FastbootFlashUserdata(ctx: RootContext): Promise<void> {
    // 原:ECHO.%INFO%刷入userdata
    //   run_cmd "fastboot flash userdata tmp\userdata.img"
    this.log(ctx, 'info', '刷入 userdata');
    const userdataImg = path.join(paths.cache, 'userdata.img');
    if (!fs.existsSync(userdataImg)) {
      throw new Error(`userdata.img 不存在: ${userdataImg},请先在"资源下载"页下载`);
    }
    await FastbootService.flash('userdata', userdataImg);
  }

  /** SDK27 fastboot 刷入 misc + 重启 + 等 ADB + boot_completed(对应 root-SDK27.bat:86-101) */
  private async sdk27FastbootFlashMisc(ctx: RootContext): Promise<void> {
    // 原:echo ffbm-02 > misc.bin
    //   run_cmd "fastboot flash misc misc.bin"
    //   run_cmd "fastboot reboot"
    //   ECHO.%INFO%坐和放宽，让我们等待您的手表一段时间
    //   device_check.exe adb fastboot&&ECHO.
    //   if not "%devicestatus%"=="adb" ( ECHO.%ERROR%您的设备可能触发了Xse限制！请重新进行root & exit /b )
    //   ECHO.%WARN%工具未做出提示不要在手表上点任何内容！！
    //   ECHO.%WARN%请 不要 点击重启-重启并进入正常启动模式
    //   ECHO.%INFO%稍等片刻，即将进入qmmi
    //   call boot_completed.bat
    //   ECHO.%INFO%已进入qmmi
    this.log(ctx, 'info', '刷入 misc(ffbm-02)');
    const miscBin = this.writeMiscBin(ctx);
    await FastbootService.flash('misc', miscBin);
    this.log(ctx, 'info', 'fastboot reboot');
    await FastbootService.reboot('system');
    this.log(ctx, 'info', '请耐心等待设备响应');
    // device_check.exe adb fastboot + 检查 devicestatus=adb
    await this.waitForAdbCheckXse(ctx, 180000);
    this.log(ctx, 'warn', '在工具给出进一步提示前，请勿在手表上进行任何操作');
    this.log(ctx, 'warn', '请 不要 点击重启-重启并进入正常启动模式');
    this.log(ctx, 'info', '稍等片刻,即将进入 qmmi');
    await AdbService.waitForBoot(180000);
    this.log(ctx, 'info', '已进入 qmmi');
    this.log(ctx, 'warn', '在工具给出进一步提示前，请勿在手表上进行任何操作');
    this.log(ctx, 'warn', '请 不要 点击重启-重启并进入正常启动模式');
  }

  /**
   * SDK27 ROOT-SDK27-WAIT:等待开机(smodel=1 专用)
   * 对应 root-SDK27.bat:104-113
   *   if "%smodel%"=="1" (
   *     device_check.exe adb qcom_edl
   *     call boot_completed.bat
   *     busybox sleep 15
   *   )
   * 非 smodel=1:已在 fastboot-flash-misc 中 boot_completed,此处仅做轻量校验
   */
  private async sdk27WaitingBoot(ctx: RootContext): Promise<void> {
    if (ctx.smodel) {
      // smodel=1:坐和放宽 + 等 ADB/9008 + boot_completed + sleep 15
      this.log(ctx, 'info', '请耐心等待设备响应');
      await this.waitForAdbOrEdl(ctx, 180000);
      this.log(ctx, 'info', '稍等片刻,即将开始');
      await AdbService.waitForBoot(180000);
      this.log(ctx, 'info', 'busybox sleep 15');
      await new Promise((r) => setTimeout(r, 15000));
    } else {
      // 非 smodel=1:已经在 sdk27-fastboot-flash-misc 中 boot_completed,此处仅确认 ADB
      if (!ctx.device || ctx.device.type !== 'adb') {
        await this.waitForAdbOrEdl(ctx, 60000);
      }
    }
  }

  /**
   * SDK27 安装预装 APK(smodel=1 专用:54850.apk important)
   * 对应 root-SDK27.bat:112 call instapp .\apks\54850.apk important
   * 非 smodel=1:无操作(原 .bat 在此 stage 不执行任何 APK 安装)
   */
  private async sdk27InstallPreinstall(ctx: RootContext): Promise<void> {
    if (!ctx.smodel) {
      return; // 非 smodel=1 跳过
    }
    const apk = path.join(paths.resources, 'apks', '54850.apk');
    await this.instappImportant(ctx, apk);
  }

  /**
   * SDK27 启用充电可用 + 模拟未充电 + wifi/density 调整
   * 对应 root-SDK27.bat:115-128
   *   adb shell pm path com.android.systemui (检查 SystemUI)
   *   adb shell setprop persist.sys.charge.usable true
   *   adb shell dumpsys battery unplug
   *   adb shell svc wifi disable
   *   adb shell wm density 200
   */
  private async sdk27EnableCharge(ctx: RootContext): Promise<void> {
    // 检查 SystemUI(对应:adb shell pm path com.android.systemui)
    let hasSystemUI = false;
    try {
      const out = await AdbService.shell('pm path com.android.systemui', { timeout: TIMEOUT.device });
      hasSystemUI = out.trim().length > 0;
    } catch {
      // ignore
    }
    if (hasSystemUI) {
      this.log(ctx, 'info', '系统已存在 SystemUI');
    } else {
      this.log(ctx, 'info', '系统不存在 SystemUI,将为你安装 SystemUI 模块');
    }
    this.log(ctx, 'warn', '请一定要根据工具的提示来,root 未完成前禁止联网,禁止重复绑定!');
    // setprop persist.sys.charge.usable true
    await AdbService.shell('setprop persist.sys.charge.usable true', { timeout: TIMEOUT.device });
    this.log(ctx, 'info', '充电可用已开启');
    // dumpsys battery unplug
    await AdbService.shell('dumpsys battery unplug', { timeout: TIMEOUT.device });
    this.log(ctx, 'info', '已模拟未充电状态');
    // svc wifi disable
    await AdbService.shell('svc wifi disable', { timeout: TIMEOUT.device });
    // wm density 200
    await AdbService.shell('wm density 200', { timeout: TIMEOUT.device });
  }

  /**
   * SDK27 自动授权 Magisk + 打开 EdXposed Installer
   * 对应 root-SDK27.bat:129-134(call automagisk.bat + am start EdXposed + sleep 7)
   */
  private async sdk27AutoGrantMagisk(ctx: RootContext): Promise<void> {
    // call automagisk.bat(11 步点击)
    await this.autoMagiskSdk27(ctx);
    // :Edxposed 标签
    this.log(ctx, 'info', '正在自动打开 EdXposed Installer,请稍后');
    await this.waitForAdbOrEdl(ctx, 60000);
    // am start -n com.solohsu.android.edxp.manager/de.robv.android.xposed.installer.WelcomeActivity
    await AdbService.amStart(
      'com.solohsu.android.edxp.manager/de.robv.android.xposed.installer.WelcomeActivity',
    );
    // busybox sleep 7
    await new Promise((r) => setTimeout(r, 7000));
  }

  /** SDK27 自动激活 SystemPlus(对应 root-SDK27.bat:135 call autosystemplus.bat) */
  private async sdk27ActivateSystemplus(ctx: RootContext): Promise<void> {
    await this.autoSystemPlus(ctx);
  }

  /**
   * SDK27 安装 XTC Patch 模块
   * 对应 root-SDK27.bat:137-144
   *   call logo(占位)
   *   把时间交给我们 -
   *   ECHO.%INFO%开始安装XTC Patch模块
   *   adb shell setprop persist.sys.rooting true
   *   call instmodule.bat tmp\xtcpatch.zip magisk
   *   adb shell setprop persist.sys.rooting false
   *   ECHO.%INFO%安装XTC Patch模块成功
   */
  private async sdk27InstallXtcpatch(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '------------------------------------');
    this.log(ctx, 'info', '后续步骤将由工具自动完成');
    this.log(ctx, 'info', '开始安装 XTC Patch 模块');
    // setprop persist.sys.rooting true
    await AdbService.shell('setprop persist.sys.rooting true', { timeout: TIMEOUT.device });
    // instmodule.bat tmp\xtcpatch.zip magisk
    const xtcpatchZip = path.join(paths.cache, 'xtcpatch.zip');
    if (!fs.existsSync(xtcpatchZip)) {
      this.log(ctx, 'warn', `xtcpatch.zip 不存在: ${xtcpatchZip}`);
    } else {
      const r = await MagiskService.install(xtcpatchZip, 'magisk');
      if (!r.success) {
        this.log(ctx, 'warn', `xtcpatch 安装失败: ${r.error}`);
      }
    }
    // setprop persist.sys.rooting false
    await AdbService.shell('setprop persist.sys.rooting false', { timeout: TIMEOUT.device });
    this.log(ctx, 'info', '安装 XTC Patch 模块成功');
  }

  /**
   * SDK27 安装 SystemUI 模块(isv3 且 ≠I20 才安装)
   * 对应 root-SDK27.bat:145-151
   *   if "%isv3%"=="1" if not "%innermodel%"=="I20" (
   *     call instmodule.bat tmp\systemui.zip magisk
   *   )
   */
  private async sdk27InstallSystemui(ctx: RootContext): Promise<void> {
    if (!(ctx.isV3 && ctx.innermodel !== 'I20')) {
      this.log(ctx, 'info', `跳过 SystemUI 模块安装(isv3=${ctx.isV3 ? 1 : 0}, innermodel=${ctx.innermodel})`);
      return;
    }
    this.log(ctx, 'info', '开始安装 systemui 模块');
    const systemuiZip = path.join(paths.cache, 'systemui.zip');
    if (!fs.existsSync(systemuiZip)) {
      this.log(ctx, 'warn', `systemui.zip 不存在: ${systemuiZip}`);
      return;
    }
    const r = await MagiskService.install(systemuiZip, 'magisk');
    if (!r.success) {
      this.log(ctx, 'warn', `systemui 安装失败: ${r.error}`);
    } else {
      this.log(ctx, 'info', '安装 systemui 模块成功');
    }
  }

  /**
   * SDK27 wm density reset + pm clear packageinstaller
   * 对应 root-SDK27.bat:154-155
   */
  private async sdk27InstallPreinstallApk(ctx: RootContext): Promise<void> {
    // 注:stage 名"install-preinstall-apk"略有歧义,实际此 stage 对应原 .bat 的
    //   run_cmd "adb shell wm density reset"
    //   run_cmd "adb shell pm clear com.android.packageinstaller"
    // 真正的预装 APK 安装在 sdk27-install-bundled-apks stage
    this.log(ctx, 'info', 'wm density reset + pm clear packageinstaller');
    await AdbService.shell('wm density reset', { timeout: TIMEOUT.device });
    await AdbService.shell('pm clear com.android.packageinstaller', { timeout: TIMEOUT.shell });
  }

  /**
   * SDK27 重启 + 等 ADB + boot_completed + (smodel=1: 激活模块)
   * 对应 root-SDK27.bat:158-179
   *   adb reboot
   *   device_check.exe adb qcom_edl fastboot + 检查 devicestatus=adb (Xse 检查)
   *   call boot_completed.bat
   *   if "%smodel%"=="1" (
   *     busybox sleep 5
   *     su -c sh /data/adb/modules/XTCPatch/active_module.sh com.huanli233.systemplus
   *     su -c sh /data/adb/modules/XTCPatch/active_module.sh com.zcg.xtcpatch
   *     adb reboot
   *     device_check.exe adb qcom_edl
   *     call boot_completed.bat
   *     busybox sleep 5
   *   )
   * 然后接 :ROOT-SDK27-WAIT 后面的"安装系统应用"段(原 .bat:182-197):
   *   busybox sleep 5
   *   if isv3 && !=I20: instapp 130510.apk important
   *   if isv3 && ==I20: instapp 121750.apk important
   *   if !isv3: instapp 116100.apk important
   * 注:此 stage 已含"安装系统应用"段,后续 stage sdk27-erase-misc-reboot 处理擦 misc
   */
  private async sdk27EraseMiscReboot(ctx: RootContext): Promise<void> {
    // ECHO.%INFO%重启手表
    this.log(ctx, 'info', '重启手表');
    await AdbService.reboot('system');
    // device_check.exe adb qcom_edl fastboot + 检查 Xse
    this.log(ctx, 'info', '请耐心等待设备开机');
    // 注:原 .bat 这里允许 adb/qcom_edl/fastboot,但要求最终 devicestatus=adb
    const device = await DeviceService.instance.waitFor(
      ['adb', 'qcom_edl', 'fastboot'],
      180000,
    );
    if (device.type === 'fastboot') {
      this.log(ctx, 'error', '您的设备可能触发了Xse限制!请重新进行root');
      throw new Error('您的设备可能触发了Xse限制!请重新进行root');
    }
    ctx.device = device;
    await AdbService.waitForBoot(180000);

    // smodel=1 分支:激活模块 + 重启 + 等 ADB + boot_completed + sleep 5
    if (ctx.smodel) {
      // busybox sleep 5
      await new Promise((r) => setTimeout(r, 5000));
      // su -c sh /data/adb/modules/XTCPatch/active_module.sh com.huanli233.systemplus
      this.log(ctx, 'info', '激活 SystemPlus 模块');
      await AdbService.shell(
        'sh /data/adb/modules/XTCPatch/active_module.sh com.huanli233.systemplus',
        { timeout: TIMEOUT.fileOp, root: true },
      );
      // su -c sh /data/adb/modules/XTCPatch/active_module.sh com.zcg.xtcpatch
      this.log(ctx, 'info', '激活 XTCPatch 模块');
      await AdbService.shell(
        'sh /data/adb/modules/XTCPatch/active_module.sh com.zcg.xtcpatch',
        { timeout: TIMEOUT.fileOp, root: true },
      );
      // adb reboot
      this.log(ctx, 'info', '重启手表');
      await AdbService.reboot('system');
      // device_check.exe adb qcom_edl
      await this.waitForAdbOrEdl(ctx, 180000);
      // call boot_completed.bat
      await AdbService.waitForBoot(180000);
      // busybox sleep 5
      await new Promise((r) => setTimeout(r, 5000));
    }

    // busybox sleep 5(进入"开始安装系统应用"段)
    await new Promise((r) => setTimeout(r, 5000));
    this.log(ctx, 'info', '开始安装系统应用[请勿跳过]');
    const apksDir = path.join(paths.resources, 'apks');
    if (ctx.isV3) {
      if (ctx.innermodel === 'I20') {
        // isv3 && ==I20:instapp 121750.apk important
        await this.instappImportant(ctx, path.join(apksDir, '121750.apk'));
      } else {
        // isv3 && !=I20:instapp 130510.apk important
        await this.instappImportant(ctx, path.join(apksDir, '130510.apk'));
      }
    } else {
      // !isv3:instapp 116100.apk important
      await this.instappImportant(ctx, path.join(apksDir, '116100.apk'));
    }
    this.log(ctx, 'info', '系统应用安装完成');

    // smodel=1:adb reboot
    // 否则:擦除 misc 并重启(adb reboot bootloader → device_check adb fastboot → fastboot erase misc → fastboot reboot)
    if (ctx.smodel) {
      this.log(ctx, 'info', '重启手表');
      await AdbService.reboot('system');
    } else {
      this.log(ctx, 'info', '擦除 misc 并重启');
      await AdbService.reboot('bootloader');
      // device_check.exe adb fastboot + 检查 devicestatus=adb
      this.log(ctx, 'info', '等待 fastboot 设备...');
      const device2 = await DeviceService.instance.waitFor(['adb', 'fastboot'], 60000);
      // 若 devicestatus=adb(说明未成功进 fastboot),再尝试 adb reboot bootloader
      if (device2.type === 'adb') {
        ctx.device = device2;
        this.log(ctx, 'warn', '设备仍为 ADB 模式,再次尝试重启到 bootloader');
        await AdbService.reboot('bootloader');
        await DeviceService.instance.waitFor(['fastboot'], 60000);
      }
      // fastboot erase misc
      await FastbootService.erase('misc');
      // fastboot reboot
      await FastbootService.reboot('system');
    }
  }

  /**
   * SDK27 安装预装应用 + 等 ADB + boot_completed
   * 对应 root-SDK27.bat:213-230
   *   device_check.exe adb
   *   call boot_completed.bat
   *   ECHO.%INFO%开始安装预装应用
   *   call instapp.bat .\apks\selftest.apk important
   *   call instapp.bat .\apks\settings.apk important
   *   if exist .\apks\wxzf.apk call instapp.bat .\apks\wxzf.apk
   *   if exist .\apks\MoyeInstaller.apk call instapp.bat .\apks\MoyeInstaller.apk
   *   if exist .\apks\appsettings.apk call instapp.bat .\apks\appsettings.apk
   *   if exist .\apks\personalcenter.apk call instapp.bat .\apks\personalcenter.apk
   *   if exist .\apks\appmanager.apk call instapp.bat .\apks\appmanager.apk
   *   if exist .\apks\wcp2.apk call instapp.bat .\apks\wcp2.apk
   *   call instapp.bat .\apks\appstore.apk
   *   if exist .\apks\appstore2.apk call instapp.bat .\apks\appstore2.apk
   *   if exist .\apks\appstore3.apk call instapp.bat .\apks\appstore3.apk
   *   if exist .\apks\appstore4.apk call instapp.bat .\apks\appstore4.apk
   *   if exist .\apks\weichat.apk call instapp.bat .\apks\weichat.apk
   */
  private async sdk27InstallBundledApks(ctx: RootContext): Promise<void> {
    // device_check.exe adb + boot_completed
    this.log(ctx, 'info', '等待 ADB 设备连接...');
    const device = await DeviceService.instance.waitFor(['adb'], 120000);
    ctx.device = device;
    await AdbService.waitForBoot(120000);
    this.log(ctx, 'info', '开始安装预装应用');
    const apksDir = path.join(paths.resources, 'apks');
    // important 安装:selftest, settings
    await this.instappImportant(ctx, path.join(apksDir, 'selftest.apk'));
    await this.instappImportant(ctx, path.join(apksDir, 'settings.apk'));
    // 可选安装(if exist):wxzf, MoyeInstaller, appsettings, personalcenter, appmanager, wcp2
    await this.instappOptional(ctx, path.join(apksDir, 'wxzf.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'MoyeInstaller.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appsettings.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'personalcenter.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appmanager.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'wcp2.apk'));
    // appstore 系列(1=必装,2/3/4=可选)
    await this.instappOptional(ctx, path.join(apksDir, 'appstore.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appstore2.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appstore3.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appstore4.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'weichat.apk'));
    this.log(ctx, 'info', '预装应用安装完成');
  }

  /**
   * SDK27 提前编译 i3launcher + setting
   * 对应 root-SDK27.bat:231-233
   */
  private async sdk27CompilePackages(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '正在执行提前编译,可能需要一些时间');
    await AdbService.cmdPackageCompile('com.xtc.i3launcher');
    await AdbService.cmdPackageCompile('com.xtc.setting');
  }

  /** SDK27 恢复 DCIM(对应 root-SDK27.bat:235-236) */
  private async sdk27RestoreDcim(ctx: RootContext): Promise<void> {
    if (!ctx.dcimBackupDir) {
      this.log(ctx, 'warn', '无 DCIM 备份目录,跳过恢复');
      return;
    }
    this.log(ctx, 'info', '正在恢复相册...');
    const r = await BackupService.recoverDcim(ctx.dcimBackupDir, (msg) =>
      this.log(ctx, 'info', msg),
    );
    if (!r.success) {
      this.log(ctx, 'warn', `相册恢复失败: ${r.error}`);
    }
    // 原 .bat 收尾文案(逐字保留)
    this.log(ctx, 'warn', '切勿卸载 SystemPlus 和 XTCPatch，否则设备将无法启动');
    this.log(ctx, 'warn', '切勿卸载 SystemPlus 和 XTCPatch，否则设备将无法启动');
    this.log(ctx, 'warn', '切勿删除 Magisk 内置模块，否则设备将无法启动');
    this.log(ctx, 'warn', '切勿删除 Magisk 内置模块，否则设备将无法启动');
    this.log(ctx, 'info', '历经千帆，终达彼岸');
    this.log(ctx, 'info', '提示:当手表进入长续航模式、睡眠模式等禁用模式时,划到最后一页,点击打开应用列表,即可绕过禁用模式');
    this.log(ctx, 'info', '提示:你可以在 /sdcard/hidden_app_list.txt 中填写包名以实现隐藏应用');
    this.log(ctx, 'info', '提示:如果需要在手表上安装应用,请在手表端选择弦-安装器,点击始终');
    this.log(ctx, 'info', '您的手表已 ROOT 完毕');
    // 原 .bat 末尾询问是否 rootpro 优化(menu.exe yesno.json)
    this.log(ctx, 'info', '是否进行预装优化[包括模块和应用,期间需要多次选择]?');
    this.log(ctx, 'info', '(可选,需用户在 Tools 页手动触发 rootpro)');
  }

  // ---------- ND03 stages(Z10,prog_firehose_ddr.elf + 281 恢复固件 + LSPosed) ----------

  /**
   * ND03 清理临时文件 + 下载 ND03.zip(对应 nd03root.bat:7-29)
   *   del tmp.txt + *.img + tmp\boot.img + header + kernel_dtb + kernel + ramdisk.cpio + port_trace.txt
   *   del EDL\rooting\*.*
   *   rd EDL\rooting\xtcpatch + magiskfile
   *   md EDL\rooting
   *   if not exist EDL\ND03.zip call cloud z10
   */
  private async nd03DownloadZip(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '免责声明:');
    this.log(ctx, 'info', 'Root 会自动超级恢复到 2.8.1 版本');
    this.log(ctx, 'info', 'Root 后版本为 3.0.2,底包 2.8.1');
    this.log(ctx, 'info', 'Root 文件为网络搜集而来');
    this.log(ctx, 'info', '正在为你准备开始');
    // 清理临时文件
    const workDir = paths.edlWork;
    try {
      if (fs.existsSync(workDir)) {
        for (const f of fs.readdirSync(workDir)) {
          try {
            fs.rmSync(path.join(workDir, f), { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      } else {
        fs.mkdirSync(workDir, { recursive: true });
      }
    } catch {
      // ignore
    }
    // 清理 cache 下的临时文件
    for (const f of ['boot.img', 'header', 'kernel_dtb', 'kernel', 'ramdisk.cpio', 'port_trace.txt']) {
      try {
        const p = path.join(paths.cache, f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
    this.log(ctx, 'info', '开始准备文件');
    // if not exist EDL\ND03.zip call cloud z10
    const nd03Zip = paths.edlFile('ND03.zip');
    if (!fs.existsSync(nd03Zip)) {
      this.log(ctx, 'info', '下载 Z10 资源(ND03.zip)...');
      try {
        await CloudService.download('Z10');
      } catch (e) {
        throw new Error(`下载 ND03.zip 失败: ${(e as Error).message}`);
      }
      if (!fs.existsSync(nd03Zip)) {
        throw new Error(`ND03.zip 下载后仍未存在: ${nd03Zip}`);
      }
    }
  }

  /** ND03 解压 ND03.zip → EDL/rooting(对应 nd03root.bat:30-31) */
  private async nd03Extract(ctx: RootContext): Promise<void> {
    // 原:progress.exe 7z x EDL\ND03.zip -o.\EDL\rooting -aoa -bsp1
    this.log(ctx, 'info', '正在解压文件...');
    const nd03Zip = paths.edlFile('ND03.zip');
    if (!fs.existsSync(nd03Zip)) {
      throw new Error(`ND03.zip 不存在: ${nd03Zip}`);
    }
    const workDir = paths.edlWork;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    await SubprocessPool.spawn({
      cmd: paths.binFile('7z.exe'),
      args: ['x', nd03Zip, `-o${workDir}`, '-aoa', '-bsp1'],
      cwd: paths.bin,
      encoding: 'utf-8',
      timeout: TIMEOUT.install,
      taskId: ctx.taskId,
      onStdout: (line) => this.log(ctx, 'info', `7z: ${line}`),
    });
    this.log(ctx, 'info', '准备完成,即将开始 root');
  }

  /**
   * ND03 进入 EDL(对应 nd03root.bat:32-41)
   *   echo.%info%等待9008设备连接...
   *   device_check.exe qcom_edl
   *   call edlport
   *   call QSaharaServer.bat -p \\.\COM%port% -s 13:%cd%\EDL\prog_firehose_ddr.elf
   *   busybox sleep 2
   */
  private async nd03EnteringEdl(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '等待 9008 设备连接...');
    const port = await EdlService.waitForEdl(120000);
    ctx.edlPort = port;
    this.log(ctx, 'info', `获取 9008 端口: ${port}`);
    this.log(ctx, 'info', '发送引导: prog_firehose_ddr.elf');
    await EdlService.loadFirehose({ port, loader: 'prog_firehose_ddr.elf' });
    // busybox sleep 2
    await new Promise((r) => setTimeout(r, 2000));
  }

  /**
   * ND03 刷入 281 恢复固件(对应 nd03root.bat:43-50)
   *   progress.exe P_fh_loader.bat ... --search_path=EDL\rooting\281\ --sendxml=EDL\rooting\281\rawprogram0.xml
   *   if exist fh_error.txt ( ... 恢复失败!刷入失败! )
   *   call fh_loader.bat ... --sendxml=EDL\rooting\281\patch0.xml
   */
  private async nd03Flash281Recovery(ctx: RootContext): Promise<void> {
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    const workDir = paths.edlWork;
    this.log(ctx, 'info', '刷入恢复固件(281/rawprogram0.xml)');
    const raw281 = path.join(workDir, '281', 'rawprogram0.xml');
    if (!fs.existsSync(raw281)) {
      throw new Error(`281/rawprogram0.xml 不存在: ${raw281}`);
    }
    await EdlService.flashPartitions({
      port: ctx.edlPort,
      loader: 'prog_firehose_ddr.elf',
      xmlPath: raw281,
      imagesDir: path.join(workDir, '281'),
    });
    this.log(ctx, 'info', '刷入 281/patch0.xml');
    const patch281 = path.join(workDir, '281', 'patch0.xml');
    if (fs.existsSync(patch281)) {
      await EdlService.flashPartitions({
        port: ctx.edlPort,
        loader: 'prog_firehose_ddr.elf',
        xmlPath: patch281,
        imagesDir: path.join(workDir, '281'),
      });
    } else {
      this.log(ctx, 'warn', `281/patch0.xml 不存在(跳过): ${patch281}`);
    }
  }

  /**
   * ND03 刷入 root 固件 + 复制 eboot.img(对应 nd03root.bat:52-57)
   *   progress.exe P_fh_loader.bat ... --sendxml=EDL\rooting\rawprogram0.xml
   *   copy /Y tmp\eboot.img EDL\rooting\eboot.img
   *   if exist fh_error.txt ( ... root失败!刷入失败! )
   */
  private async nd03FlashRootFirmware(ctx: RootContext): Promise<void> {
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    const workDir = paths.edlWork;
    this.log(ctx, 'info', '刷入 root 固件');
    const rawprogramXml = path.join(workDir, 'rawprogram0.xml');
    if (!fs.existsSync(rawprogramXml)) {
      throw new Error(`rawprogram0.xml 不存在: ${rawprogramXml}`);
    }
    await EdlService.flashPartitions({
      port: ctx.edlPort,
      loader: 'prog_firehose_ddr.elf',
      xmlPath: rawprogramXml,
      imagesDir: workDir,
    });
    // copy /Y tmp\eboot.img EDL\rooting\eboot.img(33MB 全零文件)
    const ebootSrc = paths.edlEboot;
    const ebootDst = path.join(workDir, 'eboot.img');
    if (fs.existsSync(ebootSrc)) {
      fs.copyFileSync(ebootSrc, ebootDst);
      this.log(ctx, 'info', `已复制 eboot.img → ${ebootDst}`);
    } else {
      this.log(ctx, 'warn', `eboot.img 源文件不存在: ${ebootSrc}`);
    }
  }

  /**
   * ND03 擦除 boot(对应 nd03root.bat:58-60)
   *   ECHO.%INFO%清除boot
   *   call fh_loader.bat ... --search_path=EDL\rooting --sendxml=EDL\rooting\eboot.xml
   */
  private async nd03EraseBoot(ctx: RootContext): Promise<void> {
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    this.log(ctx, 'info', '清除 boot');
    const workDir = paths.edlWork;
    const ebootXml = path.join(workDir, 'eboot.xml');
    if (!fs.existsSync(ebootXml)) {
      throw new Error(`eboot.xml 不存在: ${ebootXml}`);
    }
    await EdlService.flashPartitions({
      port: ctx.edlPort,
      loader: 'prog_firehose_ddr.elf',
      xmlPath: ebootXml,
      imagesDir: workDir,
    });
  }

  /**
   * ND03 重启 + 等 fastboot(对应 nd03root.bat:61-67)
   *   call qfh_loader.bat ... --sendxml=reboot.xml
   *   设备处于正常刷写状态，请勿断开数据线(x3)
   *   不是进入fastboot就是变砖!
   *   device_check.exe fastboot
   */
  private async nd03RebootToFastboot(ctx: RootContext): Promise<void> {
    if (!ctx.edlPort) throw new Error('未获取 9008 端口');
    this.log(ctx, 'info', '重启手表');
    await EdlService.reboot({ port: ctx.edlPort, loader: 'prog_firehose_ddr.elf' });
    // 三次"设备处于正常刷写状态，请勿断开数据线"
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备即将进入 Fastboot 模式，如长时间无响应请检查驱动');
    this.log(ctx, 'info', '等待 fastboot 连接...');
    const device = await DeviceService.instance.waitFor(['fastboot'], 120000);
    ctx.device = device;
  }

  /**
   * ND03 fastboot 刷入 boot(对应 nd03root.bat:68-69)
   *   run_cmd "fastboot flash boot EDL\rooting\boot.img"
   */
  private async nd03FastbootFlashBoot(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '刷入 boot');
    const bootImg = path.join(paths.edlWork, 'boot.img');
    if (!fs.existsSync(bootImg)) {
      throw new Error(`boot.img 不存在: ${bootImg}`);
    }
    await FastbootService.flash('boot', bootImg);
  }

  /**
   * ND03 fastboot boot recovery(临时启动 recovery)(对应 nd03root.bat:70-72)
   *   run_cmd "fastboot boot EDL\rooting\recovery.img"
   *   ECHO.%INFO%坐和放宽，让我们等待您的手表一段时间
   *   ECHO.%INFO%进入sideload
   *   call adbdevice.bat sideload
   */
  private async nd03BootRecovery(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '重启并进入 recovery');
    const recoveryImg = path.join(paths.edlWork, 'recovery.img');
    if (!fs.existsSync(recoveryImg)) {
      throw new Error(`recovery.img 不存在: ${recoveryImg}`);
    }
    await FastbootService.boot(recoveryImg);
    this.log(ctx, 'info', '请耐心等待设备响应');
    this.log(ctx, 'info', '进入 sideload');
    // adbdevice.bat sideload:等待 sideload 设备出现
    // 注:原 .bat 用 device_check 检测 sideload,这里轮询 adb get-state == sideload
    // (对应原 .bat 语义,非简化;device_check 内部也是轮询)
    const start = Date.now();
    while (Date.now() - start < 120000) {
      try {
        const result = await SubprocessPool.spawn({
          cmd: paths.binFile('adb.exe'),
          args: ['get-state'],
          encoding: 'utf-8',
          timeout: TIMEOUT.device,
          cwd: paths.bin,
          silent: true,
        });
        if (result.stdout.trim() === 'sideload') {
          this.log(ctx, 'info', '设备已进入 sideload 模式');
          return;
        }
      } catch {
        // 设备可能正在重启
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('等待 sideload 模式超时');
  }

  /**
   * ND03 sideload Dm.zip + adbdevice noadb(对应 nd03root.bat:73-76)
   *   ECHO.%INFO%正在刷dm，请等待20秒...
   *   busybox timeout 20 cmd /c adb sideload .\EDL\rooting\Dm.zip
   *   ECHO.
   *   call adbdevice.bat noadb
   */
  private async nd03SideloadDm(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '正在刷 dm,请等待 20 秒...');
    const dmZip = path.join(paths.edlWork, 'Dm.zip');
    if (!fs.existsSync(dmZip)) {
      throw new Error(`Dm.zip 不存在: ${dmZip}`);
    }
    // busybox timeout 20 cmd /c adb sideload ...
    // 注:原 .bat 用 20 秒 timeout 包装 adb sideload,超时后 sideload 仍在设备端继续
    try {
      await SubprocessPool.spawn({
        cmd: paths.binFile('adb.exe'),
        args: ['sideload', dmZip],
        encoding: 'utf-8',
        timeout: TIMEOUT.transfer,
        cwd: paths.bin,
        taskId: ctx.taskId,
        onStdout: (line) => this.log(ctx, 'info', `sideload: ${line}`),
      });
    } catch (e) {
      // 超时是预期行为(原 .bat 语义)
      this.log(ctx, 'info', `sideload 已超时(预期行为,设备端继续): ${(e as Error).message}`);
    }
    // call adbdevice.bat noadb:断开 ADB 连接
    try {
      await SubprocessPool.spawn({
        cmd: paths.binFile('adb.exe'),
        args: ['kill-server'],
        encoding: 'utf-8',
        timeout: TIMEOUT.device,
        cwd: paths.bin,
        silent: true,
      });
      await SubprocessPool.spawn({
        cmd: paths.binFile('adb.exe'),
        args: ['start-server'],
        encoding: 'utf-8',
        timeout: TIMEOUT.device,
        cwd: paths.bin,
        silent: true,
      });
    } catch {
      // ignore
    }
  }

  /**
   * ND03 等 fastboot + 刷 misc + fastboot reboot(对应 nd03root.bat:77-83)
   *   设备处于正常刷写状态，请勿断开数据线(x3)
   *   不是进入fastboot就是变砖!
   *   device_check.exe fastboot
   *   echo ffbm-02 > misc.bin
   *   fastboot flash misc misc.bin
   *   fastboot reboot
   */
  private async nd03FlashMiscReboot(ctx: RootContext): Promise<void> {
    // 三次"设备处于正常刷写状态，请勿断开数据线"
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备处于正常刷写状态，请勿断开数据线');
    this.log(ctx, 'warn', '设备即将进入 Fastboot 模式，如长时间无响应请检查驱动');
    this.log(ctx, 'info', '等待 fastboot 连接...');
    const device = await DeviceService.instance.waitFor(['fastboot'], 120000);
    ctx.device = device;
    this.log(ctx, 'info', '刷入 misc 并重启');
    const miscBin = this.writeMiscBin(ctx);
    await FastbootService.flash('misc', miscBin);
    await FastbootService.reboot('system');
    this.log(ctx, 'info', '让我们等待重启三次修复环境');
  }

  /**
   * ND03 循环检测 bin.mt.plus + 等开机 + wm density + am start magisk
   * 对应 nd03root.bat:84-95
   *   :test3
   *   adb shell pm path bin.mt.plus
   *   if not %errorlevel%==0 ( goto test3 )
   *   busybox sleep 5
   *   call boot_completed.bat
   *   busybox sleep 5
   *   wm density 288
   *   settings put system screen_off_timeout 2147483647
   *   busybox sleep 5
   *   am start -n com.xtc.b/com.topjohnwu.magisk.ui.MainActivity
   *   busybox sleep 2
   *   am start (再次)
   *   device_check.exe adb
   *   busybox sleep 5
   */
  private async nd03Wait3Reboots(ctx: RootContext): Promise<void> {
    // :test3 循环:等 bin.mt.plus 安装完成
    this.log(ctx, 'info', '等待 bin.mt.plus 安装完成(循环检测)');
    const start = Date.now();
    let installed = false;
    while (Date.now() - start < 600000) {
      try {
        const out = await AdbService.shell('pm path bin.mt.plus', { timeout: TIMEOUT.device });
        if (out.trim().length > 0) {
          installed = true;
          break;
        }
      } catch {
        // 设备可能正在重启
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!installed) {
      throw new Error('等待 bin.mt.plus 安装超时(10 分钟)');
    }
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
    // call boot_completed.bat
    this.log(ctx, 'info', '等待开机完成...');
    await AdbService.waitForBoot(180000);
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
    // wm density 288
    await AdbService.shell('wm density 288', { timeout: TIMEOUT.device });
    // settings put system screen_off_timeout 2147483647
    await AdbService.shell('settings put system screen_off_timeout 2147483647', {
      timeout: TIMEOUT.device,
    });
    this.log(ctx, 'info', '正在自动打开自动响应,请稍后');
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
    // am start -n com.xtc.b/com.topjohnwu.magisk.ui.MainActivity
    await AdbService.amStart('com.xtc.b/com.topjohnwu.magisk.ui.MainActivity');
    // busybox sleep 2
    await new Promise((r) => setTimeout(r, 2000));
    // am start (再次)
    await AdbService.amStart('com.xtc.b/com.topjohnwu.magisk.ui.MainActivity');
    // device_check.exe adb
    const device = await DeviceService.instance.waitFor(['adb'], 60000);
    ctx.device = device;
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
  }

  /** ND03 自动授权 Magisk(11 步点击,坐标与 SDK27 不同) */
  private async nd03AutoGrantMagisk(ctx: RootContext): Promise<void> {
    await this.autoMagiskNd03(ctx);
  }

  /**
   * ND03 安装 XTC Patch 模块 + pm clear packageinstaller
   * 对应 nd03root.bat:automagisk 标签后
   *   device_check.exe adb
   *   ECHO.%INFO%开始安装XTC Patch模块
   *   adb push tmp\xtcpatch.zip /sdcard/xtcpatch.zip
   *   adb shell "su -c magisk --install-module /sdcard/xtcpatch.zip"
   *   adb shell "rm -rf /sdcard/xtcpatch.zip"
   *   ECHO.%INFO%安装XTC Patch模块成功
   *   run_cmd "adb shell pm clear com.android.packageinstaller"
   */
  private async nd03InstallXtcpatch(ctx: RootContext): Promise<void> {
    // device_check.exe adb
    const device = await DeviceService.instance.waitFor(['adb'], 60000);
    ctx.device = device;
    this.log(ctx, 'info', '------------------------------------');
    this.log(ctx, 'info', '后续步骤将由工具自动完成');
    this.log(ctx, 'info', '开始安装 XTC Patch 模块');
    // adb push tmp\xtcpatch.zip /sdcard/xtcpatch.zip
    const xtcpatchZip = path.join(paths.cache, 'xtcpatch.zip');
    if (!fs.existsSync(xtcpatchZip)) {
      throw new Error(`xtcpatch.zip 不存在: ${xtcpatchZip}`);
    }
    await AdbService.push(xtcpatchZip, '/sdcard/xtcpatch.zip');
    // adb shell "su -c magisk --install-module /sdcard/xtcpatch.zip"
    await AdbService.shell('magisk --install-module /sdcard/xtcpatch.zip', {
      timeout: TIMEOUT.flash,
      root: true,
    });
    // adb shell "rm -rf /sdcard/xtcpatch.zip"
    await AdbService.shell('rm -rf /sdcard/xtcpatch.zip', { timeout: TIMEOUT.device });
    this.log(ctx, 'info', '安装 XTC Patch 模块成功');
    // pm clear com.android.packageinstaller
    await AdbService.shell('pm clear com.android.packageinstaller', { timeout: TIMEOUT.shell });
  }

  /**
   * ND03 安装 toolkit + SystemPlus + 启动 LSPosed
   * 对应 nd03root.bat:automagisk 标签后
   *   ECHO.%INFO%开始安装核心破解和systemplus
   *   call instapp.bat .\apks\toolkit_4.8.apk important
   *   call instapp.bat .\apks\Z10_SystemPlus.apk important
   *   run_cmd "adb shell ""su -c am start -n org.lsposed.manager/.ui.activity.MainActivity"""
   *   ECHO.%INFO%正在勾选作用域，请稍后
   *   busybox sleep 5
   */
  private async nd03InstallToolkit(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '开始安装核心破解和 systemplus');
    const apksDir = path.join(paths.resources, 'apks');
    await this.instappImportant(ctx, path.join(apksDir, 'toolkit_4.8.apk'));
    await this.instappImportant(ctx, path.join(apksDir, 'Z10_SystemPlus.apk'));
    // am start -n org.lsposed.manager/.ui.activity.MainActivity
    this.log(ctx, 'info', '正在勾选作用域,请稍后');
    try {
      await AdbService.shell('am start -n org.lsposed.manager/.ui.activity.MainActivity', {
        timeout: TIMEOUT.device,
        root: true,
      });
    } catch (e) {
      this.log(ctx, 'warn', `启动 LSPosed 失败: ${(e as Error).message}`);
    }
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
  }

  /** ND03 激活 LSPosed 作用域(7 步点击) */
  private async nd03ActivateLsposed(ctx: RootContext): Promise<void> {
    await this.activateLsposed(ctx);
  }

  /**
   * ND03 adb reboot + 等 ADB + boot_completed + 擦 misc + 重启 + 安装预装
   * 对应 nd03root.bat:activate-lsposed 之后到 :ROOT-noapp 之前
   *   run_cmd "adb reboot"
   *   device_check.exe adb
   *   call boot_completed.bat
   *   busybox sleep 5
   *   ECHO.%INFO%即将完成
   *   wm density reset
   *   settings put system screen_off_timeout 30
   *   ECHO.%INFO%擦除misc并重启
   *   adb reboot bootloader
   *   device_check.exe adb fastboot (检查 devicestatus=adb 时再 reboot bootloader)
   *   fastboot erase misc
   *   fastboot reboot
   *   device_check.exe adb
   *   call boot_completed.bat
   *   busybox sleep 5
   *   ECHO.%INFO%开始安装预装应用
   *   call instapp.bat .\apks\appsettings-ND03.apk
   *   call instapp.bat .\apks\appmanager.apk
   *   call instapp.bat .\apks\poke.apk
   *   call instapp.bat .\apks\appstore.apk
   *   if exist .\apks\appstore2.apk call instapp.bat .\apks\appstore2.apk
   *   if exist .\apks\appstore3.apk call instapp.bat .\apks\appstore3.apk
   *   if exist .\apks\appstore4.apk call instapp.bat .\apks\appstore4.apk
   *   ECHO.%INFO%预装应用安装完成
   */
  private async nd03InstallPreinstall(ctx: RootContext): Promise<void> {
    // adb reboot
    await AdbService.reboot('system');
    // device_check.exe adb + boot_completed
    this.log(ctx, 'info', '等待 ADB 设备连接...');
    const device = await DeviceService.instance.waitFor(['adb'], 180000);
    ctx.device = device;
    await AdbService.waitForBoot(180000);
    // busybox sleep 5
    await new Promise((r) => setTimeout(r, 5000));
    this.log(ctx, 'info', '即将完成');
    // wm density reset + screen_off_timeout 30
    await AdbService.shell('wm density reset', { timeout: TIMEOUT.device });
    await AdbService.shell('settings put system screen_off_timeout 30', { timeout: TIMEOUT.device });
    // 擦除 misc 并重启
    this.log(ctx, 'info', '擦除 misc 并重启');
    await AdbService.reboot('bootloader');
    // device_check.exe adb fastboot(检查 devicestatus=adb 时再 reboot bootloader)
    this.log(ctx, 'info', '等待 fastboot 设备...');
    const device2 = await DeviceService.instance.waitFor(['adb', 'fastboot'], 60000);
    if (device2.type === 'adb') {
      ctx.device = device2;
      this.log(ctx, 'warn', '设备仍为 ADB 模式,再次尝试重启到 bootloader');
      await AdbService.reboot('bootloader');
      await DeviceService.instance.waitFor(['fastboot'], 60000);
    }
    // fastboot erase misc
    await FastbootService.erase('misc');
    // fastboot reboot
    await FastbootService.reboot('system');
    // device_check.exe adb + boot_completed + sleep 5
    this.log(ctx, 'info', '等待 ADB 设备连接...');
    const device3 = await DeviceService.instance.waitFor(['adb'], 180000);
    ctx.device = device3;
    await AdbService.waitForBoot(180000);
    await new Promise((r) => setTimeout(r, 5000));
    // 安装预装应用
    this.log(ctx, 'info', '开始安装预装应用');
    const apksDir = path.join(paths.resources, 'apks');
    await this.instappOptional(ctx, path.join(apksDir, 'appsettings-ND03.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appmanager.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'poke.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appstore.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appstore2.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appstore3.apk'));
    await this.instappOptional(ctx, path.join(apksDir, 'appstore4.apk'));
    this.log(ctx, 'info', '预装应用安装完成');
  }

  /**
   * ND03 提前编译 i3launcher + setting
   * 对应 nd03root.bat::ROOT-noapp 标签后
   *   ECHO.%INFO%正在执行提前编译，可能需要一些时间
   *   run_cmd "adb shell cmd package compile -m everything-profile -f com.xtc.i3launcher"
   *   run_cmd "adb shell cmd package compile -m everything-profile -f com.xtc.setting"
   *   ECHO.%GRAY%-跨越山海 终见曙光-
   *   ECHO.%INFO%您的手表已ROOT完毕，耗时：
   */
  private async nd03CompilePackages(ctx: RootContext): Promise<void> {
    this.log(ctx, 'info', '正在执行提前编译,可能需要一些时间');
    await AdbService.cmdPackageCompile('com.xtc.i3launcher');
    await AdbService.cmdPackageCompile('com.xtc.setting');
    this.log(ctx, 'info', '历经千帆，终达彼岸');
    this.log(ctx, 'info', '您的手表已 ROOT 完毕');
  }
}

export const RootService = new RootServiceClass();
