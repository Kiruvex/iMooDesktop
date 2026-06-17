/**
 * Python ↔ JS 桥接层
 *
 * 通过 QWebChannel 与 Python 端的 AppBridge 通信。
 * 开发模式下若 QWebChannel 不可用，自动降级到 mock 数据。
 *
 * 核心导出：
 *  - `callApi<T>(method, args?)` — 调用任意 API（返回 Promise<T>）
 *  - `startTask(name, args, {onProgress, onDone})` — 启动长任务
 *  - `cancelTask(taskId)` — 取消长任务
 *  - `onDeviceChanged(cb)` — 监听设备变化
 *  - `onLogMessage(cb)` — 监听 Python 日志
 *  - `getConfig()` / `getVersion()` — 便捷方法
 *  - `api` — 命名空间化的 API 调用（推荐用法）
 */

declare global {
  interface Window {
    qt?: {
      webChannelTransport: unknown;
    };
  }
}

// ===== 类型定义 =====
/** QWebChannel 信号的最小化类型；connect 注册回调，参数由具体信号决定 */
interface Signal {
  connect(cb: (...args: any[]) => void): void;
}

/** Python 端 AppBridge 暴露给 JS 的接口（方法 + 信号） */
interface Bridge {
  call_api(id: string, json: string): void;
  start_task(id: string, name: string, payload: string): void;
  cancel_task(id: string): void;
  ping(): string;
  api_result: Signal;
  api_error: Signal;
  task_progress: Signal;
  task_done: Signal;
  log_message: Signal;
  device_changed: Signal;
}

/** Mock Bridge 自带标记字段，便于 callApi/startTask 区分真实/mock 模式 */
interface MockBridge {
  __isMock: true;
  callApi(method: string, args: Record<string, any>): Promise<any>;
}

/** 类型守卫：区分真实 Bridge 与 MockBridge */
function isMockBridge(b: Bridge | MockBridge): b is MockBridge {
  return (b as MockBridge).__isMock === true;
}

// ===== Bridge 加载 =====
let bridge: Bridge | MockBridge | null = null;
let bridgeReady: Promise<Bridge | MockBridge> | null = null;
let bridgeInitialized = false;

function loadBridge(): Promise<Bridge | MockBridge> {
  if (bridge) return Promise.resolve(bridge);
  if (bridgeReady) return bridgeReady;

  bridgeReady = new Promise((resolve, reject) => {
    // 不在 Qt 环境 → mock 模式
    if (!window.qt) {
      if (import.meta.env.DEV) {
        console.warn('[pyapi] 不在 Qt 环境中，启用 mock 模式');
      }
      bridge = createMockBridge();
      resolve(bridge);
      return;
    }

    // 加载 Qt 提供的 qwebchannel.js
    const script = document.createElement('script');
    script.src = 'qrc:///qtwebchannel/qwebchannel.js';
    script.onload = () => {
      // @ts-ignore - QWebChannel 由注入的脚本提供
      new QWebChannel(window.qt!.webChannelTransport, (channel: any) => {
        bridge = channel.objects.bridge as Bridge;
        resolve(bridge);
      });
    };
    script.onerror = () => {
      // 失败后清空状态，允许下次重试
      bridge = null;
      bridgeReady = null;
      reject(new Error('加载 qwebchannel.js 失败'));
    };
    document.head.appendChild(script);
  });

  return bridgeReady;
}

