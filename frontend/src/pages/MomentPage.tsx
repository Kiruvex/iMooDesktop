import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { api } from '../lib/pyapi';
import type { ParsedMoment, MomentListResult } from '../lib/pyapi';
import { PageHeader, Button, Alert, EmptyState, Skeleton, Badge, Modal } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDevice } from '../lib/useDevice';
import { confirm } from '../components/ui';
import {
  Link2, FileText, Image, Film, Inbox, Check, X, ImagePlus, Trash2, Heart, MessageCircle,
  ChevronLeft, ChevronRight,
} from '../lib/icons';
import type { LucideIcon } from '../lib/icons';

type PublishType = 'text' | 'image' | 'link';
type FilterType = 'all' | 'text' | 'image' | 'video' | 'link';

/** 动态类型元信息：图标 + 短标签（用于筛选 Tab / TypeBadge） */
const TYPE_META: Record<Exclude<FilterType, 'all'>, { label: string; icon: LucideIcon }> = {
  text: { label: '文本', icon: FileText },
  image: { label: '图片', icon: Image },
  video: { label: '视频', icon: Film },
  link: { label: '链接', icon: Link2 },
};

/** 发布类型 Tab（无 video，标签略不同） */
const PUBLISH_TABS: { key: PublishType; label: string; icon: LucideIcon }[] = [
  { key: 'text', label: '纯文本', icon: FileText },
  { key: 'image', label: '图片', icon: Image },
  { key: 'link', label: '链接卡片', icon: Link2 },
];

/** 筛选类型 Tab（含 all） */
const FILTER_TABS: { key: FilterType; label: string; icon?: LucideIcon }[] = [
  { key: 'all', label: '全部' },
  { key: 'text', label: TYPE_META.text.label, icon: TYPE_META.text.icon },
  { key: 'image', label: TYPE_META.image.label, icon: TYPE_META.image.icon },
  { key: 'video', label: TYPE_META.video.label, icon: TYPE_META.video.icon },
  { key: 'link', label: TYPE_META.link.label, icon: TYPE_META.link.icon },
];

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 把时间戳/时间字符串归一为毫秒时间戳；解析失败返回 0 */
function toTimestamp(t: number | string | unknown): number {
  if (typeof t === 'number') {
    if (!isFinite(t) || t <= 0) return 0;
    // ms vs s
    return t > 1e12 ? t : t * 1000;
  }
  if (typeof t === 'string') {
    // 兼容 mock 返回纯数字字符串
    const n = Number(t);
    if (!isNaN(n) && n > 0) return n > 1e12 ? n : n * 1000;
    const ts = Date.parse(t);
    if (!isNaN(ts)) return ts;
  }
  return 0;
}

/** 绝对时间格式化（用于 title / 详情卡片右上角） */
function formatAbsoluteTime(t: number | string): string {
  if (!t && t !== 0) return '';
  const ts = toTimestamp(t);
  if (ts === 0) return String(t);
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(t);
  }
}

/** 相对时间格式化："刚刚 / N 分钟前 / N 小时前 / N 天前 / 绝对日期" */
function formatRelativeTime(t: number | string): string {
  const ts = toTimestamp(t);
  if (ts === 0) return String(t);
  const diff = Date.now() - ts;
  // 未来时间或负数：回退到绝对时间
  if (diff < 0) return formatAbsoluteTime(t);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  try {
    return new Date(ts).toLocaleDateString('zh-CN');
  } catch {
    return String(t);
  }
}

/** 兼容旧调用名 */
const formatTime = formatAbsoluteTime;

/** File → 纯 base64（剥离 data:image/xxx;base64, 前缀），用于上传 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** File → dataURL（含前缀），用于本地预览 */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 判断动态类型 */
function getMomentType(m: ParsedMoment): Exclude<FilterType, 'all'> {
  if (m.videos && m.videos.length > 0) return 'video';
  if (m.images && m.images.length > 0) return 'image';
  if (m.type === 'link' || (m.content && m.content.startsWith('http'))) return 'link';
  return 'text';
}

