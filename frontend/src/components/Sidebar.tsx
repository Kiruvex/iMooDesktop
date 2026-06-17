import { BrandIcon } from './BrandIcon';
import { Home, Smartphone, User, Activity, Globe, MessageCircle, Star, Wrench, Settings, X, type LucideIcon } from '../lib/icons';

export type PageId =
  | 'home'
  | 'device'
  | 'profile'
  | 'sport'
  | 'moment'
  | 'im'
  | 'likeall'
  | 'tools'
  | 'settings';

interface NavItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
  group: 'main' | 'social' | 'system';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: '首页', icon: Home, group: 'main' },
  { id: 'device', label: '设备信息', icon: Smartphone, group: 'main' },
  { id: 'profile', label: '资料修改', icon: User, group: 'main' },
  { id: 'sport', label: '运动数据', icon: Activity, group: 'main' },
  { id: 'moment', label: '好友圈', icon: Globe, group: 'social' },
  { id: 'im', label: '微聊', icon: MessageCircle, group: 'social' },
  { id: 'likeall', label: '批量点赞', icon: Star, group: 'social' },
  { id: 'tools', label: '工具', icon: Wrench, group: 'system' },
  { id: 'settings', label: '设置', icon: Settings, group: 'system' },
];

const GROUP_LABELS: Record<NavItem['group'], string> = {
  main: '功能',
  social: '社交',
  system: '系统',
};

interface SidebarProps {
  current: PageId;
  onChange: (id: PageId) => void;
  deviceBound: boolean;
  /** 版本信息（由 App.tsx 从 getVersion 获取后传入） */
  version?: string;
  /** 移动端抽屉是否打开（md 以下生效） */
  mobileOpen?: boolean;
  /** 移动端抽屉关闭回调 */
  onClose?: () => void;
}

function SidebarNav({
  current,
  onChange,
  deviceBound,
}: Pick<SidebarProps, 'current' | 'onChange' | 'deviceBound'>) {
  const groups: NavItem['group'][] = ['main', 'social', 'system'];
  return (
    <nav class="flex-1 overflow-y-auto px-3 py-3" aria-label="主导航">
      {groups.map((g) => (
        <div key={g} class="mb-3">
          <div class="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-light)]">
            {GROUP_LABELS[g]}
          </div>
          {NAV_ITEMS.filter((n) => n.group === g).map((item) => {
            const disabled = !deviceBound && item.id !== 'home' && item.id !== 'settings' && item.id !== 'tools';
            const active = current === item.id;
            return (
              <button
                key={item.id}
                onClick={() => !disabled && onChange(item.id)}
                disabled={disabled}
                aria-current={active ? 'page' : undefined}
                title={disabled ? '需先绑定设备' : undefined}
                class={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-all ${
                  active
                    ? 'bg-[var(--color-primary-bg)] text-[var(--color-primary)] font-semibold'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:pl-3.5 hover:text-[var(--color-text)]'
                } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {/* active 项左侧蓝色竖条 */}
                {active && (
                  <span
                    class="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]"
                    aria-hidden="true"
                  />
                )}
                <item.icon
                  size={20}
                  aria-hidden="true"
                  class={active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-light)] group-hover:text-[var(--color-text-muted)]'}
                />
                <span class="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div class="flex h-14 items-center gap-2.5 border-b border-[var(--color-border)] px-4">
      <BrandIcon size={28} />
      <div class="flex flex-col leading-none">
        <span class="text-[15px] font-bold tracking-tight text-[var(--color-text)]">iMoo</span>
        <span class="mt-0.5 text-[10px] font-medium tracking-wide text-[var(--color-text-light)]">DESKTOP</span>
      </div>
    </div>
  );
}

function VersionFooter({ version }: { version?: string }) {
  return (
    <div class="border-t border-[var(--color-border)] px-4 py-3">
      <div class="flex items-center gap-1.5 text-[10px] text-[var(--color-text-light)]">
        <span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-primary-light)] opacity-60" aria-hidden="true" />
        <span class="text-mono text-[10px] leading-none">{version || 'iMoo Desktop'}</span>
      </div>
    </div>
  );
}

/** 共享的 sidebar 容器样式 */
const SIDEBAR_BASE_CLASS =
  'flex flex-col bg-[var(--color-surface)]';

export function Sidebar({ current, onChange, deviceBound, version, mobileOpen, onClose }: SidebarProps) {
  return (
    <>
      {/* 桌面端：固定显示（md 及以上） */}
      <aside
        class={`hidden md:flex w-52 ${SIDEBAR_BASE_CLASS} border-r border-[var(--color-border)]`}
        style={{
          /* 右侧微妙渐变线：在 1px border 之上叠加一道极淡的蓝色光晕 */
          boxShadow: 'inset -1px 0 0 0 var(--color-border), 1px 0 12px -8px rgba(59, 130, 246, 0.15)',
        }}
      >
        <Brand />
        <SidebarNav current={current} onChange={onChange} deviceBound={deviceBound} />
        <VersionFooter version={version} />
      </aside>

      {/* 移动端：抽屉（md 以下，仅 mobileOpen 时渲染） */}
      {mobileOpen && (
        <aside
          class={`fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] ${SIDEBAR_BASE_CLASS} border-r border-[var(--color-border)] animate-slide-in-left md:hidden`}
          role="dialog"
          aria-modal="true"
          aria-label="导航菜单"
        >
          <div class="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
            <div class="flex items-center gap-2.5">
              <BrandIcon size={28} />
              <div class="flex flex-col leading-none">
                <span class="text-[15px] font-bold tracking-tight text-[var(--color-text)]">iMoo</span>
                <span class="mt-0.5 text-[10px] font-medium tracking-wide text-[var(--color-text-light)]">DESKTOP</span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="关闭菜单"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <X size={18} />
            </button>
          </div>
          <SidebarNav current={current} onChange={onChange} deviceBound={deviceBound} />
          <VersionFooter version={version} />
        </aside>
      )}
    </>
  );
}