// ===== 请求映射表（带超时清理） =====
interface PendingEntry {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  method: string;
  ts: number;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, PendingEntry>();

/** 调用超时时间：30 秒（与 Python 端 HTTP 超时对齐） */
const CALL_TIMEOUT_MS = 30_000;

// ===== 任务回调表（带超时清理） =====
interface TaskCallbacks {
  onProgress?: (current: number, total: number, msg: string) => void;
  onDone?: (success: boolean, msg: string) => void;
  timer?: ReturnType<typeof setTimeout>;
  /** mock 模式下的 setInterval id，cancelTask 时清理 */
  mockTimer?: ReturnType<typeof setInterval>;
  /** mock 模式下的外层 setTimeout id（首进度前的 100ms 窗口期），cancelTask 时清理 */
  outerTimer?: ReturnType<typeof setTimeout>;
}
const taskCallbacks = new Map<string, TaskCallbacks>();

/** 任务超时时间：30 秒（无任何进度/完成信号即认为异常） */
const TASK_TIMEOUT_MS = 30_000;

// ===== 事件订阅 =====
type DeviceChangedCb = (device: DeviceInfo | null) => void;
type LogMessageCb = (level: string, msg: string) => void;
const deviceChangedCbs = new Set<DeviceChangedCb>();
const logMessageCbs = new Set<LogMessageCb>();

// ===== 类型定义（导出） =====
export interface DeviceInfo {
  chipid: string;
  bindnumber: string;
  watchid: string;
  model: string;
  imaccountid: string;
  name: string;
  bound_at: string;
}

export interface AppConfig {
  device: DeviceInfo | null;
  theme: string;
  last_page: string;
  cache_ttl_hours: number;
  version: string;
}

export interface VersionInfo {
  python: string;
  pyside: string;
  app: string;
  platform: string;
  machine?: string;
}

export interface ApiResult<T = any> {
  code: string;
  desc?: string;
  data?: T;
}

export interface ParsedMoment {
  id: string;
  nickname: string;
  content: string;
  images: string[];
  videos: string[];
  time: number | string;
  like_count: number;
  comment_count: number;
  comments: Array<{ watchName: string; comment: string; createTime: string }>;
  type?: string;
  moment_id?: string;
}

export interface MomentListResult {
  code: string;
  has_more: boolean;
  page: number;
  moments: ParsedMoment[];
  desc?: string;
}

/** 好友信息（friendslist / getfriend2 返回）
 *
 * 字段对齐原项目真实 API：
 *  - friendId：好友的 watchId（原 id）
 *  - name：好友名称（原 watchName）
 *  - imFriendId：好友的 IM Friend ID（原 imAccountId），用于 send_im 走 TLV 协议直连 IM 服务器
 */
export interface Friend {
  friendId: string;
  name: string;
  imFriendId?: string;
  relation?: string;
  headImg?: string;
  [k: string]: unknown;
}

function genId(prefix = 'r'): string {
  // 优先用原生 UUID（现代浏览器都支持），降级到时间戳+随机串
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== 信号监听初始化 =====
function setupSignalListeners(b: Bridge) {
  b.api_result.connect((id: string, json: string) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    try {
      const result = JSON.parse(json);
      p.resolve(result);
    } catch (e) {
      p.reject(new Error(`结果解析失败: ${e}`));
    }
    pending.delete(id);
  });

  b.api_error.connect((id: string, err: string) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.reject(new Error(err));
    pending.delete(id);
  });

  b.task_progress.connect((id: string, current: number, total: number, msg: string) => {
    const cb = taskCallbacks.get(id);
    if (!cb) return;
    // 收到进度时重置超时计时器
    if (cb.timer) clearTimeout(cb.timer);
    cb.timer = setTimeout(() => {
      if (taskCallbacks.has(id)) {
        cb.onDone?.(false, 'timeout');
        if (cb.mockTimer) clearInterval(cb.mockTimer);
        taskCallbacks.delete(id);
      }
    }, TASK_TIMEOUT_MS);
    cb.onProgress?.(current, total, msg);
  });

  b.task_done.connect((id: string, success: boolean, msg: string) => {
    const cb = taskCallbacks.get(id);
    if (!cb) return;
    if (cb.timer) clearTimeout(cb.timer);
    if (cb.mockTimer) clearInterval(cb.mockTimer);
    cb.onDone?.(success, msg);
    taskCallbacks.delete(id);
  });

  b.log_message?.connect((level: string, msg: string) => {
    if (import.meta.env.DEV) console.log(`[python:${level}]`, msg);
    logMessageCbs.forEach((cb) => cb(level, msg));
  });

  b.device_changed?.connect((deviceJson: string) => {
    let device: DeviceInfo | null = null;
    if (deviceJson) {
      try {
        device = JSON.parse(deviceJson);
      } catch {
        device = null;
      }
    }
    deviceChangedCbs.forEach((cb) => cb(device));
  });
}

