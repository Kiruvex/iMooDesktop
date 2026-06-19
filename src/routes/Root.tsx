// src/routes/Root.tsx - Root 向导页
// 对应原 root.bat + ROOT-SDK19/25/27.bat + nd03root.bat
// 业务逻辑见 plan.md 6.7 RootService
//
// UI 规范(见 plan.md UI 规范):
//   - 蓝色主题(主交互色 blue-600/700)
//   - 无 emoji
//   - lucide-react SVG 图标

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  X,
  Search,
  Smartphone,
  Cpu,
  Zap,
  WifiOff,
  ChevronRight,
  FileText,
  Info,
} from 'lucide-react';
import { api, type RootContext, type RootOptions, type RootStage } from '../lib/api';
import { MODELS, type ModelInfo } from '../lib/models';
import { cn, formatTime } from '../lib/utils';
import { useDeviceStore } from '../stores/deviceStore';

// Stage 显示元信息(中文标签 + 图标 + 颜色)
interface StageMeta {
  label: string;
  group: 'prepare' | 'sdk19' | 'sdk25' | 'sdk27' | 'nd03' | 'final';
}

const STAGE_META: Record<RootStage, StageMeta> = {
  idle: { label: '空闲', group: 'prepare' },
  'preparing-resources': { label: '准备资源', group: 'prepare' },
  'showing-disclaimer': { label: '显示免责声明', group: 'prepare' },
  'detecting-device': { label: '检测设备', group: 'prepare' },
  'selecting-model': { label: '选择型号', group: 'prepare' },
  'entering-edl': { label: '进入 EDL', group: 'prepare' },
  'waiting-adb-after-edl': { label: 'EDL 后等待 ADB', group: 'prepare' },
  'reading-device-info': { label: '读取设备信息', group: 'prepare' },
  'detecting-v3': { label: '检测 V3 协议', group: 'prepare' },
  'extracting-root-zip': { label: '解压 Root 资源包', group: 'prepare' },
  'routing-by-sdk': { label: 'SDK 路由', group: 'prepare' },
  // SDK19
  'sdk19-backup-dcim': { label: '[SDK19] 备份相册', group: 'sdk19' },
  'sdk19-flash-boot': { label: '[SDK19] 刷入 boot', group: 'sdk19' },
  'sdk19-install-magisk': { label: '[SDK19] 安装 Magisk', group: 'sdk19' },
  'sdk19-install-xtcpatch': { label: '[SDK19] 刷入 xtcpatch', group: 'sdk19' },
  'sdk19-restore-dcim': { label: '[SDK19] 恢复相册', group: 'sdk19' },
  'sdk19-reboot': { label: '[SDK19] 重启', group: 'sdk19' },
  // SDK25
  'sdk25-backup-dcim': { label: '[SDK25] 备份相册', group: 'sdk25' },
  'sdk25-select-scheme': { label: '[SDK25] 选择方案', group: 'sdk25' },
  'sdk25-entering-edl': { label: '[SDK25] 进入 EDL', group: 'sdk25' },
  'sdk25-reading-boot': { label: '[SDK25] 读取 boot', group: 'sdk25' },
  'sdk25-patching-boot': { label: '[SDK25] 修补 boot', group: 'sdk25' },
  'sdk25-flashing': { label: '[SDK25] 刷入', group: 'sdk25' },
  'sdk25-rebooting': { label: '[SDK25] 重启', group: 'sdk25' },
  'sdk25-waiting-boot': { label: '[SDK25] 等待开机', group: 'sdk25' },
  'sdk25-install-magisk': { label: '[SDK25] 安装 Magisk', group: 'sdk25' },
  'sdk25-install-xtcpatch': { label: '[SDK25] 刷入 xtcpatch', group: 'sdk25' },
  'sdk25-boot-scheme-second-edl': { label: '[SDK25] 二次 EDL', group: 'sdk25' },
  'sdk25-restore-dcim': { label: '[SDK25] 恢复相册 + 检查 Magisk', group: 'sdk25' },
  // SDK27
  'sdk27-backup-dcim': { label: '[SDK27] 备份相册', group: 'sdk27' },
  'sdk27-entering-edl': { label: '[SDK27] 进入 EDL', group: 'sdk27' },
  'sdk27-reading-boot': { label: '[SDK27] 读取 boot', group: 'sdk27' },
  'sdk27-patching-boot': { label: '[SDK27] 修补 boot', group: 'sdk27' },
  'sdk27-flashing-rawprogram': { label: '[SDK27] 刷入 rawprogram', group: 'sdk27' },
  'sdk27-rebooting-to-fastboot': { label: '[SDK27] 重启至 Fastboot', group: 'sdk27' },
  'sdk27-fastboot-flash-boot': { label: '[SDK27] Fastboot 刷 boot', group: 'sdk27' },
  'sdk27-fastboot-flash-userdata': { label: '[SDK27] Fastboot 刷 userdata', group: 'sdk27' },
  'sdk27-fastboot-flash-misc': { label: '[SDK27] Fastboot 刷 misc', group: 'sdk27' },
  'sdk27-waiting-boot': { label: '[SDK27] 等待开机', group: 'sdk27' },
  'sdk27-install-preinstall': { label: '[SDK27] 安装预装', group: 'sdk27' },
  'sdk27-enable-charge': { label: '[SDK27] 开启充电可用', group: 'sdk27' },
  'sdk27-auto-grant-magisk': { label: '[SDK27] 自动授予 Magisk', group: 'sdk27' },
  'sdk27-activate-systemplus': { label: '[SDK27] 激活 SystemPlus', group: 'sdk27' },
  'sdk27-install-xtcpatch': { label: '[SDK27] 刷入 xtcpatch', group: 'sdk27' },
  'sdk27-install-systemui': { label: '[SDK27] 安装 SystemUI', group: 'sdk27' },
  'sdk27-install-preinstall-apk': { label: '[SDK27] 安装预装 APK', group: 'sdk27' },
  'sdk27-erase-misc-reboot': { label: '[SDK27] 擦除 misc 重启', group: 'sdk27' },
  'sdk27-install-bundled-apks': { label: '[SDK27] 安装捆绑 APK', group: 'sdk27' },
  'sdk27-compile-packages': { label: '[SDK27] 编译包', group: 'sdk27' },
  'sdk27-restore-dcim': { label: '[SDK27] 恢复相册', group: 'sdk27' },
  // ND03
  'nd03-download-zip': { label: '[ND03] 下载 zip', group: 'nd03' },
  'nd03-extract': { label: '[ND03] 解压', group: 'nd03' },
  'nd03-entering-edl': { label: '[ND03] 进入 EDL', group: 'nd03' },
  'nd03-flash-281-recovery': { label: '[ND03] 刷 281 恢复固件', group: 'nd03' },
  'nd03-flash-root-firmware': { label: '[ND03] 刷 root 固件', group: 'nd03' },
  'nd03-erase-boot': { label: '[ND03] 擦除 boot', group: 'nd03' },
  'nd03-reboot-to-fastboot': { label: '[ND03] 重启至 Fastboot', group: 'nd03' },
  'nd03-fastboot-flash-boot': { label: '[ND03] Fastboot 刷 boot', group: 'nd03' },
  'nd03-boot-recovery': { label: '[ND03] 启动 Recovery', group: 'nd03' },
  'nd03-sideload-dm': { label: '[ND03] Sideload dm', group: 'nd03' },
  'nd03-flash-misc-reboot': { label: '[ND03] 刷 misc 重启', group: 'nd03' },
  'nd03-wait-3-reboots': { label: '[ND03] 等待 3 次重启', group: 'nd03' },
  'nd03-auto-grant-magisk': { label: '[ND03] 自动授予 Magisk', group: 'nd03' },
  'nd03-install-xtcpatch': { label: '[ND03] 刷入 xtcpatch', group: 'nd03' },
  'nd03-install-toolkit': { label: '[ND03] 安装 toolkit', group: 'nd03' },
  'nd03-activate-lsposed': { label: '[ND03] 激活 LSPosed', group: 'nd03' },
  'nd03-install-preinstall': { label: '[ND03] 安装预装', group: 'nd03' },
  'nd03-compile-packages': { label: '[ND03] 编译包', group: 'nd03' },
  // 终态
  completed: { label: '已完成', group: 'final' },
  failed: { label: '已失败', group: 'final' },
  cancelled: { label: '已取消', group: 'final' },
};

