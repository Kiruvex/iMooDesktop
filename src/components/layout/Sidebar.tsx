// src/components/layout/Sidebar.tsx - 侧边导航(可折叠,美化版)
// 见 plan.md 9.4 AppShell 布局图
// 折叠状态:64px,只显示图标;展开:240px,显示图标+文字+分组

import { NavLink } from 'react-router-dom';
import {
  Home,
  ShieldCheck,
  RotateCw,
  Download,
  AppWindow,
  Boxes,
  DatabaseBackup,
  Wrench,
  Settings,
  ScrollText,
  PanelLeftClose,
  PanelLeft,
  Smartphone,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../stores/uiStore';
import { APP_META } from '../../../shared/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  milestone?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: '主功能',
    items: [
      { to: '/', label: '主菜单', icon: Home },
      { to: '/root', label: '一键 Root', icon: ShieldCheck },
    ],
  },
  {
    title: '工具',
    items: [
      { to: '/reboot', label: '高级重启', icon: RotateCw },
      { to: '/cloud', label: '资源下载', icon: Download },
      { to: '/apps', label: '应用管理', icon: AppWindow },
      { to: '/tools', label: '其他工具', icon: Wrench },
      { to: '/magisk', label: 'Magisk 模块', icon: Boxes },
      { to: '/backup', label: '备份恢复', icon: DatabaseBackup },
    ],
  },
];

// 底部固定项(系统操作)
const bottomItems: NavItem[] = [
  { to: '/logs', label: '日志查看', icon: ScrollText },
  { to: '/settings', label: '设置', icon: Settings },
];

export function Sidebar(): JSX.Element {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-zinc-800/60 bg-zinc-950/40 backdrop-blur-xl transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* 顶部:折叠/展开按钮 */}
      <div className="flex h-10 shrink-0 items-center border-b border-zinc-800/60 px-3">
        <button
          onClick={toggle}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-blue-400',
            collapsed && 'mx-auto',
          )}
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* 导航区 */}
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto py-4">
        {navGroups.map((group, groupIdx) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            {/* 分组标题 */}
            {!collapsed && (
              <div className="px-5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                {group.title}
              </div>
            )}
            {collapsed && groupIdx > 0 && (
              <div className="mx-3 my-2 h-px bg-zinc-800/60" />
            )}

            {/* 导航项 */}
            {group.items.map((item) => (
              <NavItemView key={item.to} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      {/* 底部固定项(日志/设置)+ 版本信息 */}
      <div className="shrink-0 border-t border-zinc-800/60 pt-2">
        <div className="flex flex-col gap-0.5 pb-2">
          {bottomItems.map((item) => (
            <NavItemView key={item.to} item={item} collapsed={collapsed} />
          ))}
        </div>
        {!collapsed && (
          <div className="border-t border-zinc-800/60 px-5 py-3">
            <div className="flex items-center gap-2 text-[10px] text-zinc-600">
              <Smartphone className="h-3 w-3" />
              <span>v{APP_META.version}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/** 单个导航项渲染(主导航和底部共用) */
function NavItemView({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}): JSX.Element {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center text-[13px] transition-colors',
          collapsed
            ? 'mx-2 justify-center p-2.5 rounded-lg'
            : 'mx-2 gap-3 px-3 py-2 rounded-lg',
          isActive
            ? 'bg-blue-500/10 text-blue-300'
            : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200',
          item.disabled &&
            'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-zinc-400',
        )
      }
      onClick={(e) => {
        if (item.disabled) e.preventDefault();
      }}
      title={collapsed ? item.label : undefined}
    >
      {({ isActive }) => (
        <>
          {/* 选中态左侧竖条(展开时) */}
          {isActive && !collapsed && (
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-blue-500" />
          )}
          <Icon
            className={cn(
              'h-4 w-4 shrink-0 transition-colors',
              isActive && 'text-blue-400',
            )}
          />
          {!collapsed && (
            <>
              <span className={cn('flex-1 truncate', isActive && 'font-medium')}>
                {item.label}
              </span>
              {item.disabled ? (
                <span className="rounded-full bg-zinc-800/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                  {item.milestone}
                </span>
              ) : (
                isActive && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}