/**
 * 调用 Python API 方法
 *
 * @param timeoutMs 超时时间（默认 30s 与 Python 端 HTTP 超时对齐）；
 *                  长任务型 API（如 momentpic 4 步流程）可传更大值。
 */
export async function callApi<T = any>(
  method: string,
  args: Record<string, any> = {},
  timeoutMs: number = CALL_TIMEOUT_MS,
): Promise<T> {
  const b = await loadBridge();

  // mock 模式：直接走 mock，不需要信号监听
  if (isMockBridge(b)) {
    return b.callApi(method, args);
  }

  if (!bridgeInitialized) {
    setupSignalListeners(b);
    bridgeInitialized = true;
  }

  return new Promise<T>((resolve, reject) => {
    const id = genId();
    const timer = setTimeout(() => {
      const p = pending.get(id);
      if (p) {
        p.reject(new Error(`timeout: ${method}`));
        pending.delete(id);
      }
    }, timeoutMs);
    pending.set(id, { resolve, reject, method, ts: Date.now(), timer });
    b.call_api(id, JSON.stringify({ method, args }));
  });
}

/**
 * 启动长任务
 */
export async function startTask(
  name: string,
  args: Record<string, any>,
  callbacks: TaskCallbacks
): Promise<string> {
  const b = await loadBridge();

  const id = genId('t');
  // 初始超时计时器（首次进度/完成前）
  const timer = setTimeout(() => {
    const cb = taskCallbacks.get(id);
    if (cb) {
      cb.onDone?.(false, 'timeout');
      if (cb.mockTimer) clearInterval(cb.mockTimer);
      taskCallbacks.delete(id);
    }
  }, TASK_TIMEOUT_MS);
  taskCallbacks.set(id, { ...callbacks, timer });

  // mock 模式
  if (isMockBridge(b)) {
    // 外层 setTimeout：100ms 后启动 setInterval 模拟进度。
    // 存入 entry.outerTimer，cancelTask 在 100ms 窗口期内也能清理。
    const outerTimer = setTimeout(() => {
      let cur = 0;
      const total = 10;
      const mockTimer = setInterval(() => {
        const entry = taskCallbacks.get(id);
        // 已被 cancel 或 done：直接停止 interval，避免泄漏
        if (!entry) {
          clearInterval(mockTimer);
          return;
        }
        cur++;
        // 每次进度重置超时计时器（与 task_progress 信号行为一致）
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          const e2 = taskCallbacks.get(id);
          if (e2) {
            if (e2.mockTimer) clearInterval(e2.mockTimer);
            e2.onDone?.(false, 'timeout');
            taskCallbacks.delete(id);
          }
        }, TASK_TIMEOUT_MS);
        entry.onProgress?.(cur, total, `mock 处理 ${cur}/${total}`);
        if (cur >= total) {
          clearInterval(mockTimer);
          // 与真实 bridge 一致：返回 JSON 字符串
          const result = { success: total, total, errors: 0, cancelled: false };
          if (entry.timer) clearTimeout(entry.timer);
          entry.onDone?.(true, JSON.stringify(result));
          taskCallbacks.delete(id);
        }
      }, 300);
      // 保存 mockTimer 供 cancelTask 使用
      const e3 = taskCallbacks.get(id);
      if (e3) e3.mockTimer = mockTimer;
    }, 100);
    // 存 outerTimer 以便 cancelTask 在 100ms 窗口期内也能清理
    const entry0 = taskCallbacks.get(id);
    if (entry0) entry0.outerTimer = outerTimer;
    return id;
  }

  if (!bridgeInitialized) {
    setupSignalListeners(b);
    bridgeInitialized = true;
  }

  b.start_task(id, name, JSON.stringify(args));
  return id;
}

/**
 * 取消长任务
 *
 * 主动通知调用方任务已取消（Python 取消可能不会触发 task_done），
 * mock 模式下还要 clearInterval。
 */