// SDK25 方案选项(对应原 root-SDK25.json)
const SDK25_SCHEMES: { value: 'boot' | 'recovery'; label: string; description: string }[] = [
  {
    value: 'boot',
    label: 'BOOT 方案',
    description: '如果已经降级请选择此方案(刷入 boot 分区)',
  },
  {
    value: 'recovery',
    label: 'Recovery 方案',
    description: '最新系统可使用此方案(刷入 recovery + misc 分区)',
  },
];

export function Root(): JSX.Element {
  const device = useDeviceStore((s) => s.current);

  // 步骤状态
  const [disclaimerAgreed, setDisclaimerAgreed] = useState(false);
  const [simCardRemoved, setSimCardRemoved] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [nouserdata, setNouserdata] = useState(false);
  const [sdk25Scheme, setSdk25Scheme] = useState<'boot' | 'recovery'>('boot');

  // 运行时状态
  const [taskId, setTaskId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<RootContext | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 日志区域自动滚动
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [ctx?.logs.length]);

  // 订阅 stage 变化
  useEffect(() => {
    const unsub = api.root.onStageChange((newCtx) => {
      setCtx(newCtx);
      if (newCtx.stage === 'failed' || newCtx.stage === 'cancelled' || newCtx.stage === 'completed') {
        setStarting(false);
      }
    });
    return unsub;
  }, []);

  // 型号过滤
  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return MODELS;
    return MODELS.filter(
      (m) =>
        m.model.toLowerCase().includes(q) ||
        m.innermodel.toLowerCase().includes(q) ||
        m.series.toLowerCase().includes(q),
    );
  }, [modelSearch]);

  const canStart =
    disclaimerAgreed && simCardRemoved && (device?.type === 'adb' || device?.type === 'qcom_edl') && !starting;

  const handleStart = async (): Promise<void> => {
    setError(null);
    setStarting(true);
    try {
      const options: RootOptions = {
        nouserdata,
        sdk25Scheme,
        modelChoice: selectedModel?.innermodel,
      };
      const r = await api.root.start(options);
      if (!r.success || !r.taskId) {
        setError(r.error ?? '启动失败');
        setStarting(false);
        return;
      }
      setTaskId(r.taskId);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  const handlePause = async (): Promise<void> => {
    if (!taskId) return;
    await api.root.pause(taskId);
  };

  const handleResume = async (): Promise<void> => {
    if (!taskId) return;
    await api.root.resume(taskId);
  };

  const handleCancel = async (): Promise<void> => {
    if (!taskId) return;
    if (!window.confirm('确认取消 Root 流程?已刷入的分区不会回滚,但会尝试恢复 DCIM 相册。')) {
      return;
    }
    await api.root.cancel(taskId);
  };

  const isRunning = ctx !== null && !['completed', 'failed', 'cancelled'].includes(ctx.stage);
  const isPaused = ctx?.paused ?? false;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldAlert className="h-5 w-5 text-blue-500" />
          一键 Root
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          通过 ADB 或 EDL (9008) 模式 Root 手表。支持 SDK 19/25/27 全流程。
        </p>
      </div>

      {/* 免责声明 */}
      <section className="rounded-lg border border-red-900/40 bg-red-950/10 p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-medium text-red-200">Root 操作风险声明(必读)</h2>
        </div>
        <div className="space-y-2 text-xs leading-relaxed text-zinc-400">
          <p>
            <span className="font-medium text-zinc-300">数据丢失:</span>
            Root 操作会恢复出厂设置,设备上的全部本地数据(照片、视频、聊天记录等)将被清除。请提前备份。
          </p>
          <p>
            <span className="font-medium text-zinc-300">保修失效:</span>
            设备自进入 9008 模式起即刻丧失官方保修资格,且无法恢复。
          </p>
          <p>
            <span className="font-medium text-zinc-300">设备风险:</span>
            Root 过程中可能出现设备变砖、系统崩溃、功能异常等问题。刷机属于您个人自愿行为,
            因刷机导致的任何直接或间接损失(包括但不限于设备损坏、数据丢失、功能异常、保修失效、账号封禁等),
            开发者不承担任何责任。
          </p>
          <p>
            <span className="font-medium text-zinc-300">使用限制:</span>
            Root 后请在 48 小时内恢复官方系统。设备进入长续航/睡眠等禁用模式时,
            可滑动到最后一页点击「应用列表」绕过。请勿卸载 SystemPlus 和 XTCPatch,
            请勿删除 Magisk 内置模块,否则设备将无法启动。
          </p>
          <p className="text-red-300">
            <span className="font-medium">严禁解绑:</span>
            本工具严禁用于手表强制解绑。如拾获他人设备,请联系公安机关(110)归还失主,
            切勿尝试通过任何手段解除挂失锁。手表解绑属于违法行为,可能构成犯罪。
          </p>
          <p className="text-zinc-500">
            继续操作即表示您已阅读并同意《最终用户许可协议及免责声明》的全部条款。
          </p>
        </div>
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={disclaimerAgreed}
              onChange={(e) => setDisclaimerAgreed(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-600 text-blue-600 focus:ring-blue-500"
            />
            <span>我已仔细阅读并完全理解上述声明,自愿承担全部风险及责任</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={simCardRemoved}
              onChange={(e) => setSimCardRemoved(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-600 text-blue-600 focus:ring-blue-500"
            />
            <span>我已确认手表已拔出 SIM 卡</span>
          </label>
        </div>
      </section>

      {/* 设备状态 */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          设备状态
        </h2>
        {!device ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 py-8">
            <WifiOff className="h-8 w-8 text-zinc-600" />
            <div className="text-sm text-zinc-400">未检测到设备</div>
            <p className="max-w-md text-center text-xs text-zinc-500">
              请连接手表并开启 ADB 调试。也可让手表进入 9008 EDL 模式。
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="flex items-center gap-3">
              <DeviceIcon type={device.type} />
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-100">
                  {device.type === 'adb' && 'ADB 模式'}
                  {device.type === 'fastboot' && 'Fastboot 模式'}
                  {device.type === 'qcom_edl' && `9008 EDL 模式${device.port ? ` · ${device.port}` : ''}`}
                </div>
                <div className="text-[11px] text-zinc-500">
                  serial: {device.serial}
                  {device.innermodel && ` · innermodel: ${device.innermodel}`}
                  {device.sdkVersion && ` · SDK: ${device.sdkVersion}`}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 选项配置(仅在未运行时显示) */}
      {!isRunning && !ctx && (
        <>
          {/* EDL 模式选型号 */}
          {device?.type === 'qcom_edl' && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                选择型号(EDL 模式)
              </h2>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                {/* 搜索框 */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="搜索型号或 innermodel..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950/50 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                {/* 型号列表 */}
                <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-800/60">
                  {filteredModels.map((m) => (
                    <button
                      key={m.innermodel}
                      onClick={() => setSelectedModel(m)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-zinc-800/40 px-3 py-2 text-left text-xs transition-colors last:border-b-0',
                        selectedModel?.innermodel === m.innermodel
                          ? 'bg-blue-600/15 text-blue-200'
                          : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200',
                      )}
                    >
                      <Smartphone className="h-3.5 w-3.5 shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium">{m.model}</div>
                        <div className="text-[10px] text-zinc-500">
                          {m.innermodel} · {m.platform}
                        </div>
                      </div>
                      {selectedModel?.innermodel === m.innermodel && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />
                      )}
                    </button>
                  ))}
                </div>
                {selectedModel && (
                  <div className="mt-3 text-xs text-zinc-500">
                    已选: <span className="text-blue-300">{selectedModel.model}</span>
                    ({selectedModel.innermodel})
                  </div>
                )}
              </div>
            </section>
          )}

          {/* SDK25 方案选择(提前选,运行时根据 SDK 分支自动应用) */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              SDK25 方案(Android 7.1,如适用)
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SDK25_SCHEMES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSdk25Scheme(s.value)}
                  disabled={starting}
                  className={cn(
                    'rounded-md border p-3 text-left text-xs transition-colors',
                    sdk25Scheme === s.value
                      ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                      : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-blue-600/40 hover:bg-zinc-900/50',
                  )}
                >
                  <div className="font-medium">{s.label}</div>
                  <div className="mt-1 text-[10px] text-zinc-500">{s.description}</div>
                </button>
              ))}
            </div>
          </section>

          {/* 不刷 userdata */}
          <section>
            <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={nouserdata}
                onChange={(e) => setNouserdata(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-600 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <div className="font-medium text-zinc-200">不刷 userdata</div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  对应原 root.bat 的 nouserdata 参数。可能导致设备出现问题,谨慎选择。
                </div>
              </div>
            </label>
          </section>

          {/* 开始按钮 */}
          <section className="flex items-center gap-3">
            <button
              onClick={handleStart}
              disabled={!canStart}
              className={cn(
                'flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium text-white transition-colors',
                canStart
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-500',
              )}
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              {starting ? '启动中...' : '开始 Root'}
            </button>
            {!disclaimerAgreed && (
              <span className="text-xs text-amber-400">请先同意免责声明</span>
            )}
            {disclaimerAgreed && !simCardRemoved && (
              <span className="text-xs text-amber-400">请确认已拔出 SIM 卡</span>
            )}
            {disclaimerAgreed && simCardRemoved && (!device || (device.type !== 'adb' && device.type !== 'qcom_edl')) && (
              <span className="text-xs text-amber-400">需要 ADB 或 9008 EDL 模式设备</span>
            )}
          </section>

          {/* 启动错误 */}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-800/50 bg-red-950/20 p-3 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </>
      )}

      {/* 运行时:进度 + Stage + 日志 + 控制按钮 */}
      {(isRunning || ctx) && ctx && (
        <>
          {/* 进度卡片 */}
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StageIcon stage={ctx.stage} />
                <div>
                  <div className="text-sm font-medium text-zinc-100">
                    {STAGE_META[ctx.stage]?.label ?? ctx.stage}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    task: {ctx.taskId.slice(0, 24)}...
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-zinc-400">进度</div>
                <div className="text-lg font-semibold text-blue-400">{ctx.progress}%</div>
              </div>
            </div>
            {/* 进度条 */}
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  ctx.stage === 'failed'
                    ? 'bg-red-600'
                    : ctx.stage === 'cancelled'
                      ? 'bg-zinc-600'
                      : ctx.stage === 'completed'
                        ? 'bg-green-600'
                        : 'bg-blue-600',
                )}
                style={{ width: `${ctx.progress}%` }}
              />
            </div>
            {/* 设备信息 */}
            {(ctx.innermodel || ctx.sdkVersion) && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-zinc-500 sm:grid-cols-4">
                {ctx.innermodel && (
                  <div>
                    <span className="text-zinc-600">innermodel:</span>{' '}
                    <span className="text-zinc-300">{ctx.innermodel}</span>
                  </div>
                )}
                {ctx.sdkVersion && (
                  <div>
                    <span className="text-zinc-600">SDK:</span>{' '}
                    <span className="text-zinc-300">{ctx.sdkVersion}</span>
                  </div>
                )}
                {ctx.androidVersion && (
                  <div>
                    <span className="text-zinc-600">Android:</span>{' '}
                    <span className="text-zinc-300">{ctx.androidVersion}</span>
                  </div>
                )}
                <div>
                  <span className="text-zinc-600">V3:</span>{' '}
                  <span className="text-zinc-300">{ctx.isV3 ? '是' : '否'}</span>
                </div>
                {ctx.edlPort && (
                  <div>
                    <span className="text-zinc-600">EDL:</span>{' '}
                    <span className="text-zinc-300">{ctx.edlPort}</span>
                  </div>
                )}
                {ctx.sdk25Scheme && (
                  <div>
                    <span className="text-zinc-600">SDK25 方案:</span>{' '}
                    <span className="text-zinc-300">{ctx.sdk25Scheme}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 控制按钮 */}
          {isRunning && (
            <section className="flex items-center gap-2">
              {isPaused ? (
                <button
                  onClick={handleResume}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Play className="h-3 w-3" />
                  恢复
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="flex items-center gap-1.5 rounded-md border border-amber-700/60 bg-amber-900/10 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-700 hover:text-white"
                >
                  <Pause className="h-3 w-3" />
                  暂停
                </button>
              )}
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 rounded-md border border-red-700/60 bg-red-900/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-700 hover:text-white"
              >
                <X className="h-3 w-3" />
                取消
              </button>
            </section>
          )}

          {/* 错误提示 */}
          {ctx.error && (
            <div className="flex items-start gap-2 rounded-md border border-red-800/50 bg-red-950/20 p-3 text-sm text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Root 失败</div>
                <div className="mt-1 text-xs opacity-80">{ctx.error.message}</div>
                <div className="mt-1 text-[10px] opacity-60">失败 stage: {ctx.error.stage}</div>
              </div>
            </div>
          )}

          {/* 完成提示 */}
          {ctx.stage === 'completed' && (
            <div className="flex items-start gap-2 rounded-md border border-green-800/50 bg-green-950/20 p-3 text-sm text-green-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Root 完成</div>
                <div className="mt-1 text-xs opacity-80">
                  您的手表已 ROOT 完毕。提示:如果需要在手表上安装应用,请在手表端选择弦-安装器,点击始终。
                </div>
              </div>
            </div>
          )}

          {/* 完成后:SDK27 询问是否进行预装优化(对应 root-SDK27.bat 末尾的 yesno 菜单) */}
          {ctx.stage === 'completed' && ctx.sdkVersion === '27' && (
            <RootProPrompt taskId={ctx.taskId} />
          )}

          {/* 日志区域 */}
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <FileText className="h-3.5 w-3.5" />
              实时日志
              <span className="font-normal text-zinc-600">({ctx.logs.length})</span>
            </h2>
            <div
              ref={logRef}
              className="max-h-96 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-[11px] leading-relaxed"
            >
              {ctx.logs.length === 0 ? (
                <div className="text-zinc-600">暂无日志</div>
              ) : (
                ctx.logs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex gap-2',
                      log.level === 'error' && 'text-red-400',
                      log.level === 'warn' && 'text-amber-400',
                      log.level === 'info' && 'text-zinc-300',
                    )}
                  >
                    <span className="shrink-0 text-zinc-600">{formatTime(log.ts)}</span>
                    <span className="flex-1 break-all">{log.msg}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 完成后操作 */}
          {(ctx.stage === 'completed' || ctx.stage === 'failed' || ctx.stage === 'cancelled') && (
            <section className="flex items-center gap-2">
              <button
                onClick={() => {
                  setCtx(null);
                  setTaskId(null);
                  setStarting(false);
                  setError(null);
                }}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                <ChevronRight className="h-3 w-3" />
                重新开始
              </button>
            </section>
          )}
        </>
      )}

      {/* 帮助提示 */}
      {!ctx && (
        <section className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-3 text-xs text-blue-200">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
            <div className="space-y-1">
              <div>连接方式:</div>
              <div className="text-blue-300/80">
                1. 手表打开拨号盘输入 <code className="rounded bg-blue-950/60 px-1 py-0.5 text-blue-200">*#0769651#*</code> 打开 ADB 开关
              </div>
              <div className="text-blue-300/80">
                2. 打开手表卡槽,用金属物品短接触点进入 9008 EDL 模式
              </div>
              <div className="text-blue-300/60">
                Z2/Z3/Z5A/Z5Q/Z6 请使用方式一,Z2 v3.3.5 需超降级。
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ========== 辅助组件 ==========

function DeviceIcon({ type }: { type: string }): JSX.Element {
  switch (type) {
    case 'adb':
    case 'emulator':
      return <Smartphone className="h-4 w-4 text-blue-400" />;
    case 'fastboot':
      return <Zap className="h-4 w-4 text-amber-400" />;
    case 'qcom_edl':
    case 'sprd_edl':
      return <Cpu className="h-4 w-4 text-purple-400" />;
    default:
      return <Smartphone className="h-4 w-4 text-zinc-400" />;
  }
}

function StageIcon({ stage }: { stage: RootStage }): JSX.Element {
  if (stage === 'completed') return <CheckCircle2 className="h-5 w-5 text-green-400" />;
  if (stage === 'failed') return <AlertTriangle className="h-5 w-5 text-red-400" />;
  if (stage === 'cancelled') return <X className="h-5 w-5 text-zinc-400" />;
  return <Loader2 className="h-5 w-5 animate-spin text-blue-400" />;
}

// ========== 完成后 SDK27 预装优化提示(对应 root-SDK27.bat 末尾的 yesno) ==========

function RootProPrompt({ taskId: _taskId }: { taskId: string }): JSX.Element {
  const [dismissed, setDismissed] = useState(false);
  const [opts, setOpts] = useState({ installApks: true, installDesktop: true, installMods: false });
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    supported: boolean;
    error?: string;
  } | null>(null);

  if (dismissed) return <></>;

  const handleExecute = async (): Promise<void> => {
    setExecuting(true);
    setResult(null);
    try {
      const r = await api.tools.rootpro(opts);
      setResult({ success: r.success, supported: r.supported, error: r.error });
    } catch (e) {
      setResult({
        success: false,
        supported: false,
        error: (e as Error).message,
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="rounded-md border border-blue-800/50 bg-blue-950/10 p-4 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-blue-200">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        是否进行预装优化?
      </div>
      <p className="mb-3 text-xs text-blue-300/70">
        对应 root-SDK27.bat 末尾的 yesno 菜单:包括拓展应用包、禁用模式切换桌面、拓展 magisk 模块。
        期间需要多次选择(此处用复选框代替)。
      </p>

      {!result && (
        <>
          <div className="mb-3 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-blue-200 cursor-pointer">
              <input
                type="checkbox"
                checked={opts.installApks}
                onChange={(e) => setOpts({ ...opts, installApks: e.target.checked })}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              安装拓展应用包(rootproapks.txt)
            </label>
            <label className="flex items-center gap-2 text-xs text-blue-200 cursor-pointer">
              <input
                type="checkbox"
                checked={opts.installDesktop}
                onChange={(e) => setOpts({ ...opts, installDesktop: e.target.checked })}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              安装禁用模式切换桌面
            </label>
            <label className="flex items-center gap-2 text-xs text-blue-200 cursor-pointer">
              <input
                type="checkbox"
                checked={opts.installMods}
                onChange={(e) => setOpts({ ...opts, installMods: e.target.checked })}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              刷拓展 magisk 模块(rootpromods.txt)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExecute}
              disabled={executing}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {executing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />}
              {executing ? '执行中...' : '是,进行预装优化'}
            </button>
            <button
              onClick={() => setDismissed(true)}
              disabled={executing}
              className="rounded-md border border-blue-800/50 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900/30 disabled:opacity-50"
            >
              否,跳过
            </button>
          </div>
        </>
      )}

      {result && (
        <div
          className={
            result.success
              ? 'flex items-center gap-2 rounded-md border border-green-800/50 bg-green-950/20 p-2.5 text-xs text-green-300'
              : 'flex items-center gap-2 rounded-md border border-red-800/50 bg-red-950/20 p-2.5 text-xs text-red-300'
          }
        >
          {result.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {result.success
              ? '预装优化完成'
              : result.error ?? '预装优化失败(可在“其他工具”页重试)'}
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="ml-auto rounded px-2 py-0.5 text-xs hover:bg-zinc-800"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
