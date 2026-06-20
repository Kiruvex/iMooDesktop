// src/hooks/useMenu.ts - 加载菜单(从代码内常量,不再 fetch JSON)
//
// 重新定位(2026-06-18):菜单选项在 src/lib/menus.ts 里定义,
// 不再读 resources/menus/*.json。
// 这个 hook 保留,接口不变,路由仍可用 useMenu('rebootpro') 等。

import { getMenu, type MenuItem } from '../lib/menus';

export function useMenu(name: string): {
  menu: MenuItem[] | null;
  loading: boolean;
  error: string | null;
} {
  const menu = getMenu(name);
  return {
    menu: menu.length > 0 ? menu : null,
    loading: false,
    error: menu.length === 0 ? `未知菜单: ${name}` : null,
  };
}