export async function cancelTask(taskId: string): Promise<void> {
  const b = await loadBridge();
  const cb = taskCallbacks.get(taskId);
  if (cb) {
    // 清理 mock 模式下的所有定时器（含 100ms 窗口期的 outerTimer）
    if (cb.outerTimer) clearTimeout(cb.outerTimer);
    if (cb.timer) clearTimeout(cb.timer);
    if (cb.mockTimer) clearInterval(cb.mockTimer);
    cb.onDone?.(false, 'cancelled');
    taskCallbacks.delete(taskId);
  }
  if (!isMockBridge(b)) {
    b.cancel_task(taskId);
  }
}

// ===== 事件订阅 =====
export function onDeviceChanged(cb: DeviceChangedCb): () => void {
  deviceChangedCbs.add(cb);
  return () => deviceChangedCbs.delete(cb);
}

export function onLogMessage(cb: LogMessageCb): () => void {
  logMessageCbs.add(cb);
  return () => logMessageCbs.delete(cb);
}

// ===== 便捷方法 =====
export async function getConfig(): Promise<AppConfig> {
  return callApi<AppConfig>('get_config');
}

export async function getVersion(): Promise<VersionInfo> {
  return callApi<VersionInfo>('get_version');
}

export async function bindDevice(chipid: string, bindnumber: string): Promise<ApiResult> {
  return callApi<ApiResult>('bind_device', { chipid, bindnumber });
}

export async function unbindDevice(): Promise<ApiResult> {
  return callApi<ApiResult>('unbind_device');
}

export async function setConfig(opts: { theme?: string; last_page?: string }): Promise<{ ok: boolean }> {
  return callApi('set_config', opts);
}

export async function clearCache(): Promise<{ ok: boolean; removed?: number }> {
  return callApi('cache_clear');
}

export async function getLogs(opts: { limit?: number; level?: string; date?: string } = {}): Promise<{ logs: any[] }> {
  return callApi('get_logs', opts);
}

// ===== 命名空间化的 API（推荐用法）=====
export const api = {
  // 设备
  getInfo: () => callApi<ApiResult>('get_info'),
  getyk: () => callApi<ApiResult>('getyk'),

  // 资料
  name: (new_name: string) => callApi<ApiResult>('name', { new_name }),
  sign: (new_signature: string) => callApi<ApiResult>('sign', { new_signature }),
  realname: (new_realname: string) => callApi<ApiResult>('realname', { new_realname }),
  personalinfo: () => callApi<ApiResult>('personalinfo'),

  // 好友
  friendslist: () => callApi<ApiResult>('friendslist'),
  getfriend2: () => callApi<ApiResult>('getfriend2'),
  getfriend: (friendid1: string) => callApi<ApiResult>('getfriend', { friendid1 }),
  add_friend: (friendid: string) => callApi<ApiResult>('add_friend', { friendid }),

  // 好友圈
  // momentview 返回已解析结构 MomentListResult（后端 _wrap_momentview 调 MomentParser.parse_list）
  momentview: (page: number = 1) => callApi<MomentListResult>('momentview', { page }),

  // 纯文本动态：momentid 参数 = 用户文本内容（后端将其写入 appName），bgid 默认 105
  moment: (content: string, bgid: string = '105') =>
    callApi<ApiResult>('moment', { momentid: content, bgid }),

  // 删除动态：调后端新增的 delmoment(momentid)
  delmoment: (momentId: string) => callApi<ApiResult>('delmoment', { momentid: momentId }),

  // 地名动态（发布，不是删除）
  momentblue: (momentid: string) => callApi<ApiResult>('momentblue', { momentid }),
  momentlink: (desc: string, link: string) => callApi<ApiResult>('momentlink', { desc, link }),

  // 微聊 - 真实 IM 消息发送（TLV 协议，走 BaseWorker 异步，首条约 2-5s）
  // friendId: 好友 watchid（用于日志显示）
  // friendImId: 好友 imAccountId（用于 IM 协议），若缺失可用 friendId 兜底（IM 可能失败）
  sendIm: (friendId: string, friendImId: string, content: string) =>
    callApi<ApiResult>('send_im', { friend_id: friendId, friend_im_id: friendImId, content }),

  // 图片动态（Task 10-A 新签名）：前端只传 base64 + 文字描述，
  // 后端 momentpic(image_data, content_text, momentid) 内部完成上传 + 发布 4 步流程。
  // 真机 4 步流程（transfer→qiniu query→qiniu upload→public）慢网可能 30-60s，
  // 放宽超时到 120s（callApi 默认 30s 会误判超时）。
  momentpic: (imageBase64: string, content: string) =>
    callApi<ApiResult>('momentpic', { image_base64: imageBase64, content }, 120_000),

  // 图片上传：保留 API 定义（其他场景可能用到），实际 momentpic 内部已自带上传
  uploadImage: (imageBase64: string) =>
    callApi<{ key: string; url: string; size: number }>('upload_image', { image_base64: imageBase64 }),

  // 运动
  step: (stepid: number | string) => callApi<ApiResult>('step', { stepid }),
  sport_fifty: (runid: number | string) => callApi<ApiResult>('sport_fifty', { runid }),
  sport_rope: (ropeid: number | string) => callApi<ApiResult>('sport_rope', { ropeid }),
  sport_bm: (bmid: number | string) => callApi<ApiResult>('sport_bm', { bmid }),

  // 点赞
  getlike: () => callApi<ApiResult>('getlike'),
  getlike_hasid: () => callApi<ApiResult>('getlike_hasid'),

  // 商店
  appsearch: (app_name: string) => callApi<ApiResult>('appsearch', { app_name }),

  // 工具
  calc_adb: (code: string) => callApi<{ result: string; error?: string }>('calc_adb', { code }),
  calc_zj: (code: string) => callApi<{ result: string; error?: string }>('calc_zj', { code }),

  // 刷新设备信息（后端 Task 12-A 新增 refresh_device：重跑 get_info 更新本地 watchid/model/imaccountid）
  refreshDevice: () => callApi<ApiResult & { data?: DeviceInfo }>('refresh_device'),

  // EULA 许可协议
  getEula: () => callApi<{ text: string; version: string; found: boolean }>('get_eula'),
  getEulaStatus: () => callApi<{ accepted: boolean; version: string; stored_version: string }>('get_eula_status'),

  // 任务
  likeall: (callbacks: TaskCallbacks) => startTask('likeall', {}, callbacks),
};

