/**
 * useTheme - 三态主题切换 Hook
 *
 * 支持 light / dark / system 三态：
 * - light：强制浅色
 * - dark：强制深色
 * - system：跟随系统 prefers-color-scheme（系统切换时自动响应）
 *
 * 通过在 <html> 上加 .dark / .light 类来切换主题（与 index.css 的 @custom-variant dark 配合）。
 * 选择持久化到 localStorage，刷新后保留。
 *
 * FOUC（Flash of Unstyled Content）防护：
 * - index.html 内联脚本会在 React 渲染前先根据 localStorage 应用一次主题
 * - 此 hook 在 mount 后再次应用（与内联脚本结果一致，避免重复闪烁）
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { Sun, Moon, Monitor, type LucideIcon } from './icons';

export type Theme = 'light' | 'dark' | 'system';

/** localStorage key */
const THEME_KEY = 'imoo_theme';

/** 所有可用主题（用于 ThemeToggle 渲染） */
export const THEMES: Theme[] = ['light', 'dark', 'system'];

/** 主题元数据（图标 + 短文案 + title） */
export const THEME_META: Record<Theme, { icon: LucideIcon; label: string; title: string }> = {
  light: { icon: Sun, label: '浅色', title: '浅色主题' },
  dark: { icon: Moon, label: '深色', title: '深色主题' },
  system: { icon: Monitor, label: '跟随系统', title: '跟随系统主题' },
};

/** 读取系统当前主题 */
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 解析为最终生效的 'light' | 'dark' */
export function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}

/**
 * 应用主题到 <html>：切换 .dark / .light 类
 * 同时更新 color-scheme（让原生表单控件、滚动条跟随）
 */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const effective = getEffectiveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', effective === 'dark');
  root.classList.toggle('light', effective === 'light');
  root.style.colorScheme = effective;
}

/** 从 localStorage 读取主题（兜底 system） */
function loadStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(THEME_KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

/**
 * 三态主题 Hook
 *
 * - 初次渲染从 localStorage 读取
 * - useEffect 中应用 + 监听系统主题变化（仅 system 模式）
 * - setTheme 持久化到 localStorage
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => loadStoredTheme());

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // localStorage 不可用（隐私模式等）时静默忽略
    }

    // 仅 system 模式监听系统主题变化
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  return { theme, setTheme };
}