/** 格式化文件大小 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface ImageUploadState {
  fileName: string;
  fileSize: number;
  dataUrl: string; // 本地预览（含 data:image/...;base64, 前缀）
  base64: string;  // 纯 base64（不含前缀），发布时传给后端 momentpic
}

export function MomentPage() {
  const device = useDevice();
  const [moments, setMoments] = useState<ParsedMoment[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ParsedMoment | null>(null);
  const [posting, setPosting] = useState(false);
  const [newContent, setNewContent] = useState('');
  // 发布类型 Tab
  const [publishType, setPublishType] = useState<PublishType>('text');
  // 图片上传
  const [imgState, setImgState] = useState<ImageUploadState | null>(null);
  // 链接卡片
  const [linkDesc, setLinkDesc] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  // 动态筛选
  const [filterType, setFilterType] = useState<FilterType>('all');
  // 图片大图查看
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  const toast = useToast();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchPage = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const r: MomentListResult = await api.momentview(p);
      if (!mountedRef.current) return;
      if (r.code === '000001') {
        setMoments((prev) => (append ? [...prev, ...r.moments] : r.moments));
        setHasMore(r.has_more);
        setPage(p);
      } else {
        setError(r.desc || '加载失败');
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(errMsg(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (device) {
      fetchPage(1, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.watchid]);

  // 切换 Tab 时保留 newContent，只清当前 Tab 专属字段
  const switchPublishType = (t: PublishType) => {
    if (t === publishType) return;
    if (publishType === 'image') setImgState(null);
    if (publishType === 'link') {
      setLinkDesc('');
      setLinkUrl('');
    }
    setPublishType(t);
  };

  // 选择图片 → 仅本地预览 + 取 base64（发布时一并传给后端 momentpic，不再调 uploadImage）
  const handleImageSelect = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('请选择图片文件');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.warning('图片大小请控制在 10MB 以内');
      return;
    }
    let dataUrl: string;
    let base64: string;
    try {
      dataUrl = await fileToDataURL(file);
      base64 = await fileToBase64(file);
    } catch (e: unknown) {
      toast.error('图片读取失败', errMsg(e));
      return;
    }
    if (!mountedRef.current) return;
    setImgState({
      fileName: file.name,
      fileSize: file.size,
      dataUrl,
      base64,
    });
    toast.success('图片已就绪', '发布时将自动上传');
  };

  const handlePublish = async () => {
    if (!newContent.trim()) {
      toast.warning('请输入动态内容');
      return;
    }
    if (publishType === 'image') {
      if (!imgState || !imgState.base64) {
        toast.warning('请先选择图片');
        return;
      }
    }
    if (publishType === 'link') {
      if (!linkDesc.trim()) {
        toast.warning('请输入链接描述');
        return;
      }
      if (!linkUrl.trim()) {
        toast.warning('请输入链接 URL');
        return;
      }
      if (!/^https?:\/\//i.test(linkUrl.trim())) {
        toast.warning('链接需以 http:// 或 https:// 开头');
        return;
      }
    }
    setPosting(true);
    try {
      let r;
      let optimisticExtra: Partial<ParsedMoment> = {};
      if (publishType === 'text') {
        // moment 的 momentid 参数 = 用户文本内容（后端将其写入 appName），bgid 默认 105
        r = await api.moment(newContent.trim(), '105');
      } else if (publishType === 'image') {
        // 直接调 momentpic（后端内部完成上传 + 发布 4 步流程）
        r = await api.momentpic(imgState!.base64, newContent.trim());
        optimisticExtra = { images: [imgState!.dataUrl], type: 'image' };
      } else {
        // link
        r = await api.momentlink(linkDesc.trim(), linkUrl.trim());
        optimisticExtra = {
          type: 'link',
          content: `${linkDesc.trim()}\n${linkUrl.trim()}`,
        };
      }
      if (!mountedRef.current) return;
      if (r.code === '000001') {
        toast.success('动态已发布');
        const optimisticId = 'optimistic-' + Date.now();
        const optimistic: ParsedMoment = {
          id: optimisticId,
          moment_id: optimisticId,
          nickname: '我',
          content: newContent.trim(),
          images: [],
          videos: [],
          time: Date.now(),
          like_count: 0,
          comment_count: 0,
          comments: [],
          type: publishType,
          ...optimisticExtra,
        };
        setMoments((prev) => [optimistic, ...prev]);
        // 清空当前 Tab 专属字段
        setNewContent('');
        if (publishType === 'image') setImgState(null);
        if (publishType === 'link') {
          setLinkDesc('');
          setLinkUrl('');
        }
      } else {
        toast.error('发布失败', r.desc);
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      toast.error('请求异常', errMsg(e));
    } finally {
      if (mountedRef.current) setPosting(false);
    }
  };

  // 返回 true 表示已成功删除（调用方可据此关闭 Modal）
  const handleDelete = async (m: ParsedMoment): Promise<boolean> => {
    const ok = await confirm({
      title: '删除动态',
      message: `确定要删除「${m.content.slice(0, 30)}${m.content.length > 30 ? '...' : ''}」这条动态吗？`,
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return false;
    try {
      const r = await api.delmoment(m.id || m.moment_id || '');
      if (!mountedRef.current) return false;
      if (r.code === '000001') {
        toast.success('动态已删除');
        setMoments((prev) =>
          prev.filter((x) => {
            const idMatch = !!m.id && x.id === m.id;
            const midMatch = !!m.moment_id && x.moment_id === m.moment_id;
            return !idMatch && !midMatch;
          })
        );
        return true;
      } else {
        toast.error('删除失败', r.desc);
        return false;
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return false;
      toast.error('请求异常', errMsg(e));
      return false;
    }
  };

  // 前端筛选（不重新拉 API）
  const filteredMoments = useMemo(() => {
    if (filterType === 'all') return moments;
    return moments.filter((m) => getMomentType(m) === filterType);
  }, [moments, filterType]);

  // 各类型计数
  const typeCounts = useMemo(() => {
    const counts: Record<FilterType, number> = { all: moments.length, text: 0, image: 0, video: 0, link: 0 };
    for (const m of moments) {
      const t = getMomentType(m);
      counts[t]++;
    }
    return counts;
  }, [moments]);

  if (!device) {
    return <EmptyState icon={<Link2 size={48} />} title="尚未绑定设备" desc="请先在设置中绑定设备" />;
  }

  return (
    <div class="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="好友圈"
        desc="浏览与发布好友圈动态"
        actions={
          <Button variant="secondary" onClick={() => fetchPage(1, false)} loading={loading}>
            刷新
          </Button>
        }
      />

      {/* 发布新动态 */}
      <div class="card space-y-3">
        <h3 class="font-medium">发布新动态</h3>

        {/* 发布类型 Tab */}
        <div
          class="flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1"
          role="tablist"
          aria-label="发布类型"
        >
          {PUBLISH_TABS.map((t) => {
            const Icon = t.icon;
            const active = publishType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                class={`inline-flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
                onClick={() => switchPublishType(t.key)}
              >
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
        </div>

        <textarea
          class="input"
          value={newContent}
          onInput={(e) => {
            if ((e as any).isComposing) return;
            setNewContent((e.target as HTMLTextAreaElement).value);
          }}
          onCompositionEnd={(e) => setNewContent((e.target as HTMLTextAreaElement).value)}
          placeholder={
            publishType === 'link'
              ? '动态文案（可选，与链接描述一同发布）'
              : '今天发生了什么有趣的事...'
          }
          rows={3}
          maxLength={500}
          spellcheck={false}
        />

        {/* 图片上传区域 */}
        {publishType === 'image' && (
          <ImageUploader
            imgState={imgState}
            onSelect={handleImageSelect}
            onClear={() => setImgState(null)}
          />
        )}

        {/* 链接卡片输入 */}
        {publishType === 'link' && (
          <div class="space-y-2">
            <div>
              <label htmlFor="moment-link-desc" class="label">
                链接描述
              </label>
              <input
                id="moment-link-desc"
                type="text"
                class="input"
                value={linkDesc}
                onInput={(e) => {
                  if ((e as any).isComposing) return;
                  setLinkDesc((e.target as HTMLInputElement).value);
                }}
                onCompositionEnd={(e) => setLinkDesc((e.target as HTMLInputElement).value)}
                placeholder="例如：今天看到的好文章"
                maxLength={100}
                spellcheck={false}
              />
            </div>
            <div>
              <label htmlFor="moment-link-url" class="label">
                链接 URL
              </label>
              <input
                id="moment-link-url"
                type="url"
                class="input text-mono text-xs"
                value={linkUrl}
                onInput={(e) => {
                  if ((e as any).isComposing) return;
                  setLinkUrl((e.target as HTMLInputElement).value);
                }}
                onCompositionEnd={(e) => setLinkUrl((e.target as HTMLInputElement).value)}
                placeholder="https://example.com/article"
                spellcheck={false}
              />
            </div>
          </div>
        )}

        <div class="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span>{newContent.length}/500</span>
          <Button
            size="sm"
            onClick={handlePublish}
            loading={posting}
            disabled={
              !newContent.trim() ||
              (publishType === 'image' && (!imgState || !imgState.base64)) ||
              (publishType === 'link' && (!linkDesc.trim() || !linkUrl.trim()))
            }
          >
            发布
          </Button>
        </div>
      </div>

      {error && <Alert level="danger">{error}</Alert>}

      {/* 动态类型筛选 */}
      {moments.length > 0 && (
        <div
          class="flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label="动态类型筛选"
        >
          {FILTER_TABS.map((t) => {
            const count = typeCounts[t.key];
            const active = filterType === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                class={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
                  active
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
                onClick={() => setFilterType(t.key)}
              >
                {Icon && <Icon size={12} />}
                {t.label}
                {count > 0 && <span class="ml-1 opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 动态列表 */}
      {loading && moments.length === 0 ? (
        <div class="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} class="card card-compact space-y-2">
              <Skeleton width="30%" height={14} />
              <Skeleton width="100%" height={14} />
              <Skeleton width="60%" height={14} />
            </div>
          ))}
        </div>
      ) : filteredMoments.length === 0 ? (
        <EmptyState
          icon={<Inbox size={48} />}
          title={moments.length === 0 ? '暂无动态' : '当前筛选无结果'}
          desc={moments.length === 0 ? '下拉刷新或发布第一条动态' : '尝试切换其他筛选条件'}
        />
      ) : (
        <>
          <div class="space-y-3">
            {filteredMoments.map((m) => (
              <MomentCard
                key={m.id || m.moment_id}
                moment={m}
                onView={() => setDetail(m)}
                onDelete={() => handleDelete(m)}
                onImageClick={(urls, idx) => setLightbox({ urls, index: idx })}
              />
            ))}
          </div>
          {hasMore && (
            <div class="flex justify-center py-4">
              <Button
                variant="secondary"
                onClick={() => {
                  if (loading) return;
                  fetchPage(page + 1, true);
                }}
                loading={loading}
              >
                加载更多
              </Button>
            </div>
          )}
        </>
      )}

      {/* 详情 Modal（lightbox 打开时隐藏，避免 ESC 同时关闭两个） */}
      <Modal
        open={!!detail && !lightbox}
        onClose={() => setDetail(null)}
        title="动态详情"
        width={560}
      >
        {detail && (
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-lg font-medium">{detail.nickname}</span>
                <Badge level="gray" >{formatTime(detail.time)}</Badge>
                <span class="text-xs text-[var(--color-text-light)]">
                  {formatRelativeTime(detail.time)}
                </span>
              </div>
              <Badge level="info">点赞 {detail.like_count}</Badge>
            </div>
            <div class="whitespace-pre-wrap break-words rounded-lg bg-[var(--color-surface-2)] p-3 text-sm">
              {detail.content}
            </div>
            {detail.images.length > 0 && (
              <div class="grid grid-cols-3 gap-2">
                {detail.images.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    class="block overflow-hidden rounded focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                    onClick={() => setLightbox({ urls: detail.images, index: i })}
                    aria-label={`查看大图 ${i + 1}`}
                  >
                    <img
                      src={url}
                      alt={`动态图片 ${i + 1}`}
                      class="h-24 w-full cursor-zoom-in object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
            {detail.videos.length > 0 && (
              <div class="space-y-2">
                {detail.videos.map((url, i) => (
                  <video key={i} src={url} controls class="w-full rounded" />
                ))}
              </div>
            )}
            <CommentList comments={detail.comments} count={detail.comment_count} />
            <div class="flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
              <span>momentid: {detail.id || detail.moment_id}</span>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  // 等待删除完成且成功后再关闭 Modal
                  const ok = await handleDelete(detail);
                  if (ok) setDetail(null);
                }}
              >
                删除动态
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 图片大图查看器（独立于详情 Modal） */}
      <ImageLightbox
        lightbox={lightbox}
        onClose={() => setLightbox(null)}
        onNavigate={(index) =>
          setLightbox((lb) => (lb ? { ...lb, index } : lb))
        }
      />
    </div>
  );
}

/** 评论列表 - 按时间正序排列（最早在上） */
function CommentList({
  comments,
  count,
}: {
  comments: ParsedMoment['comments'];
  count: number;
}) {
  const sorted = useMemo(() => {
    return [...comments].sort(
      (a, b) => toTimestamp(a.createTime) - toTimestamp(b.createTime)
    );
  }, [comments]);

  if (sorted.length === 0) return null;
  return (
    <div>
      <h4 class="mb-2 text-sm font-medium">评论 ({count})</h4>
      <div class="space-y-1">
        {sorted.map((c, i) => {
          const ts = toTimestamp(c.createTime);
          return (
            <div
              key={i}
              class="rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm"
            >
              <div class="flex items-center justify-between gap-2 text-xs text-[var(--color-text-light)]">
                <span class="font-medium text-[var(--color-text)]">{c.watchName}</span>
                {ts > 0 && (
                  <span title={formatAbsoluteTime(c.createTime)}>
                    {formatRelativeTime(c.createTime)}
                  </span>
                )}
              </div>
              <div class="mt-0.5 break-words">{c.comment}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 图片上传组件：拖拽 / 点击选择 / 预览 / 上传状态 */
function ImageUploader({
  imgState,
  onSelect,
  onClear,
}: {
  imgState: ImageUploadState | null;
  onSelect: (file: File | null) => void;
  onClear: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0] ?? null;
    if (file) onSelect(file);
  };

  if (imgState) {
    return (
      <div class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] p-3">
        <img
          src={imgState.dataUrl}
          alt="预览图"
          class="h-20 w-20 rounded object-cover"
          style={{ maxHeight: 200, maxWidth: 200 }}
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium" title={imgState.fileName}>
            {imgState.fileName}
          </div>
          <div class="text-xs text-[var(--color-text-muted)]">
            {fmtSize(imgState.fileSize)}
          </div>
          <div class="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-primary)]">
            <Check size={14} /> 已就绪（发布时上传）
          </div>
        </div>
        <button
          type="button"
          class="text-[var(--color-text-light)] hover:text-[var(--color-danger)]"
          onClick={onClear}
          aria-label="移除图片"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      class={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        dragOver
          ? 'border-[var(--color-primary)] bg-[var(--color-primary-bg)]'
          : 'border-[var(--color-border-strong)] hover:border-[var(--color-primary-light)]'
      }`}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
    >
      <div class="mb-2 flex justify-center opacity-50" aria-hidden="true">
        <ImagePlus size={48} />
      </div>
      <div class="text-sm">点击选择图片或拖拽到此处</div>
      <div class="mt-1 text-xs text-[var(--color-text-muted)]">
        支持 JPG / PNG / GIF / WebP，单张最大 10MB
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        class="hidden"
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0] ?? null;
          onSelect(file);
          // 清空 input，让相同文件可重新选择
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </div>
  );
}

