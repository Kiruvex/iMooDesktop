import type { PageId } from '../components/Sidebar';
import type { DeviceInfo } from '../lib/pyapi';
import { Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { BrandIcon } from '../components/BrandIcon';
import type { LucideIcon } from '../lib/icons';
import {
  Smartphone, Activity, Globe, Wrench, User, Star,
  ArrowRight, ClipboardList, Info,
} from '../lib/icons';

interface HomePageProps {
  onNavigate: (id: PageId) => void;
  deviceBound: boolean;
  device?: DeviceInfo | null;
}

interface Feature {
  id: PageId;
  label: string;
  icon: LucideIcon;
  desc: string;
}

const FEATURES: Feature[] = [
  { id: 'device', icon: Smartphone, label: '设备信息', desc: '查看手表状态、电量、机型' },
  { id: 'sport', icon: Activity, label: '运动数据', desc: '修改步数、跳绳、50米跑' },
  { id: 'moment', icon: Globe, label: '好友圈', desc: '浏览与发布动态' },
  { id: 'tools', icon: Wrench, label: '算码工具', desc: 'ADB / 自检校验码计算' },
  { id: 'profile', icon: User, label: '资料修改', desc: '修改名称、签名、实名' },
  { id: 'likeall', icon: Star, label: '批量点赞', desc: '一键给好友圈所有动态点赞' },
];

export function HomePage({ onNavigate, deviceBound, device }: HomePageProps) {
  const toast = useToast();

  const handleFeatureClick = (target: PageId) => {
    if (deviceBound) {
      onNavigate(target);
    } else {
      // 未绑定时拦截，引导到设置页
      toast.info('请先绑定设备');
      onNavigate('settings');
    }
  };

  return (
    <div class="mx-auto max-w-5xl space-y-6">
      {/* Hero 卡片：蓝色渐变 + 光晕 */}
      <div
        class="card relative overflow-hidden border-0 text-white"
        style={{
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)',
          boxShadow: '0 10px 30px rgba(59, 130, 246, 0.25), 0 4px 12px rgba(37, 99, 235, 0.18)',
        }}
      >
        {/* 光晕叠加：右上角白色光斑 */}
        <div
          class="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(circle at 100% 0%, rgba(255, 255, 255, 0.22), transparent 55%), radial-gradient(circle at 0% 100%, rgba(96, 165, 250, 0.25), transparent 50%)',
          }}
          aria-hidden="true"
        />
        {/* 微妙的网格纹理 */}
        <div
          class="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.12) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
          aria-hidden="true"
        />
        <div class="relative flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h1 class="mb-2 text-2xl font-bold tracking-tight md:text-3xl">欢迎使用 iMoo Desktop</h1>
            <p class="text-[15px] leading-relaxed text-white/85">
              {deviceBound
                ? `您的手表已绑定${device?.name ? ` · ${device.name}` : ''}，可以开始使用全部功能`
                : '请先绑定您的手表设备以开始使用'}
            </p>
            {!deviceBound && (
              <button
                onClick={() => onNavigate('settings')}
                class="btn mt-5 inline-flex items-center gap-1.5 border-0 bg-white text-[var(--color-primary-dark)] hover:bg-white/90"
                style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' }}
              >
                立即绑定 <ArrowRight size={14} />
              </button>
            )}
          </div>
          <div
            class="hidden opacity-95 sm:block"
            aria-hidden="true"
            style={{ filter: 'drop-shadow(0 8px 24px rgba(0, 0, 0, 0.2))' }}
          >
            <BrandIcon size={88} />
          </div>
        </div>
      </div>

      {deviceBound && device && (
        <div class="card card-compact">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span class="text-[var(--color-text-muted)]">当前设备：</span>
            <span class="font-semibold text-[var(--color-text)]">{device.name}</span>
            <Badge level="info">{device.model}</Badge>
            <span class="text-mono text-xs text-[var(--color-text-muted)]">watchid: {device.watchid}</span>
          </div>
        </div>
      )}

      <div>
        <h2 class="mb-4 text-lg font-bold tracking-tight text-[var(--color-text)]">快捷功能</h2>
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <button
              key={f.id}
              onClick={() => handleFeatureClick(f.id)}
              class={`group card card-compact card-hover flex min-h-[72px] items-center gap-3.5 text-left ${
                !deviceBound ? 'opacity-60' : ''
              }`}
              aria-label={f.label}
            >
              <span
                class="flex flex-none h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary-bg)] text-[var(--color-primary)] transition-all group-hover:bg-[var(--color-primary)] group-hover:text-white"
                aria-hidden="true"
              >
                <f.icon size={22} />
              </span>
              <div class="min-w-0 flex-1">
                <div class="font-semibold text-[var(--color-text)]">{f.label}</div>
                <div class="mt-0.5 text-xs text-[var(--color-text-muted)]">{f.desc}</div>
              </div>
            </button>
          ))}
        </div>
        {!deviceBound && (
          <p class="mt-3 text-xs text-[var(--color-text-muted)]">
            绑定设备后即可使用以上功能
          </p>
        )}
      </div>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div class="card">
          <h3 class="mb-3 flex items-center gap-2 font-bold text-[var(--color-text)]">
            <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-primary-bg)] text-[var(--color-primary)]">
              <ClipboardList size={16} />
            </span>
            使用说明
          </h3>
          <ul class="space-y-2 text-sm text-[var(--color-text-muted)]">
            <li class="flex items-start gap-2"><span class="mt-1.5 inline-block h-1 w-1 flex-none rounded-full bg-[var(--color-primary-light)]" aria-hidden="true" />绑定设备需要 chipid 和绑定号</li>
            <li class="flex items-start gap-2"><span class="mt-1.5 inline-block h-1 w-1 flex-none rounded-full bg-[var(--color-primary-light)]" aria-hidden="true" />所有操作均通过官方 API 执行，请合理使用</li>
            <li class="flex items-start gap-2"><span class="mt-1.5 inline-block h-1 w-1 flex-none rounded-full bg-[var(--color-primary-light)]" aria-hidden="true" />数据本地保存，不会上传到任何服务器</li>
            <li class="flex items-start gap-2"><span class="mt-1.5 inline-block h-1 w-1 flex-none rounded-full bg-[var(--color-primary-light)]" aria-hidden="true" />操作日志可在右上角图标中查看</li>
          </ul>
        </div>
        <div class="card">
          <h3 class="mb-3 flex items-center gap-2 font-bold text-[var(--color-text)]">
            <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-primary-bg)] text-[var(--color-primary)]">
              <Info size={16} />
            </span>
            关于
          </h3>
          <p class="text-sm leading-relaxed text-[var(--color-text-muted)]">
            iMoo Desktop 基于 sourxe-xtcbot 项目改造，使用 PySide6 + Preact + Tailwind CSS 构建。
            <br />
            所有数据保存在本地，不涉及任何云端服务。
          </p>
        </div>
      </div>
    </div>
  );
}
