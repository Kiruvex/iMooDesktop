import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { api } from '../lib/pyapi';
import type { DeviceInfo } from '../lib/pyapi';
import { PageHeader, Button, Alert, EmptyState, Badge, Skeleton, confirm } from '../components/ui';
import { useToast } from '../components/Toast';
import { Link2, Check, ArrowRight } from '../lib/icons';

interface ProfilePageProps {
  device?: DeviceInfo | null;
}

/** 表单态：聚合三个可编辑字段，便于和 original 比较判断是否有未保存修改 */
interface PersonalInfo {
  name: string;
  sign: string;
  realname: string;
}

/** personalinfo API 实际返回的嵌套结构（参考 core/watch_api.py）：
 *  - geniusAccount: 账号基础信息（昵称/等级/积分/好友数/联系人数）
 *  - personalInfo:  signature + fuzzyLikes
 *  - simpleMedal:   勋章数组
 *  - socializeUser: 其他社交数据（前端只读展示，结构未知 → Record<string, unknown>）
 *  注：personalinfo 不返回 realname，realname 由独立的 realname API 单独修改 */
interface PersonalInfoResponse {
  geniusAccount?: {
    name?: string;
    level?: number;
    score?: number;
    friends?: number;
    contacts?: number;
  };
  personalInfo?: {
    signature?: string;
    fuzzyLikes?: number;
  };
  simpleMedal?: {
    medals?: Array<{ name?: string }>;
  };
  socializeUser?: Record<string, unknown>;
}

/** 预览卡片额外展示的字段（从嵌套结构抽取，仅用于展示，不可编辑） */
interface ProfileExtra {
  level: number | null;
  score: number | null;
  friends: number | null;
  contacts: number | null;
  fuzzyLikes: number | null;
  medals: string;
}

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface ProfileHistoryItem {
  field: 'name' | 'sign' | 'realname';
  label: string;
  from: string;
  to: string;
  ts: number;
}

const HISTORY_KEY = 'imoo_profile_history';
const HISTORY_MAX = 3;

function loadHistory(): ProfileHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (it): it is ProfileHistoryItem =>
          it &&
          typeof it.field === 'string' &&
          typeof it.label === 'string' &&
          typeof it.from === 'string' &&
          typeof it.to === 'string' &&
          typeof it.ts === 'number'
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(items: ProfileHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    /* 静默降级 */
  }
}