/** 图片大图查看器：点击/ESC 关闭 + 左右切换 */
function ImageLightbox({
  lightbox,
  onClose,
  onNavigate,
}: {
  lightbox: { urls: string[]; index: number } | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const open = lightbox !== null;
  const urls = lightbox?.urls ?? [];
  const index = lightbox?.index ?? 0;

  // 用 capture phase 的 keydown 监听器，ESC 优先于此 Modal 之下的其他 Modal 处理
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        onNavigate(index - 1);
      } else if (e.key === 'ArrowRight' && index < urls.length - 1) {
        e.preventDefault();
        onNavigate(index + 1);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, index, urls.length, onClose, onNavigate]);

  if (!open) return null;
  const currentUrl = urls[index];

  return (
    <div
      class="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="图片大图查看"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      <div
        class="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {currentUrl && (
          <img
            src={currentUrl}
            alt={`图片 ${index + 1}`}
            class="max-h-[80vh] max-w-[90vw] rounded"
          />
        )}
        <div class="mt-3 flex items-center gap-3 text-white">
          {urls.length > 1 && (
            <>
              <button
                type="button"
                class="rounded-full bg-white/15 px-3 py-1 text-sm hover:bg-white/25 disabled:opacity-30 inline-flex items-center justify-center"
                disabled={index === 0}
                onClick={() => onNavigate(index - 1)}
                aria-label="上一张"
              >
                <ChevronLeft size={16} />
              </button>
              <span class="text-xs">
                {index + 1} / {urls.length}
              </span>
              <button
                type="button"
                class="rounded-full bg-white/15 px-3 py-1 text-sm hover:bg-white/25 disabled:opacity-30 inline-flex items-center justify-center"
                disabled={index === urls.length - 1}
                onClick={() => onNavigate(index + 1)}
                aria-label="下一张"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-sm hover:bg-white/25"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={14} /> 关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function MomentCard({
  moment,
  onView,
  onDelete,
  onImageClick,
}: {
  moment: ParsedMoment;
  onView: () => void;
  onDelete: () => void;
  onImageClick: (urls: string[], index: number) => void;
}) {
  const type = getMomentType(moment);
  return (
    <div class="group card card-compact card-hover animate-fade-in">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 cursor-pointer" onClick={onView}>
          <div class="mb-1 flex items-center gap-2">
            <span class="font-medium">{moment.nickname}</span>
            <span class="text-xs text-[var(--color-text-light)]">
              {formatRelativeTime(moment.time)}
            </span>
            <TypeBadge type={type} />
          </div>
          <p class="whitespace-pre-wrap break-words text-sm text-[var(--color-text)] line-clamp-3">
            {moment.content}
          </p>
          {moment.images.length > 0 && (
            <div class="mt-2 flex gap-1">
              {moment.images.slice(0, 3).map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`${moment.content.slice(0, 50)} - 图${i + 1}`}
                  class="h-16 w-16 cursor-zoom-in rounded object-cover"
                  onClick={(e) => {
                    e.stopPropagation();
                    onImageClick(moment.images, i);
                  }}
                />
              ))}
              {moment.images.length > 3 && (
                <div class="flex h-16 w-16 items-center justify-center rounded bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)]">
                  +{moment.images.length - 3}
                </div>
              )}
            </div>
          )}
          {moment.videos.length > 0 && (
            <div class="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-info)]">
              <Film size={12} /> {moment.videos.length} 个视频
            </div>
          )}
        </div>
        <button
          class="text-[var(--color-text-light)] transition-opacity hover:text-[var(--color-danger)]"
          onClick={onDelete}
          title="删除"
          aria-label="删除动态"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div class="mt-2 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
        <span class="inline-flex items-center gap-1"><Heart size={12} /> {moment.like_count}</span>
        <span class="inline-flex items-center gap-1"><MessageCircle size={12} /> {moment.comment_count}</span>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: Exclude<FilterType, 'all'> }) {
  if (type === 'text') return null;
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <Badge level="info">
      <span class="inline-flex items-center gap-1">
        <Icon size={12} /> {meta.label}
      </span>
    </Badge>
  );
}
