import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../lib/pyapi';
import type { Friend, ApiResult } from '../lib/pyapi';
import { PageHeader, Button, Alert, EmptyState, Skeleton, Badge, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDevice } from '../lib/useDevice';
import {
  Link2, Search, Users, ArrowLeft, MessageCircle, MessageSquare,
  CheckCheck, RotateCcw, Sparkles, Loader2,
} from '../lib/icons';

/** 单条消息（仅记录"我发送的"，对手表 IM 单向场景） */
interface Message {
  id: number;
  to: string;       // 好友名（显示用）
  toId: string;     // 好友 friendId（持久化 key + 重发用）
  msg: string;
  ts: number;
  status: 'sending' | 'success' | 'error';
  error?: string;
}

const MAX_LEN = 200;
const MAX_HISTORY = 50;
const HITOKOTO = [
  '今天也要加油呀！',
  '记得多喝水～',
  '天气不错，出去玩吧',
  '按时吃饭哦',
  '早点休息',
  '想你了',
  '注意安全',
  '好好学习',
  '听话哦',
  '爱你',
];

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** localStorage key：每个好友独立历史 */
function historyKey(friendId: string): string {
  return `imoo_im_history_${friendId}`;
}

/** 从 localStorage 读取某好友的消息历史（带结构校验） */
function loadHistory(friendId: string): Message[] {
  try {
    const raw = localStorage.getItem(historyKey(friendId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m: unknown): m is Message =>
          !!m &&
          typeof (m as Message).id === 'number' &&
          typeof (m as Message).msg === 'string' &&
          typeof (m as Message).toId === 'string'
      )
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

/** 写入历史（最多 MAX_HISTORY 条），失败静默 */
function saveHistory(friendId: string, list: Message[]): void {
  try {
    localStorage.setItem(historyKey(friendId), JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // 配额满或被禁用时忽略，不影响会话体验
  }
}

/** 时间戳格式化：同天显示 HH:mm，跨天显示 M/D HH:mm */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString('zh-CN', { hour12: false });
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function IMPage() {
  const device = useDevice();
  const toast = useToast();
  const mountedRef = useRef(true);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Friend | null>(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  /** 移动端单栏切换：list=好友列表，chat=会话区 */
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  /** 协议说明是否展开（默认折叠，避免占用空间） */
  const [protoOpen, setProtoOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ===== 拉取好友列表 =====
  const fetchFriends = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.friendslist();
      if (!mountedRef.current) return;
      if (r.code === '000001' && r.data) {
        // 真实 API：r.data 直接是数组（不是 {friends: [...]}），mock 一致
        const list = Array.isArray(r.data) ? (r.data as Friend[]) : [];
        setFriends(list);
      } else {
        setError(r.desc || '加载好友失败');
        toast.error('加载好友失败', r.desc);
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(errMsg(e));
      toast.error('加载好友失败', errMsg(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (device) fetchFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.watchid]);

  // ===== 选中好友：加载历史 + 移动端切到会话视图 =====
  useEffect(() => {
    if (!selected) {
      setHistory([]);
      return;
    }
    setHistory(loadHistory(selected.friendId));
    setMobileView('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.friendId]);

  // ===== 新消息时滚动到底部（历史倒序：最新在顶部，所以滚到顶部） =====
  // 历史我们采用"最新在前"的顺序，因此不需要自动滚动到底部
  // 但首次切换好友时把列表归位
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [selected?.friendId]);

  // ===== 过滤好友 =====
  const filteredFriends = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return friends;
    return friends.filter(
      (f) =>
        (f.name || '').toLowerCase().includes(kw) ||
        (f.relation || '').toLowerCase().includes(kw) ||
        (f.friendId || '').toLowerCase().includes(kw) ||
        (f.imFriendId || '').toLowerCase().includes(kw)
    );
  }, [friends, search]);

  // ===== textarea 自适应高度（最多 4 行） =====
  const adjustTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // line-height 24px * 4 + padding 16px ≈ 112px
    const maxH = 112;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => {
    adjustTextarea();
  }, [message, adjustTextarea]);

  // ===== 原子更新：同时改 state 与 localStorage =====
  const updateAndPersist = useCallback(
    (friendId: string, updater: (prev: Message[]) => Message[]) => {
      setHistory((prev) => {
        const next = updater(prev).slice(0, MAX_HISTORY);
        saveHistory(friendId, next);
        return next;
      });
    },
    []
  );

  // ===== 发送核心：调真实 IM（api.sendIm）并更新状态 =====
  const sendCore = useCallback(
    async (friend: Friend, text: string, msgId: number) => {
      const friendImId = friend.imFriendId || friend.friendId; // fallback：缺失 imFriendId 时用 friendId 尝试
      try {
        const r: ApiResult = await api.sendIm(friend.friendId, friendImId, text);
        if (!mountedRef.current) return;
        updateAndPersist(friend.friendId, (prev) =>
          prev.map((h) =>
            h.id === msgId
              ? {
                  ...h,
                  status: r.code === '000001' ? 'success' : 'error',
                  error: r.code === '000001' ? undefined : r.desc,
                }
              : h
          )
        );
        if (r.code === '000001') {
          toast.success('已发送', `发给 ${friend.name}`);
        } else {
          toast.error('发送失败', r.desc);
        }
      } catch (e: unknown) {
        if (!mountedRef.current) return;
        updateAndPersist(friend.friendId, (prev) =>
          prev.map((h) => (h.id === msgId ? { ...h, status: 'error', error: errMsg(e) } : h))
        );
        toast.error('发送异常', errMsg(e));
      }
    },
    [toast, updateAndPersist]
  );

  // ===== 主发送流程（乐观插入 + 异步确认） =====
  const handleSend = useCallback(async () => {
    if (!selected) {
      toast.warning('请先选择好友');
      return;
    }
    const text = message.trim();
    if (!text) {
      toast.warning('请输入消息内容');
      return;
    }
    const friend = selected;
    const msgId = Date.now();

    // 乐观插入：立即显示气泡，状态=sending
    updateAndPersist(friend.friendId, (prev) => [
      {
        id: msgId,
        to: friend.name,
        toId: friend.friendId,
        msg: text,
        ts: Date.now(),
        status: 'sending',
      },
      ...prev,
    ]);

    setMessage('');
    setSending(true);
    await sendCore(friend, text, msgId);
    if (!mountedRef.current) return;
    setSending(false);
  }, [selected, message, toast, updateAndPersist, sendCore]);

  // ===== 重发 =====
  const handleResend = useCallback(
    async (msg: Message) => {
      // 优先用当前选中的好友（friendId 匹配），否则从好友列表查找真实 Friend（含真实 imFriendId）
      let friend: Friend | null =
        selected && selected.friendId === msg.toId ? selected : null;
      if (!friend) {
        // 从好友列表查找真实 friend（含真实 imFriendId），避免用 friendId 冒充 imFriendId
        friend = friends.find((f) => f.friendId === msg.toId) || null;
      }
      if (!friend) {
        // 好友列表为空或已不在列表（切页后未加载 / 好友被删除），无法安全重发
        toast.error('重发失败', '好友已不在列表，请重新选择');
        return;
      }
      updateAndPersist(friend.friendId, (prev) =>
        prev.map((h) => (h.id === msg.id ? { ...h, status: 'sending', error: undefined } : h))
      );
      await sendCore(friend, msg.msg, msg.id);
    },
    [selected, friends, updateAndPersist, sendCore, toast]
  );

  // ===== 一言快捷填入 =====
  const handleHitokoto = useCallback(() => {
    const text = HITOKOTO[Math.floor(Math.random() * HITOKOTO.length)];
    setMessage(text);
    toast.info('一言', text);
    // 聚焦输入框方便用户直接 Enter 发送
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [toast]);

  // ===== 键盘：Enter 发送 / Shift+Enter 换行 =====
  const handleKeyDown = useCallback(
    (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
      // 中文输入法 composing 时不触发
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !(e as unknown as { isComposing?: boolean }).isComposing
      ) {
        e.preventDefault();
        if (!sending) handleSend();
      }
    },
    [handleSend, sending]
  );

  // ===== 移动端返回好友列表 =====
  const handleBackToList = useCallback(() => {
    setMobileView('list');
  }, []);

  // ===== 未绑定设备 =====
  if (!device) {
    return <EmptyState icon={<Link2 size={48} />} title="尚未绑定设备" desc="请先在设置中绑定设备" />;
  }

  // ===== 好友头像（无图时取首字 / 👤） =====
  const renderAvatar = (f: Friend, size: number = 36) => {
    if (f.headImg) {
      return (
        <img
          src={f.headImg}
          alt={`${f.name}头像`}
          class="rounded-full object-cover"
          style={{ width: `${size}px`, height: `${size}px` }}
        />
      );
    }
    const ch = (f.name || '?').slice(0, 1);
    return (
      <div
        class="flex items-center justify-center rounded-full bg-[var(--color-primary-bg)] text-[var(--color-primary)] font-medium"
        style={{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.45}px` }}
      >
        {ch}
      </div>
    );
  };

  return (
    <div class="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="微聊"
        desc="通过 IM 协议向手表好友发送真实消息"
        actions={
          <Button variant="secondary" onClick={fetchFriends} loading={loading}>
            刷新好友
          </Button>
        }
      />

      {/* 协议说明 - 可折叠 */}
      <div class="card card-compact">
        <button
          type="button"
          class="flex w-full items-center justify-between text-left"
          onClick={() => setProtoOpen((v) => !v)}
          aria-expanded={protoOpen}
          aria-controls="im-proto-detail"
        >
          <span class="flex items-center gap-2 text-sm font-medium">
            <Badge level="info">IM 协议</Badge>
            <span>消息通过 TLV 协议直连 IM 服务器</span>
          </span>
          <span class="text-xs text-[var(--color-text-muted)]">{protoOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {protoOpen && (
          <div id="im-proto-detail" class="mt-3">
            <Alert level="info">
              <strong>工作原理：</strong>本功能通过 TLV 协议直连 IM 服务器（gw.im.okii.com:8000），发送真实微聊消息到对方手表。
              <br />
              <strong>首次发送：</strong>需建立 IM 连接 + 登录，约 2-5 秒；后续消息复用连接会更快。
              <br />
              <strong>注意：</strong>消息仅记录"我发送的"，手表回复需在物理设备上查看。
            </Alert>
          </div>
        )}
      </div>

      {error && <Alert level="danger">{error}</Alert>}

      <div
        class="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]"
        style={{ minHeight: '500px', height: 'calc(100vh - 320px)' }}
      >
        {/* ===== 左栏：好友列表 ===== */}
        <div
          class={`card card-compact flex flex-col overflow-hidden ${
            mobileView === 'chat' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* 搜索框 */}
          <div class="mb-2">
            <div class="relative">
              <input
                type="text"
                class="input pl-8"
                placeholder="搜索好友 / 关系 / ID"
                value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                aria-label="搜索好友"
              />
              <span
                class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                aria-hidden="true"
              >
                <Search size={16} />
              </span>
            </div>
          </div>

          {/* 好友列表 */}
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-medium">好友列表</h3>
            <Badge level="gray">{filteredFriends.length}</Badge>
          </div>

          <div class="flex-1 overflow-y-auto" style={{ minHeight: '0' }}>
            {loading && friends.length === 0 ? (
              <div class="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} height={48} />
                ))}
              </div>
            ) : friends.length === 0 ? (
              <EmptyState icon={<Users size={48} />} title="暂无好友" desc="请先在好友圈添加好友" />
            ) : filteredFriends.length === 0 ? (
              <div class="py-8 text-center text-xs text-[var(--color-text-muted)]">
                未匹配到「{search}」
              </div>
            ) : (
              <div class="space-y-1">
                {filteredFriends.map((f) => {
                  const active = selected?.friendId === f.friendId;
                  const hasIm = !!f.imFriendId;
                  return (
                    <button
                      key={f.friendId}
                      type="button"
                      onClick={() => setSelected(f)}
                      class={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        active
                          ? 'bg-[var(--color-primary-bg)] ring-1 ring-[var(--color-primary)]'
                          : 'hover:bg-[var(--color-surface-2)]'
                      }`}
                      aria-pressed={active}
                    >
                      <div class="relative shrink-0">
                        {renderAvatar(f, 36)}
                        <span
                          class={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--color-surface)] ${
                            hasIm ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-light)]'
                          }`}
                          title={hasIm ? '已开通 IM' : '未开通 IM（将用 friendId 兜底）'}
                          aria-label={hasIm ? '已开通 IM' : '未开通 IM'}
                        />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class={`text-sm font-medium truncate ${active ? 'text-[var(--color-primary)]' : ''}`}>
                          {f.name || '未命名'}
                        </div>
                        {f.relation && (
                          <div class="text-xs text-[var(--color-text-muted)] truncate">{f.relation}</div>
                        )}
                      </div>
                      {hasIm && (
                        <Badge level="success">
                          <span class="text-[10px]">IM</span>
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ===== 右栏：会话区 ===== */}
        <div
          class={`card flex flex-col overflow-hidden ${
            mobileView === 'list' ? 'hidden md:flex' : 'flex'
          }`}
          style={{ padding: 0 }}
        >
          {selected ? (
            <>
              {/* 顶部：好友信息条 */}
              <div class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
                {/* 移动端返回按钮 */}
                <button
                  type="button"
                  class="md:hidden -ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
                  onClick={handleBackToList}
                  aria-label="返回好友列表"
                >
                  <ArrowLeft size={20} />
                </button>
                {renderAvatar(selected, 40)}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium truncate">{selected.name}</span>
                    {selected.relation && (
                      <span class="text-xs text-[var(--color-text-muted)]">{selected.relation}</span>
                    )}
                  </div>
                  <div class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    {selected.imFriendId ? (
                      <>
                        <span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                        <span>IM {selected.imFriendId}</span>
                      </>
                    ) : (
                      <>
                        <span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />
                        <span>无 IM 账号（用 friendId 兜底）</span>
                      </>
                    )}
                  </div>
                </div>
                <Badge level="info">IM 协议</Badge>
              </div>

              {/* 中间：消息列表 */}
              <div
                ref={scrollRef}
                class="flex-1 space-y-3 overflow-y-auto px-4 py-3"
                style={{ minHeight: '0' }}
                aria-live="polite"
                aria-label="消息历史"
              >
                {history.length === 0 ? (
                  <div class="flex h-full items-center justify-center text-center text-xs text-[var(--color-text-muted)]">
                    <div>
                      <div class="mb-2 flex justify-center opacity-50" aria-hidden="true">
                        <MessageCircle size={48} />
                      </div>
                      <div>还没有消息记录</div>
                      <div class="mt-1">在下方输入消息开始聊天</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 倒序：最新在顶部 */}
                    {history.map((h) => (
                      <div key={h.id} class="flex justify-end" role="listitem">
                        <div class="flex flex-col items-end" style={{ maxWidth: '80%' }}>
                          {/* 气泡 */}
                          <div
                            class={`rounded-2xl rounded-tr-sm px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                              h.status === 'error'
                                ? 'bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger)]'
                                : 'bg-[var(--color-primary)] text-white'
                            }`}
                          >
                            {h.msg}
                          </div>
                          {/* 时间 + 状态 */}
                          <div class="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                            <span>{fmtTime(h.ts)}</span>
                            {h.status === 'sending' && (
                              <span class="flex items-center gap-1 text-[var(--color-text-muted)]">
                                <Spinner size="sm" />
                                <span>发送中…</span>
                              </span>
                            )}
                            {h.status === 'success' && (
                              <span class="text-[var(--color-success)]" title="已送达">
                                <CheckCheck size={14} />
                              </span>
                            )}
                            {h.status === 'error' && (
                              <button
                                type="button"
                                class="flex items-center gap-1 text-[var(--color-danger)] hover:underline disabled:opacity-50"
                                onClick={() => handleResend(h)}
                                disabled={sending}
                                title={h.error ? `失败：${h.error}` : '发送失败，点击重发'}
                                aria-label={`重发给 ${h.to}`}
                              >
                                <RotateCcw size={12} /> <span>重发</span>
                              </button>
                            )}
                          </div>
                          {h.status === 'error' && h.error && (
                            <div class="mt-0.5 text-xs text-[var(--color-danger)]">{h.error}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* 底部：输入区 */}
              <div class="border-t border-[var(--color-border)] px-4 py-3">
                <div class="flex items-end gap-2">
                  {/* 一言按钮 */}
                  <button
                    type="button"
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    onClick={handleHitokoto}
                    title="一言快捷填入"
                    aria-label="一言快捷填入"
                  >
                    <Sparkles size={18} />
                  </button>
                  <div class="flex-1 min-w-0">
                    <textarea
                      ref={inputRef}
                      class="input resize-none"
                      value={message}
                      onInput={(e) => {
                        // 中文输入法 composing 期间不更新 state，避免打断组词
                        if ((e as any).isComposing) return;
                        const v = (e.target as HTMLTextAreaElement).value;
                        // 截断超长输入
                        setMessage(v.length > MAX_LEN ? v.slice(0, MAX_LEN) : v);
                      }}
                      onCompositionEnd={(e) => {
                        const v = (e.target as HTMLTextAreaElement).value;
                        setMessage(v.length > MAX_LEN ? v.slice(0, MAX_LEN) : v);
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder={`输入要发送给 ${selected.name} 的消息…（Enter 发送 / Shift+Enter 换行）`}
                      rows={1}
                      maxLength={MAX_LEN}
                      disabled={sending}
                      aria-label="消息输入框"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSend}
                    loading={sending}
                    disabled={!message.trim() || sending}
                    class="shrink-0"
                  >
                    发送
                  </Button>
                </div>
                <div class="mt-1.5 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                  <span class="inline-flex items-center gap-1">
                    {sending ? (
                      <>
                        <Loader2 size={14} class="animate-spin" />
                        IM 连接中，请稍候…
                      </>
                    ) : (
                      'Enter 发送 · Shift+Enter 换行'
                    )}
                  </span>
                  <span class={message.length >= MAX_LEN - 10 ? 'text-[var(--color-warning)]' : ''}>
                    {message.length}/{MAX_LEN}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<MessageSquare size={48} />}
              title="选择一位好友开始聊天"
              desc="从左侧好友列表中选择一位好友"
            />
          )}
        </div>
      </div>
    </div>
  );
}