function fmtTime(ts: number): string {
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

/** 空字符串折叠为占位符 */
function orDash(v: string | undefined | null): string {
  return v && v.trim() ? v : '-';
}

export function ProfilePage({ device }: ProfilePageProps) {
  const [name, setName] = useState('');
  const [sign, setSign] = useState('');
  const [realname, setRealname] = useState('');
  const [original, setOriginal] = useState<PersonalInfo>({ name: '', sign: '', realname: '' });
  // 预览卡片额外展示字段（仅展示，不参与编辑/比较）。拉取失败或字段缺失时保持 null/''，
  // 渲染层据此判断是否显示对应 Badge
  const [extra, setExtra] = useState<ProfileExtra>({
    level: null,
    score: null,
    friends: null,
    contacts: null,
    fuzzyLikes: null,
    medals: '',
  });
  // 三个表单各自独立 loading，避免互相阻塞
  const [loadingName, setLoadingName] = useState(false);
  const [loadingSign, setLoadingSign] = useState(false);
  const [loadingRealname, setLoadingRealname] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadInfoFailed, setLoadInfoFailed] = useState(false);
  const [error, setError] = useState('');
  // 预览卡片"已保存"状态：保存成功后短暂置为 true，3 秒后恢复
  const [savedFlash, setSavedFlash] = useState(false);
  const [history, setHistory] = useState<ProfileHistoryItem[]>(() => loadHistory());
  const toast = useToast();
  const mountedRef = useRef(true);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
    };
  }, []);

  // 加载当前资料
  useEffect(() => {
    if (!device) return;
    setLoadingInfo(true);
    setLoadInfoFailed(false);
    api.personalinfo()
      .then((r) => {
        if (!mountedRef.current) return;
        if (r.code === '000001' && r.data) {
          // personalinfo 返回嵌套结构：{ geniusAccount, personalInfo, simpleMedal, socializeUser }
          const d = r.data as PersonalInfoResponse;
          const trimmed = {
            name: (d.geniusAccount?.name ?? '').trim(),
            // personalInfo.signature 即个性签名
            sign: (d.personalInfo?.signature ?? '').trim(),
            // personalinfo API 不返回 realname（realname 由独立的 realname API 修改）
            realname: '',
          };
          setName(trimmed.name);
          setSign(trimmed.sign);
          setRealname(trimmed.realname);
          setOriginal(trimmed);
          // 抽取预览卡片额外字段
          const medalsArr = d.simpleMedal?.medals ?? [];
          const medalsText = medalsArr
            .map((m) => (m?.name ?? '').trim())
            .filter(Boolean)
            .join('、');
          setExtra({
            level: typeof d.geniusAccount?.level === 'number' ? d.geniusAccount.level : null,
            score: typeof d.geniusAccount?.score === 'number' ? d.geniusAccount.score : null,
            friends: typeof d.geniusAccount?.friends === 'number' ? d.geniusAccount.friends : null,
            contacts: typeof d.geniusAccount?.contacts === 'number' ? d.geniusAccount.contacts : null,
            fuzzyLikes: typeof d.personalInfo?.fuzzyLikes === 'number' ? d.personalInfo.fuzzyLikes : null,
            medals: medalsText,
          });
        } else {
          // 接口返回失败：表单保持空白 + 提示
          setLoadInfoFailed(true);
        }
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        console.warn('加载资料失败', e);
        setLoadInfoFailed(true);
      })
      .finally(() => {
        if (mountedRef.current) setLoadingInfo(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.watchid]);

  const handleSaveName = async () => {
    const v = name.trim();
    if (!v) {
      toast.warning('名称不能为空');
      return;
    }
    if (v.length > 16) {
      toast.warning('名称不能超过 16 个字符');
      return;
    }
    setLoadingName(true);
    setError('');
    try {
      const r = await api.name(v);
      if (!mountedRef.current) return;
      if (r.code === '000001') {
        toast.success('名称已更新', v);
        const oldVal = original.name;
        setName(v);
        setOriginal((o) => ({ ...o, name: v }));
        flashSaved();
        pushHistory({ field: 'name', label: '名称', from: oldVal, to: v, ts: Date.now() });
      } else {
        setError(`修改失败: ${r.desc}`);
        toast.error('修改名称失败', r.desc);
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(errMsg(e));
      toast.error('请求异常', errMsg(e));
    } finally {
      if (mountedRef.current) setLoadingName(false);
    }
  };

  const handleSaveSign = async () => {
    const v = sign.trim();
    if (v.length > 30) {
      toast.warning('签名不能超过 30 个字符');
      return;
    }
    setLoadingSign(true);
    setError('');
    try {
      const r = await api.sign(v);
      if (!mountedRef.current) return;
      if (r.code === '000001') {
        toast.success('签名已更新');
        const oldVal = original.sign;
        setSign(v);
        setOriginal((o) => ({ ...o, sign: v }));
        flashSaved();
        pushHistory({ field: 'sign', label: '签名', from: oldVal, to: v, ts: Date.now() });
      } else {
        setError(`修改失败: ${r.desc}`);
        toast.error('修改签名失败', r.desc);
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(errMsg(e));
      toast.error('请求异常', errMsg(e));
    } finally {
      if (mountedRef.current) setLoadingSign(false);
    }
  };

  const handleSaveRealname = async () => {
    const v = realname.trim();
    if (v.length > 30) {
      toast.warning('实名不能超过 30 字');
      return;
    }
    if (!v) {
      const ok = await confirm({
        title: '清空实名',
        message: '确定要清空实名信息吗？',
        danger: true,
      });
      if (!ok) return;
    }
    setLoadingRealname(true);
    setError('');
    try {
      const r = await api.realname(v);
      if (!mountedRef.current) return;
      if (r.code === '000001') {
        toast.success('实名信息已更新');
        const oldVal = original.realname;
        setRealname(v);
        setOriginal((o) => ({ ...o, realname: v }));
        flashSaved();
        pushHistory({ field: 'realname', label: '实名', from: oldVal, to: v, ts: Date.now() });
      } else {
        setError(`修改失败: ${r.desc}`);
        toast.error('修改实名失败', r.desc);
      }
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(errMsg(e));
      toast.error('请求异常', errMsg(e));
    } finally {
      if (mountedRef.current) setLoadingRealname(false);
    }
  };

  /** 闪烁"已保存"标签 3 秒 */
  const flashSaved = () => {
    if (!mountedRef.current) return;
    setSavedFlash(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setSavedFlash(false);
      savedTimerRef.current = null;
    }, 3000);
  };

  const pushHistory = (item: ProfileHistoryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  };

  if (!device) {
    return <EmptyState icon={<Link2 size={48} />} title="尚未绑定设备" desc="请先在设置中绑定设备" />;
  }

  const nameChanged = name !== original.name;
  const signChanged = sign !== original.sign;
  const realnameChanged = realname !== original.realname;
  const hasUnsaved = nameChanged || signChanged || realnameChanged;

  // 预览卡片：使用当前编辑值（实时反映），并标注是否为预览态
  const previewName = name.trim();
  const previewSign = sign.trim();
  const previewRealname = realname.trim();

  // 头像占位：取名称第一个字符
  const avatarChar = useMemo(() => {
    const ch = previewName?.trim()?.[0];
    return ch ? ch.toUpperCase() : '?';
  }, [previewName]);

  return (
    <div class="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="资料修改"
        desc="修改手表的名称、个性签名、实名信息"
      />

      {error && <Alert level="danger">{error}</Alert>}
      {loadInfoFailed && (
        <Alert level="warning">无法加载当前资料，下方表单为空白。可手动填写后保存。</Alert>
      )}

      {/* 当前资料预览卡片 */}
      <div class="card bg-gradient-to-br from-[var(--color-primary-bg)] to-[var(--color-surface)]">
        <div class="flex items-start gap-4">
          <div
            class="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-[var(--color-primary)] text-2xl font-semibold text-white"
            aria-hidden="true"
          >
            {loadingInfo ? <Skeleton width={32} height={24} /> : avatarChar}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-lg font-semibold">
                {loadingInfo ? <Skeleton width={120} height={20} /> : orDash(previewName)}
              </span>
              {previewRealname ? (
                <Badge level="success">已实名</Badge>
              ) : (
                <Badge level="gray">未实名</Badge>
              )}
              {/* 状态徽章 */}
              {savedFlash ? (
                <Badge level="success">
                  <span class="inline-flex items-center gap-1">
                    <Check size={12} aria-hidden="true" />
                    已保存
                  </span>
                </Badge>
              ) : hasUnsaved && !loadingInfo ? (
                <Badge level="warning">预览中…</Badge>
              ) : null}
            </div>
            <p class="mt-1 text-sm text-[var(--color-text-muted)]">
              {loadingInfo ? (
                <Skeleton width={200} height={14} />
              ) : previewSign ? (
                previewSign
              ) : (
                <span class="italic text-[var(--color-text-light)]">未设置签名</span>
              )}
            </p>
            <p class="mt-1 text-xs text-[var(--color-text-light)]">
              {loadingInfo
                ? '加载当前资料中…'
                : loadInfoFailed
                ? '资料读取失败，预览为表单当前值'
                : hasUnsaved
                ? '预览：未保存的修改'
                : '资料已是最新'}
            </p>
            {/* 来自 personalinfo 的额外展示字段（等级 / 积分 / 好友 / 获赞 / 勋章）。
                仅在加载完成且至少有一个字段有效时显示，避免空标签污染卡片 */}
            {!loadingInfo && !loadInfoFailed && (
              (extra.level !== null || extra.score !== null || extra.friends !== null ||
                extra.contacts !== null || extra.fuzzyLikes !== null || extra.medals) ? (
                <div class="mt-3 flex flex-wrap gap-1.5">
                  {extra.level !== null && (
                    <span
                      class="badge"
                      style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}
                      title="账号等级"
                    >
                      Lv.{extra.level}
                    </span>
                  )}
                  {extra.score !== null && (
                    <span
                      class="badge"
                      style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}
                      title="积分"
                    >
                      积分 {extra.score}
                    </span>
                  )}
                  {extra.friends !== null && (
                    <span
                      class="badge"
                      style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}
                      title="好友数"
                    >
                      好友 {extra.friends}
                    </span>
                  )}
                  {extra.contacts !== null && (
                    <span
                      class="badge"
                      style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}
                      title="联系人"
                    >
                      联系人 {extra.contacts}
                    </span>
                  )}
                  {extra.fuzzyLikes !== null && (
                    <span
                      class="badge"
                      style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}
                      title="获赞数（模糊值）"
                    >
                      获赞 {extra.fuzzyLikes}
                    </span>
                  )}
                  {extra.medals && (
                    <span
                      class="badge"
                      style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)' }}
                      title="勋章"
                    >
                      勋章：{extra.medals}
                    </span>
                  )}
                </div>
              ) : null
            )}
          </div>
        </div>
      </div>

      {/* 名称 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <label htmlFor="profile-name" class="font-medium">
            手表名称
          </label>
          {nameChanged && <Badge level="warning">未保存</Badge>}
        </div>
        <p class="text-xs text-[var(--color-text-muted)]">显示在手表主屏上的名称，1-16 个字符</p>
        {loadingInfo ? (
          <div class="h-9 bg-[var(--color-surface-2)] animate-pulse rounded" />
        ) : (
          <input
            id="profile-name"
            type="text"
            class="input"
            value={name}
            onInput={(e) => {
              if ((e as any).isComposing) return;
              setName((e.target as HTMLInputElement).value);
            }}
            onCompositionEnd={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="如：小天才"
            maxLength={16}
          />
        )}
        <div class="flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>{name.length}/16</span>
          <Button size="sm" onClick={handleSaveName} loading={loadingName} disabled={!nameChanged}>
            保存名称
          </Button>
        </div>
      </div>

      {/* 签名 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <label htmlFor="profile-sign" class="font-medium">
            个性签名
          </label>
          {signChanged && <Badge level="warning">未保存</Badge>}
        </div>
        <p class="text-xs text-[var(--color-text-muted)]">好友圈中展示的个性签名，最多 30 个字符</p>
        {loadingInfo ? (
          <div class="h-16 bg-[var(--color-surface-2)] animate-pulse rounded" />
        ) : (
          <textarea
            id="profile-sign"
            class="input"
            value={sign}
            onInput={(e) => {
              if ((e as any).isComposing) return;
              setSign((e.target as HTMLTextAreaElement).value);
            }}
            onCompositionEnd={(e) => setSign((e.target as HTMLTextAreaElement).value)}
            placeholder="今天也要加油呀"
            rows={2}
            maxLength={30}
          />
        )}
        <div class="flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>
            {sign.length}/30
            {sign.length > 30 && <span class="ml-2 text-[var(--color-danger)]">超出字数限制</span>}
          </span>
          <Button size="sm" onClick={handleSaveSign} loading={loadingSign} disabled={!signChanged}>
            保存签名
          </Button>
        </div>
      </div>

      {/* 实名 */}
      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <label htmlFor="profile-realname" class="font-medium">
            实名信息
          </label>
          {realnameChanged && <Badge level="warning">未保存</Badge>}
        </div>
        <p class="text-xs text-[var(--color-text-muted)]">手表实名认证信息，留空则清除</p>
        {loadingInfo ? (
          <div class="h-9 bg-[var(--color-surface-2)] animate-pulse rounded" />
        ) : (
          <input
            id="profile-realname"
            type="text"
            class="input"
            value={realname}
            onInput={(e) => {
              if ((e as any).isComposing) return;
              setRealname((e.target as HTMLInputElement).value);
            }}
            onCompositionEnd={(e) => setRealname((e.target as HTMLInputElement).value)}
            placeholder="真实姓名"
            maxLength={30}
          />
        )}
        <div class="flex justify-end">
          <Button size="sm" variant="danger" onClick={handleSaveRealname} loading={loadingRealname} disabled={!realnameChanged}>
            {realname.trim() ? '保存实名' : '清空实名'}
          </Button>
        </div>
      </div>

      {/* 修改历史 */}
      {history.length > 0 && (
        <div class="card space-y-2">
          <h3 class="font-medium">最近修改</h3>
          <ul class="divide-y divide-[var(--color-border)]" aria-label="资料修改历史">
            {history.map((item, idx) => (
              <li key={`${item.ts}-${idx}`} class="py-2 text-sm">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium">{item.label}</span>
                  <span class="text-xs text-[var(--color-text-muted)]">{fmtTime(item.ts)}</span>
                </div>
                <div class="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span class="line-through">{item.from || '（空）'}</span>
                  <ArrowRight size={12} aria-hidden="true" />
                  <span class="font-medium text-[var(--color-text)]">{item.to || '（空）'}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Alert level="info">
        <strong>提示：</strong>修改后的资料会立即同步到手表端，可能需要重启手表 App 才能看到效果。
      </Alert>
    </div>
  );
}
