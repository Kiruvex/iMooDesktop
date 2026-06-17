import { useState, useEffect } from 'preact/hooks';
import { callApi, bindDevice, unbindDevice, getVersion, clearCache, getLogs, api } from '../lib/pyapi';
import type { DeviceInfo, VersionInfo } from '../lib/pyapi';
import { PageHeader, Button, Alert, Badge, Modal, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';
import { confirm } from '../components/ui';
import { CircleDot, Circle, ChevronRight, FileX, ScrollText, CheckCircle2 } from '../lib/icons';

interface SettingsPageProps {
  device?: DeviceInfo | null;
}

interface LogEntry {
  ts: string;
  level: string;
  action: string;
  message: string;
}

/** 统一提取 catch 异常的 message */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SettingsPage({ device }: SettingsPageProps) {
  const [chipid, setChipid] = useState('');
  const [bindnumber, setBindnumber] = useState('');
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [logsModal, setLogsModal] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  // EULA 查看
  const [eulaModal, setEulaModal] = useState(false);
  const [eulaText, setEulaText] = useState('');
  const [eulaVersion, setEulaVersion] = useState('');
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [eulaLoading, setEulaLoading] = useState(false);
  const [logDates, setLogDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {});
    // 页面加载时主动拉取 EULA 同意状态，避免徽章始终显示"未同意"
    api.getEulaStatus()
      .then((s) => {
        if (alive) {
          setEulaAccepted(s.accepted);
          setEulaVersion(s.version);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleBind = async () => {
    if (!chipid || !bindnumber) {
      toast.warning('请填写 chipid 和 bindnumber');
      return;
    }
    // chipid 标准格式：32 位十六进制（不区分大小写）
    if (!/^[0-9a-f]{32}$/i.test(chipid.trim())) {
      toast.warning('chipid 格式异常，应为 32 位十六进制字符');
      return;
    }
    // bindnumber 标准格式：16 位字母
    if (!/^[a-z]{16}$/i.test(bindnumber.trim())) {
      toast.warning('bindnumber 格式异常，通常为 16 位字母');
      return;
    }
    setBinding(true);
    setError('');
    try {
      const r = await bindDevice(chipid.trim(), bindnumber.trim());
      if (r.code === '000001') {
        toast.success('设备绑定成功');
        setChipid('');
        setBindnumber('');
        // 依赖 device_changed 信号让 App 更新 device prop（不再手动调 get_config）
      } else {
        setError(`绑定失败: ${r.desc ?? '未知错误'}`);
        toast.error('绑定失败', r.desc);
      }
    } catch (e: unknown) {
      setError(errMsg(e));
      toast.error('请求异常', errMsg(e));
    } finally {
      setBinding(false);
    }
  };

  const handleUnbind = async () => {
    const ok = await confirm({
      title: '解绑设备',
      message: '解绑后所有本地缓存将被清除，需要重新绑定才能使用。确认继续？',
      danger: true,
      confirmText: '确认解绑',
    });
    if (!ok) return;
    try {
      await unbindDevice();
      toast.success('设备已解绑');
      // device_changed 信号会让父级清空 device
    } catch (e: unknown) {
      toast.error('解绑失败', errMsg(e));
    }
  };

  const handleClearCache = async () => {
    const ok = await confirm({
      title: '清理缓存',
      message: '将清理所有本地缓存的好友列表、动态数据。确认继续？',
    });
    if (!ok) return;
    try {
      const r = await clearCache();
      toast.success('缓存已清理', `清理 ${r.removed ?? 0} 项`);
    } catch (e: unknown) {
      toast.error('清理失败', errMsg(e));
    }
  };

  const handleViewLogs = async () => {
    setLoadingLogs(true);
    try {
      const [logResp, datesResp] = await Promise.all([
        getLogs({ limit: 100 }),
        callApi<{ dates: string[] }>('get_log_dates').catch(() => ({ dates: [] })),
      ]);
      setLogs(logResp.logs as LogEntry[]);
      setLogDates(datesResp.dates ?? []);
      setSelectedDate('');
      setLogsModal(true);
    } catch (e: unknown) {
      toast.error('获取日志失败', errMsg(e));
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleFilterByDate = async (date: string) => {
    setSelectedDate(date);
    if (!date) {
      // 清空筛选 → 重新加载最近 100 条
      const r = await getLogs({ limit: 100 });
      setLogs(r.logs as LogEntry[]);
      return;
    }
    setLoadingLogs(true);
    try {
      const r = await getLogs({ date, limit: 500 });
      setLogs(r.logs as LogEntry[]);
    } catch (e: unknown) {
      toast.error('按日期加载日志失败', errMsg(e));
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleClearLogs = async () => {
    const ok = await confirm({
      title: '清空全部日志',
      message: '将永久删除所有本地日志记录，此操作不可恢复。确认继续？',
      danger: true,
      confirmText: '确认清空',
    });
    if (!ok) return;
    setClearingLogs(true);
    try {
      await callApi('clear_logs');
      setLogs([]);
      toast.success('日志已清空');
    } catch (e: unknown) {
      toast.error('清空日志失败', errMsg(e));
    } finally {
      setClearingLogs(false);
    }
  };

  // 查看最终用户许可协议（EULA）
  const handleViewEula = async () => {
    setEulaLoading(true);
    setEulaModal(true);
    try {
      const [eula, status] = await Promise.all([api.getEula(), api.getEulaStatus()]);
      setEulaText(eula.found ? eula.text : '（无法加载 EULA.txt，请确认文件存在）');
      setEulaVersion(eula.version);
      setEulaAccepted(status.accepted);
    } catch (e: unknown) {
      toast.error('加载 EULA 失败', errMsg(e));
      setEulaText('加载失败');
    } finally {
      setEulaLoading(false);
    }
  };

  return (
    <div class="mx-auto max-w-2xl space-y-5">
      <PageHeader title="设置" desc="设备绑定、缓存管理、应用信息" />

      {/* 设备绑定状态 */}
      <div class="card">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-medium">设备绑定</h3>
          {device ? (
            <Badge level="success">
              <span class="inline-flex items-center gap-1">
                <CircleDot size={12} /> 已绑定
              </span>
            </Badge>
          ) : (
            <Badge level="gray">
              <span class="inline-flex items-center gap-1">
                <Circle size={12} /> 未绑定
              </span>
            </Badge>
          )}
        </div>

        {device ? (
          <div class="space-y-2">
            <Row label="手表名称" value={device.name} />
            <Row label="机型" value={device.model} />
            <Row label="Watch ID" value={device.watchid} mono />
            <Row label="chipid" value={device.chipid} mono />
            <Row label="bindnumber" value={device.bindnumber} mono />
            <Row label="imaccountid" value={device.imaccountid || '-'} mono />
            <Row label="绑定时间" value={device.bound_at || '-'} />
            <div class="mt-4 flex justify-end">
              <Button variant="danger" size="sm" onClick={handleUnbind}>
                解绑设备
              </Button>
            </div>
          </div>
        ) : (
          <div class="space-y-3">
            <p class="text-sm text-[var(--color-text-muted)]">
              请输入手表的 chipid 和绑定号。绑定号可在手表 App 中查看，chipid 需通过特定方式获取。
            </p>
            <div>
              <label class="label label-muted" htmlFor="chipid-input">Chip ID</label>
              <input
                id="chipid-input"
                type="text"
                class="input text-mono text-xs"
                value={chipid}
                onInput={(e) => setChipid((e.target as HTMLInputElement).value)}
                placeholder="00000070000001002ac5652e00000005"
                inputMode="text"
                autoComplete="off"
                spellcheck={false}
              />
              <p class="mt-1 text-xs text-[var(--color-text-muted)]">32 位十六进制字符</p>
            </div>
            <div>
              <label class="label label-muted" htmlFor="bindnumber-input">绑定号 (Bind Number)</label>
              <input
                id="bindnumber-input"
                type="text"
                class="input text-mono text-xs"
                value={bindnumber}
                onInput={(e) => setBindnumber((e.target as HTMLInputElement).value)}
                placeholder="akprrlzltxpbmdog"
                inputMode="text"
                autoComplete="off"
                spellcheck={false}
              />
              <p class="mt-1 text-xs text-[var(--color-text-muted)]">16 位字母</p>
            </div>
            {error && <Alert level="danger">{error}</Alert>}
            <div class="flex justify-end">
              <Button onClick={handleBind} loading={binding} disabled={!chipid || !bindnumber}>
                绑定设备
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 缓存与日志 */}
      <div class="card">
        <h3 class="mb-3 font-medium">数据管理</h3>
        <div class="space-y-2">
          <button
            class="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-[var(--color-surface-2)]"
            onClick={handleClearCache}
          >
            <div>
              <div class="text-sm font-medium">清理缓存</div>
              <div class="text-xs text-[var(--color-text-muted)]">清理本地缓存的好友列表、动态数据</div>
            </div>
            <ChevronRight size={16} class="text-[var(--color-text-light)]" />
          </button>
          <button
            class="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-[var(--color-surface-2)]"
            onClick={handleViewLogs}
            disabled={loadingLogs}
          >
            <div>
              <div class="text-sm font-medium">查看操作日志</div>
              <div class="text-xs text-[var(--color-text-muted)]">
                {loadingLogs ? '加载中...' : '查看最近 100 条操作记录，支持按日期筛选'}
              </div>
            </div>
            <ChevronRight size={16} class="text-[var(--color-text-light)]" />
          </button>
        </div>
      </div>

      {/* 关于应用 */}
      <div class="card">
        <h3 class="mb-3 font-medium">关于应用</h3>
        <div class="space-y-2 text-sm">
          <Row label="应用名称" value="iMoo Desktop" />
          <Row label="版本" value={version?.app ?? '1.0.0-dev'} />
          <Row label="Python" value={version?.python ?? '-'} />
          <Row label="PySide6" value={version?.pyside ?? '-'} />
          <Row label="平台" value={`${version?.platform ?? '-'} ${version?.machine ?? ''}`} />
          <Row label="构建" value="PySide6 + Preact + Vite + Tailwind" />
          <Row label="源项目" value="sourxe-xtcbot (NoneBot2 IM 机器人)" />
        </div>
        {/* EULA 入口 */}
        <div class="mt-4 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
          <div class="flex items-center gap-2 text-sm">
            <ScrollText size={16} class="text-[var(--color-text-muted)]" aria-hidden="true" />
            <span>最终用户许可协议（EULA）</span>
            {eulaAccepted ? (
              <Badge level="success">
                <CheckCircle2 size={11} aria-hidden="true" />
                已同意 {eulaVersion}
              </Badge>
            ) : (
              <Badge level="warning">未同意</Badge>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={handleViewEula} loading={eulaLoading}>
            查看协议
          </Button>
        </div>
      </div>

      {/* EULA Modal */}
      <Modal open={eulaModal} onClose={() => setEulaModal(false)} title="最终用户许可协议（EULA）" width={640}>
        <div class="space-y-3">
          {eulaAccepted && (
            <Alert level="success">
              您已同意当前版本（{eulaVersion}）的许可协议。
            </Alert>
          )}
          <div class="max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <pre class="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[var(--color-text)]">{eulaText}</pre>
          </div>
          <p class="text-xs text-[var(--color-text-muted)]">
            协议版本：{eulaVersion || '-'}。如需重新同意，请删除本地 config.json 中的 eula_accepted 字段后重启应用。
          </p>
        </div>
      </Modal>

      {/* 日志 Modal */}
      <Modal
        open={logsModal}
        onClose={() => setLogsModal(false)}
        title="操作日志"
        width={640}
      >
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <select
            class="input max-w-xs text-xs"
            value={selectedDate}
            onChange={(e) => handleFilterByDate((e.target as HTMLSelectElement).value)}
            aria-label="按日期筛选日志"
          >
            <option value="">全部日期</option>
            {logDates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <span class="flex-1 text-xs text-[var(--color-text-muted)]">共 {logs.length} 条</span>
          <Button size="sm" variant="danger" onClick={handleClearLogs} loading={clearingLogs} disabled={logs.length === 0}>
            清空全部
          </Button>
        </div>
        <div class="max-h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <EmptyState icon={<FileX size={48} />} title="暂无日志" desc={selectedDate ? '该日期无日志记录' : '暂无操作日志'} />
          ) : (
            <div class="space-y-1">
              {logs.map((log, i) => (
                <div
                  key={i}
                  class={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                    log.level === 'ERROR' ? 'bg-[var(--color-danger-bg)]' :
                    log.level === 'WARN' ? 'bg-[var(--color-warning-bg)]' :
                    'hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  <span class="text-[10px] text-[var(--color-text-light)]">{log.ts}</span>
                  <Badge level={
                    log.level === 'ERROR' ? 'danger' :
                    log.level === 'WARN' ? 'warning' :
                    'info'
                  }>
                    {log.level}
                  </Badge>
                  <span class="font-mono">{log.action}</span>
                  <span class="flex-1 break-all text-[var(--color-text-muted)]">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <span class="text-xs text-[var(--color-text-muted)]">{label}</span>
      <span class={`text-right text-sm ${mono ? 'text-mono text-xs break-all' : ''}`}>
        {value === undefined || value === null || value === '' ? '-' : value}
      </span>
    </div>
  );
}
