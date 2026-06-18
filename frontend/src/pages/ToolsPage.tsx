import { useState } from 'preact/hooks';
import { api } from '../lib/pyapi';
import { PageHeader, Button, Alert, Badge, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';
import { Copy, SearchX, Star } from '../lib/icons';
import { copyText } from '../lib/clipboard';

/** appsearch 真实返回结构（参考 core/watch_api.py）：
 *  r.data.searchList 数组，每项含完整应用信息。
 *  字段全部声明为可选以兼容部分缺失字段的接口响应；展示层做兜底 */
interface AppSearchItem {
  name?: string;
  appId?: string;
  versionName?: string;
  packageName?: string;
  sizeShow?: string;
  score?: number;
  developer?: string;
  upDateShow?: string;
  upgradeInfo?: string;
  summary?: string;
  url?: string;
  /** 旧字段兼容：mock 模式可能仍返回 desc/size/icon，渲染时优先用新字段 */
  desc?: string;
  size?: string;
  icon?: string;
}

type LoadingKind = '' | 'adb' | 'zj' | 'search';

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ToolsPage() {
  const [adbInput, setAdbInput] = useState('');
  const [adbResult, setAdbResult] = useState('');
  const [zjInput, setZjInput] = useState('');
  const [zjResult, setZjResult] = useState('');
  // 每个动作独立 loading，避免搜索按钮复用 'adb' 误导用户
  const [loading, setLoading] = useState<LoadingKind>('');
  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState<AppSearchItem[] | null>(null);
  const toast = useToast();

  const calcAdb = async () => {
    if (!adbInput || !/^\d+$/.test(adbInput)) {
      setAdbResult('');
      toast.warning('请输入纯数字');
      return;
    }
    if (adbInput.length !== 8) {
      setAdbResult('');
      toast.warning('ADB 校验码必须为 8 位数字');
      return;
    }
    setLoading('adb');
    setAdbResult('');
    try {
      const r = await api.calc_adb(adbInput);
      if (r.error) {
        setAdbResult(`错误: ${r.error}`);
        toast.error('算码失败', r.error);
      } else if (!r.result) {
        setAdbResult('错误: 算码返回空结果');
        toast.error('算码失败', '返回空结果，请检查输入');
      } else {
        setAdbResult(r.result);
        toast.success('ADB 校验码已生成');
      }
    } catch (e: unknown) {
      setAdbResult(`错误: ${errMsg(e)}`);
      toast.error('算码异常', errMsg(e));
    } finally {
      setLoading('');
    }
  };

  const calcZj = async () => {
    if (!zjInput || !/^\d+$/.test(zjInput)) {
      setZjResult('');
      toast.warning('请输入纯数字');
      return;
    }
    if (zjInput.length !== 8) {
      setZjResult('');
      toast.warning('自检校验码必须为 8 位数字');
      return;
    }
    setLoading('zj');
    setZjResult('');
    try {
      const r = await api.calc_zj(zjInput);
      if (r.error) {
        setZjResult(`错误: ${r.error}`);
        toast.error('算码失败', r.error);
      } else if (!r.result) {
        setZjResult('错误: 算码返回空结果');
        toast.error('算码失败', '返回空结果，请检查输入');
      } else {
        setZjResult(r.result);
        toast.success('自检校验码已生成');
      }
    } catch (e: unknown) {
      setZjResult(`错误: ${errMsg(e)}`);
      toast.error('算码异常', errMsg(e));
    } finally {
      setLoading('');
    }
  };

  const handleSearch = async () => {
    if (!searchInput.trim()) {
      toast.warning('请输入应用名称');
      return;
    }
    setLoading('search');
    try {
      const r = await api.appsearch(searchInput.trim());
      if (r.code === '000001') {
        // appsearch 真实返回结构：r.data.searchList 数组
        // （旧版期望 r.data 直接是数组，已废弃）
        const dataAny = r.data as { searchList?: AppSearchItem[] } | AppSearchItem[] | undefined;
        let list: AppSearchItem[] = [];
        if (dataAny && Array.isArray((dataAny as { searchList?: AppSearchItem[] }).searchList)) {
          list = (dataAny as { searchList: AppSearchItem[] }).searchList;
        } else if (Array.isArray(dataAny)) {
          // 兜底兼容旧 mock 数据
          list = dataAny as AppSearchItem[];
        }
        setSearchResult(list);
        if (list.length === 0) {
          toast.info('未找到匹配应用');
        } else {
          toast.success('搜索完成', `找到 ${list.length} 个结果`);
        }
      } else {
        toast.error('搜索失败', r.desc);
        setSearchResult([]);
      }
    } catch (e: unknown) {
      toast.error('请求异常', errMsg(e));
      setSearchResult([]);
    } finally {
      setLoading('');
    }
  };

  // 剪贴板写入：统一走 lib/clipboard（含 isSecureContext 检查 + execCommand 兜底）
  const copyToClipboard = async (text: string) => {
    const ok = await copyText(text);
    if (ok) {
      toast.success('已复制到剪贴板');
    } else {
      toast.error('复制失败');
    }
  };

  return (
    <div class="mx-auto max-w-2xl space-y-5">
      <PageHeader title="算码工具" desc="ADB 校验码、自检校验码计算与应用搜索" />

      <Alert level="info">
        <strong>说明：</strong>输入手表 ADB / 自检界面显示的 8 位数字，工具算出对应校验码，输回手表即可解锁。算码为纯数学运算，与设备无关。
      </Alert>

      {/* ADB 校验码 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">ADB 校验码</h3>
            <p class="text-xs text-[var(--color-text-muted)]">process_adb_new — 用于 ADB 调试解锁</p>
          </div>
          <Badge level="info">encrypt_adb_new</Badge>
        </div>
        <div class="flex gap-2">
          <input
            type="text"
            class="input text-mono"
            value={adbInput}
            onInput={(e) => setAdbInput((e.target as HTMLInputElement).value)}
            placeholder="输入手表 ADB 界面显示的 8 位数字"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            spellcheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e as KeyboardEvent).isComposing && e.keyCode !== 229) calcAdb();
            }}
          />
          <Button onClick={calcAdb} loading={loading === 'adb'} disabled={!adbInput}>
            计算
          </Button>
        </div>
        {adbResult && (
          <div class="flex items-center gap-2">
            <div class="flex-1 rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-sm break-all">
              {adbResult}
            </div>
            <Button size="sm" variant="ghost" onClick={() => copyToClipboard(adbResult)} aria-label="复制 ADB 校验码">
              <Copy size={16} />
            </Button>
          </div>
        )}
      </div>

      {/* 自检校验码 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">自检校验码</h3>
            <p class="text-xs text-[var(--color-text-muted)]">process_self_check_new — 用于自检模式解锁</p>
          </div>
          <Badge level="info">encrypt_self_check_new</Badge>
        </div>
        <div class="flex gap-2">
          <input
            type="text"
            class="input text-mono"
            value={zjInput}
            onInput={(e) => setZjInput((e.target as HTMLInputElement).value)}
            placeholder="输入手表自检界面显示的 8 位数字"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            spellcheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e as KeyboardEvent).isComposing && e.keyCode !== 229) calcZj();
            }}
          />
          <Button onClick={calcZj} loading={loading === 'zj'} disabled={!zjInput}>
            计算
          </Button>
        </div>
        {zjResult && (
          <div class="flex items-center gap-2">
            <div class="flex-1 rounded-lg bg-[var(--color-surface-2)] p-3 font-mono text-sm break-all">
              {zjResult}
            </div>
            <Button size="sm" variant="ghost" onClick={() => copyToClipboard(zjResult)} aria-label="复制自检校验码">
              <Copy size={16} />
            </Button>
          </div>
        )}
      </div>

      {/* 应用商店搜索 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">应用商店搜索</h3>
            <p class="text-xs text-[var(--color-text-muted)]">搜索小天才应用商店中的应用</p>
          </div>
          <Badge level="gray">appsearch</Badge>
        </div>
        <div class="flex gap-2">
          <input
            type="text"
            class="input"
            value={searchInput}
            onInput={(e) => {
              // 中文输入法 composing（候选词组合）期间不更新 state，
              // 否则受控组件会把 value 重置回中间态，打断 IME 组词
              if ((e as any).isComposing) return;
              setSearchInput((e.target as HTMLInputElement).value);
            }}
            onCompositionEnd={(e) => {
              // 候选词确认后，把完整文本同步进 state
              setSearchInput((e.target as HTMLInputElement).value);
            }}
            placeholder="如：微信、QQ、抖音"
            spellcheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e as KeyboardEvent).isComposing && e.keyCode !== 229) handleSearch();
            }}
          />
          <Button onClick={handleSearch} loading={loading === 'search'} disabled={!searchInput.trim()}>
            搜索
          </Button>
        </div>
        {searchResult !== null && (
          <div class="rounded-lg bg-[var(--color-surface-2)] p-3">
            {searchResult.length === 0 ? (
              <EmptyState icon={<SearchX size={48} />} title="未找到应用" desc="试试其他关键词" />
            ) : (
              <div class="space-y-2">
                {searchResult.map((app, i) => {
                  // 优先用新字段（sizeShow / summary），兜底旧字段（size / desc）
                  const sizeLabel = app.sizeShow ?? app.size ?? '';
                  const descLabel = app.summary ?? app.desc ?? '';
                  const hasMeta = Boolean(
                    app.developer || app.versionName || sizeLabel ||
                      typeof app.score === 'number' || app.upDateShow
                  );
                  return (
                    <div
                      key={`${app.appId ?? app.name ?? ''}-${i}`}
                      class="rounded bg-[var(--color-surface)] p-3"
                    >
                      {/* 第一行：应用名 + 评分 + 大小徽章 */}
                      <div class="flex items-start gap-3">
                        {app.icon && (
                          <img
                            src={app.icon}
                            alt={`${app.name ?? ''} 图标`}
                            class="h-10 w-10 flex-none rounded"
                          />
                        )}
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-semibold">{app.name || '-'}</span>
                            {typeof app.score === 'number' && app.score > 0 && (
                              <span
                                class="badge"
                                style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}
                                title="应用评分"
                              >
                                <Star size={11} aria-hidden="true" />
                                {app.score.toFixed(1)}
                              </span>
                            )}
                            {sizeLabel && <Badge level="gray">{sizeLabel}</Badge>}
                            {app.versionName && (
                              <Badge level="info">v{app.versionName}</Badge>
                            )}
                          </div>
                          {app.developer && (
                            <div class="mt-0.5 text-xs text-[var(--color-text-muted)]">
                              开发者：{app.developer}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* 第二行：描述 + 更新时间 + 升级提示 + 下载链接 */}
                      {(descLabel || app.upDateShow || app.upgradeInfo || app.url) && (
                        <div class="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-text-muted)]">
                          {descLabel && <div>{descLabel}</div>}
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {app.upDateShow && (
                              <span title="更新时间">
                                更新：{app.upDateShow}
                              </span>
                            )}
                            {app.upgradeInfo && (
                              <span title="升级提示" class="text-[var(--color-warning)]">
                                {app.upgradeInfo}
                              </span>
                            )}
                            {app.packageName && (
                              <span title="包名" class="font-mono">
                                {app.packageName}
                              </span>
                            )}
                          </div>
                          {app.url && (
                            <div class="flex items-center gap-1">
                              <span class="text-[var(--color-text-light)]">下载：</span>
                              <code class="max-w-full truncate font-mono text-[var(--color-primary-dark)]" title={app.url}>
                                {app.url}
                              </code>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => copyToClipboard(app.url ?? '')}
                                aria-label="复制下载链接"
                                class="!px-1.5 !py-0.5"
                              >
                                <Copy size={12} />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      {!hasMeta && !descLabel && !app.url && (
                        <div class="mt-1 text-xs italic text-[var(--color-text-light)]">
                          暂无详细信息
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <Alert level="info">
        <strong>使用说明：</strong>在手表上进入 ADB 调试或自检模式后，屏幕会显示一串 8 位数字。将该数字输入对应框中即可算出校验码，把校验码输入回手表即可解锁。
      </Alert>
    </div>
  );
}
