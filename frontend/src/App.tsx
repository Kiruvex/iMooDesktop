import { Component, type ComponentChildren, type ErrorInfo } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getVersion, getConfig, onDeviceChanged, setConfig } from './lib/pyapi';
import type { DeviceInfo } from './lib/pyapi';
import { useTheme } from './lib/useTheme';
import { Sidebar, type PageId } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ToastProvider } from './components/Toast';
import { ConfirmHolder } from './components/ui';
import { Frown } from './lib/icons';
import { HomePage } from './pages/HomePage';
import { DeviceInfoPage } from './pages/DeviceInfoPage';
import { ProfilePage } from './pages/ProfilePage';
import { SportPage } from './pages/SportPage';
import { MomentPage } from './pages/MomentPage';
import { IMPage } from './pages/IMPage';
import { LikeAllPage } from './pages/LikeAllPage';
import { ToolsPage } from './pages/ToolsPage';
import { SettingsPage } from './pages/SettingsPage';

// 合法页面白名单（用于校验持久化的 last_page）
const VALID_PAGES: PageId[] = ['home', 'device', 'profile', 'sport', 'moment', 'im', 'likeall', 'tools', 'settings'];

// 未绑定时禁止访问的页面（解绑后若当前页是这些则自动跳 home）
const DEVICE_REQUIRED_PAGES: PageId[] = ['device', 'profile', 'sport', 'moment', 'im', 'likeall'];

// ===== ErrorBoundary：任一页面 render 抛错不再白屏 =====
interface ErrorBoundaryProps {
  children: ComponentChildren;
  onReset: () => void;
}
interface ErrorBoundaryState {
  error: Error | null;
}
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[App] page render error:', error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <div class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <Frown size={64} class="text-[var(--color-text-light)]" aria-hidden="true" />
          <h2 class="text-lg font-semibold">页面出错了</h2>
          <p class="max-w-md text-sm text-[var(--color-text-muted)]">
            {this.state.error.message || '渲染过程中发生未知错误'}
          </p>
          <button class="btn btn-primary" onClick={this.handleReset}>
            返回首页
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const [page, setPage] = useState<PageId>('home');
  const [version, setVersion] = useState('');
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  // 主题初始化（最早执行，避免 FOUC：index.html 内联脚本已先应用一次，
  // 这里再 sync 一次保证 hook 内 state 与 DOM 一致；system 模式监听系统变化）
  const { theme, setTheme } = useTheme();

  // 移动端 sidebar 抽屉开关（md 以下生效；选中导航项后自动关闭）
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // race condition 处理：标记用户是否已主动点击切换页面
  // 配合 getConfig 异步返回：若用户已主动切换，则不再用 cfg.last_page 覆盖
  const userClickedRef = useRef(false);
  // 持久化 last_page 的 debounce timer
  const savePageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载版本与配置
  useEffect(() => {
    getVersion()
      .then((v) => setVersion(`v${v.app} · Python ${v.python} · ${v.platform}`))
      .catch(() => setVersion('版本获取失败'));
  }, []);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setDevice(cfg.device);
        // 仅在用户未主动切换页面时，才用持久化的 last_page 恢复
        if (!userClickedRef.current && cfg.last_page && VALID_PAGES.includes(cfg.last_page as PageId)) {
          setPage(cfg.last_page as PageId);
        }
      })
      .catch((e) => console.warn('[App] getConfig failed', e));
  }, []);

  // 监听设备变化（绑定/解绑触发）
  useEffect(() => {
    return onDeviceChanged((d) => setDevice(d));
  }, []);

  // 解绑后若当前页是设备相关页，自动跳回 home
  useEffect(() => {
    if (!device && DEVICE_REQUIRED_PAGES.includes(page)) {
      setPage('home');
    }
  }, [device, page]);

  const handlePageChange = useCallback((p: PageId) => {
    userClickedRef.current = true;
    setPage(p);
    // 切页后关闭移动端抽屉
    setSidebarOpen(false);
    // 持久化当前页面（debounce 500ms，避免频繁切页时连续写盘）
    if (savePageTimerRef.current) clearTimeout(savePageTimerRef.current);
    savePageTimerRef.current = setTimeout(() => {
      setConfig({ last_page: p }).catch(() => {});
    }, 500);
  }, []);

  const renderPage = () => {
    switch (page) {
      case 'home':
        return <HomePage onNavigate={handlePageChange} deviceBound={!!device} />;
      case 'device':
        return <DeviceInfoPage device={device} />;
      case 'profile':
        return <ProfilePage device={device} />;
      case 'sport':
        return <SportPage />;
      case 'moment':
        return <MomentPage />;
      case 'im':
        return <IMPage />;
      case 'likeall':
        return <LikeAllPage />;
      case 'tools':
        return <ToolsPage />;
      case 'settings':
        return <SettingsPage device={device} />;
      default:
        return <HomePage onNavigate={handlePageChange} deviceBound={!!device} />;
    }
  };

  return (
    <div class="flex h-screen overflow-hidden">
      {/* 移动端遮罩：md 以下，sidebarOpen 时点击关闭 */}
      {sidebarOpen && (
        <div
          class="fixed inset-0 z-40 bg-black/40 animate-fade-in md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        current={page}
        onChange={handlePageChange}
        deviceBound={!!device}
        version={version}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div class="flex flex-1 flex-col overflow-hidden">
        <TopBar
          version={version}
          deviceBound={!!device}
          deviceName={device?.name}
          theme={theme}
          onThemeChange={setTheme}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main class="flex-1 overflow-y-auto p-4 md:p-6 animate-fade-in" key={page}>
          <ErrorBoundary onReset={() => handlePageChange('home')}>
            {renderPage()}
          </ErrorBoundary>
        </main>
      </div>
      <ConfirmHolder />
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

export default App;
