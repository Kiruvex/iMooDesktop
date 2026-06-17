# XTCBot → Preact + PySide6 桌面应用 改造计划书

> **文档版本**：v2.0（方案 D：Preact 壳）
> **编写日期**：2025
> **目标产物**：跨平台（Windows / macOS / Linux）个人桌面应用 **iMoo Desktop**
> **源项目**：`sourxe-xtcbot-main`（基于 NoneBot2 的 QQ 机器人）
> **核心策略**：**Preact 前端 + PySide6 QWebEngineView 壳 + QWebChannel 桥接**

---

## 目录

1. [项目背景与动机](#1-项目背景与动机)
2. [现状分析](#2-现状分析)
3. [目标定义](#3-目标定义)
4. [架构设计（方案 D）](#4-架构设计方案-d)
5. [功能模块映射表](#5-功能模块映射表)
6. [技术选型与依赖清单](#6-技术选型与依赖清单)
7. [目录结构与工程组织](#7-目录结构与工程组织)
8. [分阶段实施计划](#8-分阶段实施计划)
9. [关键技术挑战与对策](#9-关键技术挑战与对策)
10. [UI / UX 设计规范](#10-ui--ux-设计规范)
11. [数据存储与配置方案](#11-数据存储与配置方案)
12. [桥接协议设计](#12-桥接协议设计)
13. [打包与发布策略](#13-打包与发布策略)
14. [风险评估与回滚方案](#14-风险评估与回滚方案)
15. [测试与验收标准](#15-测试与验收标准)
16. [里程碑时间表](#16-里程碑时间表)
17. [附录](#17-附录)

---

## 1. 项目背景与动机

### 1.1 源项目概述

`sourxe-xtcbot-main` 是基于 **NoneBot2 + Napcat** 的 QQ 机器人，对接 `okii.com`（小天才/步步高儿童手表）官方 API 与自研 IM 协议。功能涵盖：设备管理、步数/名称/签名/实名修改、微聊消息发送、批量点赞、好友圈动态发布/浏览/删除、应用商店搜索、运动数据上传等。

### 1.2 改造动机

| 痛点 | 描述 |
|------|------|
| 三重依赖 | 必须同时部署 QQ + Napcat + MySQL |
| 鉴权复杂 | 用户必须加群、绑定 QQ、走权限角色 |
| 不可离线 | 机器人挂载云端，本地调试不便 |
| 体验割裂 | 命令行交互，参数输入不友好 |
| 多用户开销 | 个人用户不需要 MySQL 连接池与任务排队 |

### 1.3 改造目标

将多人 SaaS 化命令行机器人转化为单人本地化图形界面桌面应用：双击即用、图形化操作、数据本地保存、跨平台运行、完整保留业务能力。

---

## 2. 现状分析

### 2.1 源项目架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  表现层 (强 NoneBot2 依赖 — 需重写)                          │
│  ├─ bot.py                  NoneBot2 启动入口               │
│  ├─ src/plugins/*.py        40 个命令插件                   │
│  └─ moment_web.py           FastAPI Web 子应用 (好友圈 UI)   │
├─────────────────────────────────────────────────────────────┤
│  业务逻辑层 (零 NoneBot2 依赖 — 可直接复用) ✅              │
│  ├─ modules/Apirequests.py  HTTP API 客户端 (976行, 24方法)  │
│  ├─ modules/im_client.py    TLV socket IM 客户端            │
│  └─ modules/NumCrypto.py    编码/加密工具                   │
├─────────────────────────────────────────────────────────────┤
│  存储层 (MySQL — 个人版替换为本地文件)                       │
│  └─ user_info / devices_info / likeall_tasks / tokens       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 业务逻辑层盘点（已复用）

| 模块 | 方法数 | 复用状态 |
|------|--------|---------|
| `core/watch_api.py` | 24 个 | ✅ 已重构为类，配置注入 |
| `core/im_client.py` | TLV IM 协议 | ✅ 原样复用 |
| `core/num_crypto.py` | ADB/自检算码 | ✅ 原样复用 |

### 2.3 表现层盘点（需重写）

40 个命令插件按功能域分类：设备管理(4) / 资料修改(4) / 运动数据(4) / 微聊(4) / 好友圈(9) / 互动(1) / 应用商店(1) / 算码(2) / 第三方(1) / 管理(10弃用)。

**结论**：约 25 个需移植，8 个直接弃用（权限/激活码），7 个低优先级。

---

## 3. 目标定义

### 3.1 产品形态

**iMoo Desktop** —— 本地运行跨平台桌面应用：
1. 下载安装包（Win `.exe` / Mac `.dmg` / Linux `.AppImage`）
2. 双击启动
3. 应用内填写 `chipid` + `bindnumber` 绑定设备
4. 图形界面操作所有功能
5. 数据保存在 `~/.local/share/iMooDesktop/`（或对应平台路径）

### 3.2 核心目标

| # | 目标 | 衡量标准 |
|---|------|---------|
| G1 | 零外部依赖 | 不需要 QQ/Napcat/MySQL/Node.js |
| G2 | 完整功能覆盖 | 移植所有 P0/P1 共 22 项功能 |
| G3 | 跨平台 | Win/Mac/Linux 三端均可运行 |
| G4 | 响应式 UI | 主操作 < 3 次点击，无阻塞卡顿 |
| G5 | 数据本地化 | 所有配置与缓存存于本地 |
| G6 | 可打包分发 | 安装包 < 90MB（含 Chromium） |

### 3.3 非目标

- ❌ 不保留多用户能力
- ❌ 不保留权限角色系统
- ❌ 不保留任务排队机制
- ❌ 不提供云端同步

---

## 4. 架构设计（方案 D）

### 4.1 整体架构

```
┌────────────────────────────────────────────────────────────┐
│                    iMoo Desktop                        │
├────────────────────────────────────────────────────────────┤
│  渲染层 (Preact + Tailwind CSS)                            │
│  ├─ frontend/src/App.tsx              主应用 + 路由        │
│  ├─ frontend/src/components/          UI 组件              │
│  ├─ frontend/src/pages/               功能页面             │
│  └─ frontend/src/lib/pyapi.ts         Python API 封装      │
├────────────────────────────────────────────────────────────┤
│  Qt 壳层 (PySide6)                                         │
│  ├─ shell/main_window.py              QMainWindow + WebEng │
│  └─ main.py                           应用入口             │
├────────────────────────────────────────────────────────────┤
│  桥接层 (QWebChannel)                                      │
│  └─ bridge/app_bridge.py               Python↔JS 异步 RPC  │
│      ├─ call_api(req_id, payload)      JS→Python API 调用  │
│      ├─ api_result / api_error         Python→JS 结果回传  │
│      ├─ start_task / cancel_task       长任务控制          │
│      └─ task_progress / task_done      长任务进度流        │
├────────────────────────────────────────────────────────────┤
│  异步任务层 (QThread)                                      │
│  └─ workers/base_worker.py             BaseWorker + Batch  │
├────────────────────────────────────────────────────────────┤
│  业务逻辑层 (复用原项目) ✅                                │
│  ├─ core/watch_api.py                  24 个 API 方法      │
│  ├─ core/im_client.py                  TLV IM 协议         │
│  └─ core/num_crypto.py                 算码工具            │
├────────────────────────────────────────────────────────────┤
│  存储层 (本地 JSON)                                        │
│  └─ storage/config_store.py            设备绑定 + 应用配置 │
└────────────────────────────────────────────────────────────┘
```

### 4.2 双模式运行

**开发模式**（HMR 热更新）：
```bash
# 终端 1
cd frontend && bun run dev          # → http://localhost:5173/

# 终端 2
python main.py --dev                # → QWebEngineView 加载 localhost:5173
```

**发布模式**（静态文件）：
```bash
cd frontend && bun run build        # → frontend/dist/
python main.py                      # → QWebEngineView 加载 file://.../dist/index.html
```

### 4.3 数据流

```
用户点击按钮 (Preact)
    ↓
pyapi.callApi('get_info', {bindnumber, chipid})
    ↓
QWebChannel: bridge.call_api(req_id, json_payload)
    ↓
AppBridge.call_api() 解析 method + args
    ↓
BaseWorker(WatchAPI.get_info, **args).start()  [子线程]
    ↓
WatchAPI.get_info() 执行 requests.post  [子线程]
    ↓
worker.finished_ok.emit(result)
    ↓
bridge.api_result.emit(req_id, json)  [Signal]
    ↓
JS: bridge.api_result 信号 → pending[id].resolve(data)
    ↓
Preact 组件更新 UI
```

### 4.4 设计原则

1. **业务逻辑零 GUI 依赖**：`core/` 不 import 任何 PySide6 模块
2. **前端零 Python 依赖**：`frontend/` 通过 `pyapi.ts` 抽象层通信，可独立 mock 开发
3. **桥接协议异步**：所有 `call_api` 返回 Promise，Python 端用 QThread 执行
4. **配置注入**：`WatchAPI` 通过构造函数接收 config，非全局变量

---

## 5. 功能模块映射表

### 5.1 P0 优先级（首版必须完成）

| 原命令 | 桌面化形态 | 前端文件 | Python 方法 |
|--------|-----------|---------|------------|
| `/bindwatch` | 绑定向导 | `pages/SettingsPage.tsx` | `bind_device` (本地) |
| `/getinfo` | 设备信息页 | `pages/DeviceInfoPage.tsx` | `WatchAPI.get_info` |
| `/refresh` | 设备刷新按钮 | `pages/DeviceInfoPage.tsx` | `WatchAPI.get_info` |
| `/unbind` | 解绑按钮 | `pages/SettingsPage.tsx` | `unbind_device` (本地) |
| `/step` | 步数修改页 | `pages/StepPage.tsx` | `WatchAPI.step` |
| `/name` | 名称修改 | `pages/ProfilePage.tsx` | `WatchAPI.name` |
| `/sign` | 签名修改 | `pages/ProfilePage.tsx` | `WatchAPI.sign` |
| `/moment` | 发布动态页 | `pages/MomentPostPage.tsx` | `WatchAPI.moment` |
| 好友圈浏览 | 好友圈页 | `pages/MomentsPage.tsx` | `WatchAPI.momentview` |
| `/adb` | 算码工具 | `pages/ToolsPage.tsx` | `calc_adb` (本地) |
| `/zj` | 算码工具 | `pages/ToolsPage.tsx` | `calc_zj` (本地) |

### 5.2 P1 优先级（次版本）

| 原命令 | 桌面化形态 | Python 方法 |
|--------|-----------|------------|
| `/realname` | 资料页 | `WatchAPI.realname` |
| `/personalinfo` | 资料页(只读) | `WatchAPI.personalinfo` |
| `/sport50` `/sportbm` `/rope` | 运动页 | `WatchAPI.sport_fifty/bm/rope` |
| `/send` | 微聊页 | `im_client.send_im_message` |
| `/imfriendid` | 微聊页 | `WatchAPI.getfriend2` |
| `/getlikes` | 微聊页 | `WatchAPI.getlike` |
| `/momentblue` | 动态页选项 | `WatchAPI.momentblue` |
| `/momentpic` | 动态页图片 | `WatchAPI.moment` + 七牛上传 |
| `/delmoment` | 好友圈右键 | `WatchAPI.delmoment` |
| `/bgid` | 动态页参考表 | 本地数据 |
| `/likeall` | 批量点赞页 | `WatchAPI.likeall` (生成器) |

### 5.3 P2 优先级（可选增强）

| 原命令 | 说明 |
|--------|------|
| `/momentvid` | 视频动态（需 FFmpeg） |
| `/momenturl` | 链接卡片动态 |
| `/hitokoto` | 一言快捷发送 |
| `/sendall` | 群发微聊 |
| `/appsearch` | 应用商店搜索 |
| `/bili` | B 站视频解析发送 |

### 5.4 直接弃用

| 原命令 | 弃用原因 |
|--------|---------|
| `/ac` `/gencode` | 激活码系统 |
| `/addpro` `/removepro` | 权限管理 |
| `/getrole` | 查权限组 |
| `/getkey` | Web 临时令牌 |
| `/bindhelp` | 帮助视频链接 |
| `/about` `/help` | 改为应用内菜单 |
| `/???` | 彩蛋 |

---

## 6. 技术选型与依赖清单

### 6.1 技术栈

| 层 | 技术 | 版本 | 说明 |
|----|------|------|------|
| **后端** | | | |
| 语言 | Python | 3.10+ | 推荐 3.12 |
| GUI 框架 | PySide6 | 6.6+ | Qt 官方 Python 绑定 |
| WebEngine | PySide6-Addons | 6.6+ | 含 QtWebEngine |
| 网络请求 | requests | 2.28+ | 复用原项目 |
| 配置 | PyYAML | 6.0+ | 复用 config.yaml |
| 打包 | PyInstaller | 6.0+ | 跨平台打包 |
| **前端** | | | |
| 框架 | Preact | 10.24+ | 轻量 React 替代 |
| 构建 | Vite | 6.0+ | 极速 HMR + 打包 |
| 样式 | Tailwind CSS | 4.0+ | 原子化 CSS |
| 语言 | TypeScript | 5.6+ | 类型安全 |
| 包管理 | Bun | 1.3+ | 极速安装 |

### 6.2 Python requirements.txt

```txt
PySide6>=6.6.0
PySide6-Addons>=6.6.0
requests>=2.28.0
PyYAML>=6.0
pyinstaller>=6.0.0
```

### 6.3 前端 package.json

```json
{
  "dependencies": { "preact": "^10.24.0" },
  "devDependencies": {
    "@preact/preset-vite": "^2.9.1",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

### 6.4 移除的原依赖

```txt
nonebot2              # 不再使用机器人框架
nonebot-adapter-onebot # 不再接入 QQ
PyMySQL               # 不再使用 MySQL
DBUtils               # 不再使用连接池
aiohttp               # 改用 requests + QThread
fastapi               # 好友圈 Web 改为内嵌
jinja2                # 同上
```

---

## 7. 目录结构与工程组织

### 7.1 目录结构（已实现）

```
iMooDesktop/
├── main.py                       # ✅ 应用入口
├── config.yaml                   # ✅ API 端点配置 (复用)
├── requirements.txt              # ✅ Python 依赖
├── .gitignore
├── worklog.md                    # ✅ 工作日志
├── plan.md                       # ✅ 本文件
│
├── core/                         # ✅ 业务逻辑层 (零 GUI 依赖)
│   ├── __init__.py
│   ├── watch_api.py              # ✅ 24 个 API 方法 (重构自 Apirequests.py)
│   ├── im_client.py              # ✅ TLV IM 客户端 (原样复用)
│   └── num_crypto.py             # ✅ 算码工具 (原样复用)
│
├── storage/                      # ✅ 存储层
│   ├── __init__.py
│   └── config_store.py           # ✅ JSON 持久化 + dataclass
│
├── workers/                      # ✅ 异步任务层
│   ├── __init__.py
│   └── base_worker.py            # ✅ QThread + Signal/Slot
│
├── bridge/                       # ✅ Python↔JS 桥接层
│   ├── __init__.py
│   └── app_bridge.py             # ✅ QWebChannel + API 路由
│
├── shell/                        # ✅ Qt 壳层
│   ├── __init__.py
│   └── main_window.py            # ✅ QMainWindow + QWebEngineView
│
├── frontend/                     # ✅ Preact 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx              # ✅ Preact 入口
│       ├── App.tsx               # ✅ 主应用 + 路由
│       ├── index.css             # ✅ Tailwind + 自定义样式
│       ├── lib/
│       │   └── pyapi.ts          # ✅ Python API 封装 + mock
│       ├── components/
│       │   ├── Sidebar.tsx       # ✅ 侧边栏导航
│       │   └── TopBar.tsx        # ✅ 顶部栏
│       └── pages/
│           ├── HomePage.tsx      # ✅ 首页
│           ├── DeviceInfoPage.tsx # ✅ 设备信息
│           ├── ToolsPage.tsx     # ✅ 算码工具
│           ├── SettingsPage.tsx  # ✅ 设置/绑定
│           └── PlaceholderPage.tsx # ✅ 占位页
│
└── assets/                       # 资源文件
    └── icons/                    # 应用图标
```

### 7.2 待补全目录（Phase 1-7）

```
iMooDesktop/
├── core/
│   └── moment_parser.py          # 待抽取: 好友圈数据解析
├── storage/
│   ├── cache_store.py            # 待实现: 好友/动态缓存
│   └── log_store.py              # 待实现: 操作日志
├── workers/
│   ├── im_worker.py              # 待实现: IM 长连接
│   └── batch_worker.py           # 待实现: 批量任务
├── frontend/src/
│   ├── pages/
│   │   ├── StepPage.tsx          # 待实现: 步数修改
│   │   ├── ProfilePage.tsx       # 待实现: 资料修改
│   │   ├── SportPage.tsx         # 待实现: 运动数据
│   │   ├── MomentsPage.tsx       # 待实现: 好友圈浏览
│   │   ├── MomentPostPage.tsx    # 待实现: 发布动态
│   │   ├── IMPage.tsx            # 待实现: 微聊
│   │   └── LikeAllPage.tsx       # 待实现: 批量点赞
│   └── components/
│       ├── DeviceCard.tsx        # 待实现: 设备卡片
│       ├── MomentCard.tsx        # 待实现: 动态卡片
│       └── Toast.tsx             # 待实现: 通知组件
└── assets/
    ├── icons/app.ico             # 待设计: 应用图标
    └── styles/                   # 待实现: 主题样式
```

---

## 8. 分阶段实施计划

### Phase 0：项目初始化 ✅ 已完成

- [x] 创建 `iMooDesktop/` 目录结构
- [x] 初始化 Python venv + 安装 PySide6 6.11.1
- [x] 初始化 Preact + Vite + Tailwind 前端工程
- [x] 复用原项目核心逻辑到 `core/`
- [x] 实现 `storage/config_store.py`
- [x] 实现 `workers/base_worker.py`
- [x] 实现 `bridge/app_bridge.py`
- [x] 实现 `shell/main_window.py`
- [x] 实现 `main.py` 入口
- [x] 前端骨架：Sidebar + TopBar + 5 个页面
- [x] 实现 `pyapi.ts` 桥接封装（含 mock 模式）
- [x] 前端构建验证通过（42KB 产物）
- [x] Vite dev server 验证通过
- [x] Python 模块 import 验证通过

### Phase 1：核心逻辑完善 ✅ 已完成

- [x] 抽取 `core/moment_parser.py`（从 moment_web.py）— 完整解析 momentview 响应，输出前端友好结构
- [x] 实现 `storage/cache_store.py`（好友/动态缓存）— TTL + JSON 持久化 + 业务快捷方法
- [x] 实现 `storage/log_store.py`（操作日志）— 按日滚动 JSONL + 内存最近 500 条 + 多级别日志
- [x] 完善 `bridge/app_bridge.py` 本地方法（设备自动注入四元组）— 21 个业务方法 + 12 个本地方法
- [x] 新增 `workers/base_worker.py` BatchWorker + LikeAllWorker（生成器迭代 + 进度流 + 取消）
- [x] 完善 `main.py` 注入 CacheStore + LogStore + 日志系统配置
- [x] 完善 `frontend/src/lib/pyapi.ts` — 命名空间化 api + 事件总线 + mock 状态持久化
- [x] 完善设计系统 `index.css` — 30+ 组件类、深色主题预留、Toast/Modal/Skeleton/Alert/Badge/Progress
- [x] 新增通用组件 `components/ui.tsx` — Button/Modal/ConfirmDialog/EmptyState/Skeleton/ProgressBar/PageHeader
- [x] 新增 Toast 通知系统 `components/Toast.tsx` — Context Provider + 命令式 confirm()
- [x] 重构 `Sidebar.tsx` — 分组导航 + 未绑定时禁用功能页
- [x] 重构 `TopBar.tsx` — 设备状态指示 + Python 日志面板
- [x] 重构 `App.tsx` — ToastProvider 包裹 + 设备状态全局联动 + 页面持久化
- [x] 实现 8 个业务页面：
  - `HomePage` — 欢迎卡片 + 设备摘要 + 快捷功能 + 使用说明
  - `DeviceInfoPage` — 设备摘要 + 详细字段 + 云控状态 + 本地绑定信息 + Skeleton 加载
  - `ProfilePage` — 名称/签名/实名三个独立保存表单 + 未保存徽章 + 字数统计
  - `SportPage` — 4 个 Tab（步数/50米/跳绳/BMI）+ 快捷预设 + 范围校验
  - `MomentPage` — 动态列表 + 发布新动态 + 详情 Modal + 删除确认 + 分页加载更多
  - `IMPage` — 好友列表 + 消息输入 + 发送历史 + Skeleton 加载
  - `LikeAllPage` — 进度条 + 取消机制 + 统计卡片 + 风险提示
  - `ToolsPage` — ADB 算码 + 自检算码 + 应用搜索 + 复制到剪贴板
  - `SettingsPage` — 设备绑定/解绑 + 缓存清理 + 日志查看 + 关于信息
- [x] Mock 模式增强：内存级状态持久化，绑定/解绑流程在开发模式下完整可演示
- [x] TypeScript 类型检查 0 错误
- [x] Vite 构建通过：23 模块，69.89KB JS + 25.9KB CSS（gzip 21.94KB + 6.08KB）
- [x] Agent Browser 端到端验证：首页/设置/工具/绑定/设备信息/好友圈/批量点赞/解绑全部正常

### Phase 2：P0 功能页面 ✅ 已在 Phase 1 中完成

- [x] `SportPage.tsx` — 步数修改（输入框 0-98799 + 提交 + 快捷预设）
- [x] `ProfilePage.tsx` — 名称/签名/实名修改（独立表单 + 字数统计 + 未保存徽章）
- [x] `MomentPage.tsx` — 发布动态（内容 + momentid）+ 浏览（卡片列表 + 详情 Modal）
- [x] 完善 `DeviceInfoPage.tsx` — 加入云控状态（getyk）+ Skeleton 加载

### Phase 3：P1 功能页面 ✅ 已在 Phase 1 中完成

- [x] `SportPage.tsx` — 50米/跳绳/BMI 三个子标签完整实现
- [x] `IMPage.tsx` — 好友列表 + 消息发送 + 发送历史
- [x] `LikeAllPage.tsx` — 批量点赞（进度条 + 取消 + 统计卡片）
- [ ] `MomentPage.tsx` 扩展 — 图片动态（七牛上传 + Pillow 转 WebP）— Phase 4+ 再做

### Phase 4：UI 打磨（1.5 天）

- [ ] 应用图标设计
- [ ] Toast 通知组件
- [ ] 加载状态骨架屏
- [ ] 空状态设计
- [ ] 深色/浅色主题切换
- [ ] 响应式布局优化

### Phase 5：打包发布（1.5 天）

- [ ] PyInstaller spec 配置
- [ ] 前端构建脚本 `build.sh`
- [ ] 三端打包验证
- [ ] 体积优化（排除未用 Qt 模块）
- [ ] 发布到 GitHub Releases

**总工期：10-13 个工作日**（Phase 0 已完成）

---

## 9. 关键技术挑战与对策

### 9.1 挑战一：Python↔JS 异步桥接 ✅ 已解决

**问题**：QWebChannel 的 `@Slot` 是同步的，不能直接调用阻塞的 `requests.post`。

**对策**：设计异步 RPC 协议：
- JS 调用 `bridge.call_api(request_id, payload)` 立即返回
- Python 创建 `BaseWorker` 子线程执行
- 完成后 `api_result.emit(request_id, json)` 回传
- JS 通过 `request_id` 匹配 Promise resolve/reject

**实现**：`bridge/app_bridge.py` + `frontend/src/lib/pyapi.ts`

### 9.2 挑战二：长任务进度流 ✅ 已解决

**问题**：`likeall` 是生成器，需流式回调进度。

**对策**：
- `BatchWorker(QThread)` 包装生成器
- 每次迭代 `progress.emit(current, total, msg)`
- JS 端 `startTask(name, args, {onProgress, onDone})` 注册回调
- 取消：`cancel_task(task_id)` → `worker.cancel()` → 检查点退出

**实现**：`workers/base_worker.py` + `pyapi.ts startTask()`

### 9.3 挑战三：设备四元组自动注入 ✅ 已解决

**问题**：大部分 API 需要 `watchid/bindnumber/chipid/model` 四个参数，前端不应重复传递。

**对策**：`AppBridge.call_api()` 中自动从 `ConfigStore` 读取设备配置，注入到 args：
```python
device = self.config.get_device()
for key in ("watchid", "bindnumber", "chipid", "model"):
    if key not in args and hasattr(device, key):
        args[key] = getattr(device, key)
```

### 9.4 挑战四：开发模式 HMR + 发布模式静态加载 ✅ 已解决

**问题**：开发时需要 Vite HMR，发布时需要纯静态文件。

**对策**：`shell/main_window.py` 双模式加载：
```python
if self.dev_mode:
    self.view.loadUrl(QUrl("http://localhost:5173/"))
else:
    index_html = base / "frontend" / "dist" / "index.html"
    self.view.loadUrl(QUrl.fromLocalFile(str(index_html)))
```

Vite 配置 `base: './'` 确保相对路径，支持 `file://` 协议。

### 9.5 挑战五：Mock 模式独立开发 ✅ 已解决

**问题**：前端开发时不一定启动 Python，需要能独立调试。

**对策**：`pyapi.ts` 检测 `window.qt` 是否存在：
- 存在：加载 qwebchannel.js，真实桥接
- 不存在：启用 mock 模式，返回预设数据

开发者可直接 `bun run dev` 在浏览器中调试 UI，无需启动 Python。

### 9.6 挑战六：图片转 WebP（P1）

**问题**：原 `momentpic.py` 依赖外部 FFmpeg。

**对策**：改用 Pillow：
```python
from PIL import Image
Image.open(src).convert('RGB').save(dst, 'WEBP', quality=80)
```

### 9.7 挑战七：跨平台系统库

**问题**：Linux 上 Qt WebEngine 依赖 libXtst/libEGL/libnss3 等系统库。

**对策**：
- 文档中列出依赖清单
- AppImage 打包时包含这些库
- Windows/Mac 打包无此问题（PyInstaller 自动处理）

---

## 10. UI / UX 设计规范

### 10.1 整体风格

- **设计语言**：现代扁平 + 卡片化
- **主色调**：蓝色 + 石板灰
  - Primary: `#3B82F6` (蓝色，用户指定)
  - Accent: `#F59E0B` (琥珀色)
  - Background: `#F9FAFB`
  - Surface: `#FFFFFF`
  - Text: `#111827` / Muted: `#6B7280`
  - Border: `#E5E7EB`

### 10.2 主窗口布局

```
┌──────────────────────────────────────────────────────────────┐
│  [☰] iMoo Desktop            [设备:已绑定 ▾] [🌙] [⚙]    │  ← TopBar (48px)
├──────────┬───────────────────────────────────────────────────┤
│  🏠 首页  │                                                   │
│  📱 设备  │                                                   │
│  👤 资料  │            主内容区 (Preact 路由)                 │
│  🏃 运动  │                                                   │
│  🌐 好友圈│                                                   │
│  💬 微聊  │                                                   │
│  ⭐ 互动  │                                                   │
│  🛠 工具  │                                                   │
│  ⚙ 设置  │                                                   │
│  180px   │                                                   │
└──────────┴───────────────────────────────────────────────────┘
```

### 10.3 CSS 实现优势

相比 QSS，CSS 表达力强 10 倍：

```css
/* 毛玻璃 + 微动画，5 行搞定 */
.card {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(16, 185, 129, 0.1);
}
```

### 10.4 交互规范

- **加载状态**：spinner 动画 + 文字提示
- **错误提示**：红色边框卡片 + 错误信息
- **确认操作**：危险操作二次确认（解绑/删除）
- **表单验证**：实时验证输入
- **空状态**：引导卡片"点击绑定设备"

---

## 11. 数据存储与配置方案

### 11.1 config.json 结构

```json
{
  "version": "1.0.0-dev",
  "theme": "light",
  "last_page": "home",
  "device": {
    "chipid": "00000070000001002ac5652e00000005",
    "bindnumber": "akprrlzltxpbmdog",
    "watchid": "e6e3b18f22cf488a9ab88b3d1202dad70781601a",
    "model": "Z7S",
    "imaccountid": "293468949",
    "name": "小天才",
    "bound_at": "2025-01-17T20:31:57"
  },
  "cache_ttl_hours": 24
}
```

### 11.2 存储路径（跨平台）

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%/iMooDesktop/` |
| macOS | `~/Library/Application Support/iMooDesktop/` |
| Linux | `~/.local/share/iMooDesktop/` |

使用 `QStandardPaths` 或手动判断 `sys.platform` 适配。

### 11.3 缓存目录

```
<app_data>/
├── config.json              # 主配置
├── webengine/               # QtWebEngine 缓存
├── cache/                   # 业务缓存
│   ├── friends.json
│   └── moments_page1.json
└── logs/
    └── app.log
```

---

## 12. 桥接协议设计

### 12.1 API 调用协议

**JS → Python**：
```typescript
bridge.call_api(request_id: string, payload: string)
// payload = JSON.stringify({ method: "get_info", args: {bindnumber, chipid} })
```

**Python → JS**（异步回传）：
```python
api_result.emit(request_id, result_json)   # 成功
api_error.emit(request_id, error_msg)      # 失败
```

**前端封装**：
```typescript
const pending = new Map<string, {resolve, reject}>();

bridge.api_result.connect((id, json) => {
  pending.get(id)?.resolve(JSON.parse(json));
  pending.delete(id);
});

export function callApi<T>(method: string, args = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = genId();
    pending.set(id, {resolve, reject});
    bridge.call_api(id, JSON.stringify({method, args}));
  });
}
```

### 12.2 长任务协议

**JS → Python**：
```typescript
bridge.start_task(task_id: string, name: string, payload: string)
bridge.cancel_task(task_id: string)
```

**Python → JS**：
```python
task_progress.emit(task_id, current, total, msg)
task_done.emit(task_id, success: bool, msg: string)
```

### 12.3 本地方法（不走 WatchAPI）

| 方法 | 用途 |
|------|------|
| `get_version` | 返回 Python/PySide6/应用版本 |
| `get_config` | 返回当前配置 |
| `bind_device` | 绑定设备（调 get_info 验证 + 保存） |
| `unbind_device` | 清除设备绑定 |
| `calc_adb` | ADB 算码 |
| `calc_zj` | 自检算码 |

### 12.4 WatchAPI 方法（自动注入设备四元组）

除 `get_info` 外，所有方法自动从 `ConfigStore` 注入 `watchid/bindnumber/chipid/model`。

---

## 13. 打包与发布策略

### 13.1 构建流程

```bash
# 1. 构建前端
cd frontend
bun install
bun run build                    # → frontend/dist/

# 2. 打包 Python（含前端产物）
cd ..
pyinstaller imoo.spec --noconfirm

# 3. 产出
dist/iMooDesktop/
├── iMooDesktop (或 .exe)
├── frontend/dist/
│   ├── index.html
│   └── assets/
├── config.yaml
└── ...
```

### 13.2 PyInstaller spec

```python
a = Analysis(
    ['main.py'],
    datas=[
        ('frontend/dist/', 'frontend/dist/'),
        ('config.yaml', '.'),
        ('assets/', 'assets/'),
    ],
    hiddenimports=[
        'PySide6.QtWebEngineWidgets',
        'PySide6.QtWebChannel',
    ],
)
```

### 13.3 三端打包

| 平台 | 命令 | 产物 |
|------|------|------|
| Windows | `pyinstaller imoo.spec` | `dist/iMooDesktop/iMooDesktop.exe` |
| macOS | `pyinstaller imoo.spec` + `hdiutil` | `iMooDesktop.dmg` |
| Linux | `pyinstaller imoo.spec` + `appimagetool` | `iMooDesktop.AppImage` |

### 13.4 体积估算

| 组件 | 体积 |
|------|------|
| Python 运行时 | ~15MB |
| PySide6 核心 | ~25MB |
| Qt WebEngine (Chromium) | ~35MB |
| 前端 dist | ~0.1MB |
| 业务代码 | ~0.5MB |
| **合计** | **~75MB** |

### 13.5 构建脚本 `build.sh`

```bash
#!/bin/bash
set -e
echo "=== 1. 构建前端 ==="
cd frontend && bun install && bun run build && cd ..
echo "=== 2. 检查产物 ==="
test -f frontend/dist/index.html || { echo "前端构建失败"; exit 1; }
echo "=== 3. PyInstaller 打包 ==="
pyinstaller imoo.spec --noconfirm
echo "=== 4. 验证 ==="
ls dist/iMooDesktop/iMooDesktop && ls dist/iMooDesktop/frontend/dist/index.html
echo "=== 完成 ==="
```

---

## 14. 风险评估与回滚方案

### 14.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| API 端点变更 | 中 | 高 | config.yaml 外置，用户可更新 |
| WebEngine 体积过大 | 高 | 中 | 已接受 ~85MB |
| Linux 系统库缺失 | 中 | 中 | 文档列依赖 + AppImage 包含 |
| IM socket 被防火墙阻断 | 低 | 中 | 提供代理配置 |
| PyInstaller 跨平台问题 | 中 | 中 | 三端分别构建 |

### 14.2 法律合规

⚠️ 本项目对接儿童手表官方 API，需注意：
- 首次启动显示用户协议
- 明确"仅供学习研究，禁止商用"
- 不收集用户数据，全本地存储
- 不提供云服务

### 14.3 回滚方案

- 每阶段产出独立可运行版本
- Git tag 标记里程碑
- 业务逻辑层始终与原项目对齐

---

## 15. 测试与验收标准

### 15.1 单元测试

```python
# tests/test_num_crypto.py
def test_adb_roundtrip():
    from core.num_crypto import process_adb_new
    result = process_adb_new("1234567")
    assert result.isdigit() and len(result) == 8
```

### 15.2 端到端验收

| # | 场景 | 验收标准 |
|---|------|---------|
| A1 | 首次启动 | 显示首页，未绑定状态 |
| A2 | 绑定设备 | 输入 chipid+bindnumber，显示设备信息 |
| A3 | 获取设备信息 | 点击刷新，1-5s 更新 |
| A4 | 修改步数 | 输入 50000，提交成功 |
| A5 | 发布动态 | 内容+背景，发布成功 |
| A6 | 浏览好友圈 | 加载动态列表 |
| A7 | 算码工具 | 输入数字，输出结果 |
| A8 | 批量点赞 | 进度条 + 可取消 |
| A9 | 解绑设备 | 二次确认后清除 |
| A10 | 主题切换 | 浅/深色即时切换 |
| A11 | 关闭重启 | 恢复上次状态 |
| A12 | 跨平台 | Win/Mac/Linux 通过 |

---

## 16. 里程碑时间表

### 16.1 总工期

**预估：10-13 个工作日**（Phase 0 已完成）

### 16.2 详细时间表

| 阶段 | 工作内容 | 工期 | 累计 | 状态 |
|------|---------|------|------|------|
| Phase 0 | 项目初始化 | 1.0d | 1.0d | ✅ 完成 |
| Phase 1 | 核心逻辑完善 + 全部功能页面 | 2.0d | 3.0d | ✅ 完成 |
| Phase 2 | P0 功能页面 | — | — | ✅ 已在 P1 完成 |
| Phase 3 | P1 功能页面 | — | — | ✅ 已在 P1 完成 |
| Phase 4 | UI 打磨 + 图标设计 | 1.0d | 4.0d | ⬜ 待开始 |
| Phase 5 | 打包发布（PyInstaller + 三端验证） | 1.5d | 5.5d | ⬜ 待开始 |

### 16.3 里程碑

| 里程碑 | 时间点 | 标志 |
|--------|--------|------|
| **M1: 骨架就绪** | Day 1 ✅ | Python 壳 + 前端骨架 + 桥接层全部可运行 |
| **M2: MVP 可用** | Day 3 ✅ | Phase 1 完成：8 个功能页面 + 设备绑定 + 长任务流全部通 |
| **M3: 功能完整** | Day 3 ✅ | P0 + P1 全部功能在 Phase 1 中实现 |
| **M4: 发布候选** | Day 4 ⬜ | UI 打磨 + 应用图标 |
| **M5: 正式发布** | Day 5.5 ⬜ | 三端安装包（PyInstaller） |

---

## 17. 附录

### 17.1 Phase 0 已完成产物

| 文件 | 说明 | 行数 |
|------|------|------|
| `main.py` | 应用入口 | 45 |
| `core/watch_api.py` | 24 个 API 方法 | 990 |
| `core/im_client.py` | TLV IM 协议 | 599 |
| `core/num_crypto.py` | 算码工具 | 138 |
| `storage/config_store.py` | JSON 持久化 | 110 |
| `workers/base_worker.py` | QThread 框架 | 75 |
| `bridge/app_bridge.py` | QWebChannel 桥接 | 200 |
| `shell/main_window.py` | Qt 主窗口壳 | 130 |
| `frontend/src/lib/pyapi.ts` | Python API 封装 | 180 |
| `frontend/src/App.tsx` | 主应用 | 65 |
| `frontend/src/components/Sidebar.tsx` | 侧边栏 | 55 |
| `frontend/src/components/TopBar.tsx` | 顶部栏 | 25 |
| `frontend/src/pages/HomePage.tsx` | 首页 | 60 |
| `frontend/src/pages/DeviceInfoPage.tsx` | 设备信息 | 105 |
| `frontend/src/pages/ToolsPage.tsx` | 算码工具 | 95 |
| `frontend/src/pages/SettingsPage.tsx` | 设置/绑定 | 105 |
| `frontend/src/pages/PlaceholderPage.tsx` | 占位页 | 15 |

### 17.2 开发命令速查

```bash
# 前端开发（HMR）
cd frontend && bun run dev          # → localhost:5173

# 前端构建
cd frontend && bun run build        # → frontend/dist/

# Python 开发模式
python main.py --dev                # 加载 localhost:5173

# Python 发布模式
python main.py                      # 加载 frontend/dist/

# 打包
pyinstaller imoo.spec --noconfirm
```

### 17.3 原项目 API 端点（config.yaml）

完整 API 端点清单见原项目 `config.yaml`，已复用到 `iMooDesktop/config.yaml`。

### 17.4 设备四元组

| 字段 | 含义 | 示例 |
|------|------|------|
| `watchid` | 手表账户 ID | `e6e3b18f22cf488a...` |
| `bindnumber` | 绑定号 | `akprrlzltxpbmdog` |
| `chipid` | 芯片 ID | `0000007000000100...` |
| `model` | 机型代号 | `Z7S` |

---

## 结语

本计划书基于对源项目完整代码审查编写，Phase 0 已落地验证。

**核心判断**：✅ **方案 D 完全可行且已验证**。

Phase 0 产出证明：
1. Preact + Vite + Tailwind 前端骨架可正常构建（42KB 产物）
2. Python + PySide6 + QWebChannel 桥接层代码正确
3. 原项目 24 个 API 方法 100% 复用
4. 双模式（dev HMR + release 静态）设计可行

**下一步行动**：进入 Phase 1（核心逻辑完善），逐步实现 P0 功能页面。

---

*文档版本 v2.0 · 方案 D · Phase 0 已完成*