// ===== Mock Bridge（开发模式用） =====
function createMockBridge(): MockBridge {
  // 内存中的可变 mock 状态（让绑定/解绑流程在 mock 下也可演示）
  const mockState: {
    device: DeviceInfo | null;
    logs: any[];
  } = {
    device: null,
    logs: [],
  };

  const mockData: Record<string, any> = {
    get_version: () => ({
      python: '3.12.0',
      pyside: '6.6.0',
      app: '1.0.0-dev',
      platform: 'Web',
      machine: 'mock',
    }),
    get_config: () => ({
      device: mockState.device,
      theme: 'light',
      last_page: 'home',
      cache_ttl_hours: 24,
      version: '1.0.0-dev',
    }),
    set_config: () => ({ ok: true }),
    ping: () => ({ ts: Date.now() / 1000, ok: true }),
    bind_device: (args: any) => {
      mockState.device = {
        chipid: args.chipid,
        bindnumber: args.bindnumber,
        watchid: 'mock-watchid-' + Math.random().toString(36).slice(2, 8),
        model: 'Z7S',
        imaccountid: '293468949',
        name: '小天才 Mock',
        bound_at: new Date().toISOString(),
      };
      mockState.logs.push({ ts: new Date().toISOString(), level: 'INFO', action: 'bind_device', message: '设备已绑定' });
      // 通知所有订阅者（模拟 device_changed 信号）
      setTimeout(() => deviceChangedCbs.forEach((cb) => cb(mockState.device)), 0);
      return { code: '000001', desc: '成功', data: { id: mockState.device.watchid, name: mockState.device.name, model: 'Z7S', innerModel: 'Z7S', imAccountInfo: { imAccountId: '293468949' } } };
    },
    unbind_device: () => {
      mockState.device = null;
      setTimeout(() => deviceChangedCbs.forEach((cb) => cb(null)), 0);
      return { code: '000001', desc: '已解绑' };
    },
    get_logs: () => ({ logs: mockState.logs.slice(-100) }),
    get_log_dates: () => ({ dates: [new Date().toISOString().slice(0, 10)] }),
    clear_logs: () => { mockState.logs = []; return { ok: true }; },
    cache_clear: () => ({ ok: true, removed: 0 }),
    get_eula: () => ({
      text: 'iMooDesktop 最终用户许可协议（Mock 模式预览）\n\n这是开发模式下的 EULA 占位文本。真实 EULA 内容在打包后从 EULA.txt 读取。\n\n协议版本：v1.0',
      version: 'v1.0',
      found: true,
    }),
    get_eula_status: () => ({ accepted: true, version: 'v1.0', stored_version: 'v1.0' }),
    get_info: () => ({
      code: '000001',
      desc: '成功',
      data: {
        id: mockState.device?.watchid ?? 'mock-watchid-1234',
        name: mockState.device?.name ?? '小天才 Mock',
        model: 'Z7S',
        innerModel: 'Z7S',
        firmware: '1.0.0',
        battery: 85,
        watchOnline: true,
        pushProvince: '北京',
        language: 'zh-CN',
        powerLowProtectSwitch: true,
        imAccountInfo: { imAccountId: mockState.device?.imaccountid ?? '293468949' },
      },
    }),
    friendslist: {
      code: '000001',
      desc: '成功',
      // 真实 API：r.data 直接是数组（不是 {friends: [...]}）
      data: [
        { friendId: 'f1', name: '妈妈', imFriendId: '168655047', relation: '母亲', headImg: '' },
        { friendId: 'f2', name: '爸爸', imFriendId: '168655048', relation: '父亲', headImg: '' },
        { friendId: 'f3', name: '爷爷', imFriendId: '168655049', relation: '祖父', headImg: '' },
      ],
    },
    getfriend: () => ({
      code: '000001',
      data: { friendId: 'f1', name: '妈妈', relation: '母亲', imFriendId: '168655047' },
    }),
    getfriend2: () => ({
      code: '000001',
      data: [{ friendId: 'f1', name: '妈妈', imFriendId: '168655047' }],
    }),
    add_friend: () => ({
      code: '000001',
      desc: 'mock: 好友申请已发送',
    }),
    // 真实 API 返回嵌套结构：data.geniusAccount / data.personalInfo / data.simpleMedal / data.socializeUser
    personalinfo: {
      code: '000001',
      desc: '成功',
      data: {
        geniusAccount: { name: '小天才 Mock', level: 5, score: 1200, friends: 3, contacts: 5 },
        personalInfo: { signature: '今天也要加油呀', fuzzyLikes: 24 },
        simpleMedal: { medals: [{ name: '运动达人' }, { name: '学霸' }] },
        socializeUser: {},
      },
    },
    // 后端 _wrap_momentview 返回已解析结构 MomentListResult（调 MomentParser.parse_list）
    momentview: {
      code: '000001',
      has_more: false,
      page: 1,
      moments: [
        {
          id: 'm1',
          moment_id: 'm1',
          nickname: '妈妈',
          content: '今天孩子很乖，主动完成了作业',
          images: [],
          videos: [],
          time: 1700000000000,
          like_count: 12,
          comment_count: 2,
          comments: [
            { watchName: '爸爸', comment: '真棒', createTime: 1700000000000 },
            { watchName: '爷爷', comment: '孙子加油', createTime: 1700000000000 },
          ],
          type: '7',
        },
        {
          id: 'm2',
          moment_id: 'm2',
          nickname: '小天才',
          content: '今天完成了 10000 步挑战！',
          images: [],
          videos: [],
          time: 1700000000000,
          like_count: 5,
          comment_count: 0,
          comments: [],
          type: '7',
        },
      ],
    },
    getlike: { code: '000001', data: { total: 24 } },
    getlike_hasid: { code: '000001', data: { total: 24, hasId: true } },
    // getyk 真实语义：用 code 判云控状态（'000001'=未云控），data 是点赞明细
    getyk: { code: '000001', desc: '未云控', data: { records: [], total: 0 } },
    // calc_adb/calc_zj：模拟真实 bridge 的 8 位纯数字校验（开发模式可测出校验失败）
    calc_adb: (args: any) => {
      const code = String(args?.code ?? '');
      if (!code || !/^\d+$/.test(code)) return { result: '', error: '输入必须为纯数字' };
      if (code.length !== 8) return { result: '', error: 'ADB 校验码必须为 8 位数字' };
      return { result: 'MOCK_ADB_' + Math.random().toString(36).slice(2, 10).toUpperCase() };
    },
    calc_zj: (args: any) => {
      const code = String(args?.code ?? '');
      if (!code || !/^\d+$/.test(code)) return { result: '', error: '输入必须为纯数字' };
      if (code.length !== 8) return { result: '', error: '自检校验码必须为 8 位数字' };
      return { result: 'MOCK_ZJ_' + Math.random().toString(36).slice(2, 10).toUpperCase() };
    },
    // refresh_device：后端 Task 12-A 新增，重跑 get_info 更新本地缓存
    refresh_device: () => {
      if (!mockState.device) return { code: 'ERR', desc: '设备未绑定' };
      // mock：返回当前 device（真实会重跑 get_info 后回写并触发 device_changed）
      return { code: '000001', desc: 'mock: 设备信息已刷新', data: mockState.device };
    },
    name: { code: '000001', desc: 'mock: 名称已更新' },
    sign: { code: '000001', desc: 'mock: 签名已更新' },
    realname: { code: '000001', desc: 'mock: 实名已更新' },
    step: { code: '000001', desc: 'mock: 步数已更新' },
    sport_fifty: { code: '000001', desc: 'mock: 50米跑已更新' },
    sport_rope: { code: '000001', desc: 'mock: 跳绳已更新' },
    sport_bm: { code: '000001', desc: 'mock: BMI 已更新' },
    moment: { code: '000001', desc: 'mock: 动态已发布' },
    // 新增：删除动态 mock
    delmoment: { code: '000001', desc: 'mock: 动态已删除' },
    // momentblue 是发布地名动态，不是删除
    momentblue: { code: '000001', desc: 'mock: 地名动态已发布' },
    momentlink: { code: '000001', desc: 'mock: 链接动态已发布' },
    // 微聊真实 IM mock：模拟 1.5s IM 连接耗时后成功（异步走 Worker 的行为）
    send_im: (args: any) =>
      new Promise(resolve =>
        setTimeout(
          () => resolve({ code: '000001', desc: 'mock: IM 消息已发送 → ' + (args?.friend_im_id ?? args?.friend_id ?? '') }),
          1500
        )
      ),
    // 图片上传 mock：占位图（蓝色，与 primary #3b82f6 一致）
    upload_image: (args: any) => ({
      key: 'mock-' + Date.now(),
      url: 'https://placehold.co/600x400/3b82f6/ffffff?text=Mock+Image',
      size: 10240,
    }),
    // 图片动态 mock：新签名（前端只传 base64 + content，后端做 4 步流程）
    momentpic: { code: '000001', desc: 'mock: 图片动态已发布' },
    // 真实 API：data.searchList 数组（不是直接数组）
    appsearch: {
      code: '000001',
      data: {
        searchList: [
          { name: '微信', appId: 'wx', versionName: '8.0', packageName: 'com.tencent.mm', sizeShow: '120MB', score: 4.5, developer: '腾讯', upDateShow: '2024-01-01', upgradeInfo: '修复bug', summary: '社交应用', url: 'http://example.com/wx' },
          { name: 'QQ', appId: 'qq', versionName: '8.9', packageName: 'com.tencent.mobileqq', sizeShow: '95MB', score: 4.2, developer: '腾讯', upDateShow: '2024-01-01', upgradeInfo: '新增功能', summary: '社交应用', url: 'http://example.com/qq' },
        ],
      },
    },
  };

  return {
    __isMock: true,
    callApi(method: string, args: any) {
      if (import.meta.env.DEV) console.log('[mock] callApi', method, args);
      const value = mockData[method];
      if (typeof value === 'function') {
        try {
          return Promise.resolve(value(args));
        } catch (e: any) {
          return Promise.reject(e);
        }
      }
      return Promise.resolve(value ?? { code: '000001', desc: 'mock 成功' });
    },
  };
}
