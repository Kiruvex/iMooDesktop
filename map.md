# iMooDesktop 完整路线图

> **文档定位**:本文是 iMooDesktop 项目的**完整开发路线图**,是 plan.md 的补充与细化。
> - **plan.md**:架构设计、技术选型、模块接口、约束规范(What & How)
> - **map.md**(本文):时间线、任务分解、版本规划、依赖关系、决策点(When & Why)
>
> **阅读顺序**:先读 plan.md 建立全局认知,再读本文了解执行节奏。
>
 **与 plan.md 的关系**:本文的 M1–M6 里程碑与 plan.md 第 11 节一致,但本文补充了**每个里程碑的子任务清单、依赖关系、风险点、决策点**。
> **文档版本**:v1.0 · 编写日期:2026-06-18

---

## 目录

- [1. 路线图总览](#1-路线图总览)
- [2. 里程碑依赖图](#2-里程碑依赖图)
- [3. M1:基础架构 + 设备检测](#3-m1基础架构--设备检测)
- [4. M2:常用功能 + 高级重启](#4-m2常用功能--高级重启)
- [5. M3:Magisk 模块管理 + 备份恢复](#5-m3magisk-模块管理--备份恢复)
- [6. M4:Root 全流程](#6-m4root-全流程)
- [7. M5:模块商店 + 收尾功能](#7-m5模块商店--收尾功能)
- [8. M6:打磨 + 打包](#8-m6打磨--打包)
- [9. 版本规划(v1.0 之后)](#9-版本规划v10-之后)
- [10. 关键决策点](#10-关键决策点)
- [11. 资源与人力估算](#11-资源与人力估算)
- [12. 发布流程](#12-发布流程)
- [13. 长期方向](#13-长期方向)
- [14. 风险监控指标](#14-风险监控指标)
- [15. 附录](#15-附录)

---

## 1. 路线图总览

### 1.1 项目阶段全景

```
            ┌─────────────────────────────────────────────────────────────┐
            │                     iMooDesktop 开发路线                       │
            └─────────────────────────────────────────────────────────────┘

 时间轴(周)  1     2     3     4     5     6     7     8
            ─┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─
             │     │     │     │     │     │     │     │
   M1        ├─────┤     │     │     │     │     │     │  基础架构+设备检测
             │     │     │     │     │     │     │     │
   M2        │     ├─────┤     │     │     │     │     │  常用功能+高级重启
             │     │     │     │     │     │     │     │
   M3        │     │     ├─────┤     │     │     │     │  Magisk+备份恢复
             │     │     │     │     │     │     │     │
   M4        │     │     │     ├───────────┤     │     │  Root 全流程(2周)
             │     │     │     │     │     │     │     │
   M5        │     │     │     │     │     ├─────┤     │  模块商店+收尾
             │     │     │     │     │     │     │     │
   M6        │     │     │     │     │     │     ├─────┤  打磨+打包
             │     │     │     │     │     │     │     │
            ─┴─────┴─────┴─────┴─────┴─────┴─────┴─────┴─
                                                    │
                                                    ▼
                                              v1.0 发布
```

### 1.2 核心目标与约束

| 维度 | 目标 |
|---|---|
| **功能等价** | 100% 覆盖原 AllToolBox 1.3.8fix1 的用户可见功能 |
| **逻辑保真** | 业务逻辑 1:1 复刻(见 plan.md 核心约束章节) |
| **体验提升** | 现代 GUI、实时日志、进度可视化、命令面板 |
| **发布形态** | Windows NSIS 安装包 + 便携版 |
| **总工期** | 约 8 周(单人全职) |

### 1.3 关键里程碑

| 里程碑 | 工期 | 完成标志 | 可交付物 |
|---|---|---|---|
| **M1** | 1 周 | Electron 壳跑通,设备检测可用 | 可运行的"半成品" |
| **M2** | 1 周 | 常用功能 + 9 种重启可用 | 内测版 α |
| **M3** | 1 周 | Magisk 模块管理 + 备份恢复可用 | 内测版 β |
| **M4** | 2 周 | Root 全流程(15 型号)可用 | 候选版 RC1 |
| **M5** | 1 周 | 模块商店 + 收尾功能完成 | 候选版 RC2 |
| **M6** | 1 周 | 打磨 + 打包完成 | **v1.0 正式版** |

---

## 2. 里程碑依赖图

### 2.1 依赖关系

```
M1 基础架构
  │
  │ 提供:SubprocessPool / Logger / DeviceService / AppShell
  │
  ▼
M2 常用功能 ──────────────┐
  │                       │
  │ 提供:RebootService    │ M3 不依赖 M2 的功能,
  │ ScrcpyService         │ 但依赖 M2 完善的 AdbService
  │ AppService(基础)     │
  │                       │
  ▼                       ▼
M3 Magisk+备份      ←── M2 的 AdbService.root()
  │
  │ 提供:MagiskService / EdlService / BackupService
  │
  ▼
M4 Root 全流程
  │
  │ 需要:BootPatcher / MagiskPatcher / RootService
  │ 依赖:M1 的 DeviceService + M2 的 RebootService + M3 的 EdlService
  │
  ▼
M5 模块商店+收尾
  │
  │ 需要:MagiskService.storeSearch / AppService.unlockZ10
  │ 依赖:M4 的 RootService(用于测试)
  │
  ▼
M6 打磨+打包
  │
  │ 需要:electron-builder / Agent Browser 验证
  │ 依赖:M1-M5 全部完成
  │
  ▼
v1.0 发布
```

### 2.2 关键依赖说明

| 依赖项 | 说明 |
|---|---|
| **M4 强依赖 M1+M2+M3** | Root 流程需要设备检测(M1)、重启(M2)、EDL 刷机(M3),三者缺一不可 |
| **M5 弱依赖 M4** | 模块商店本身不依赖 Root,但测试需要 Root 后的设备 |
| **M6 强依赖 M1-M5** | 打包前所有功能必须完成 |
| **M3 与 M2 可并行** | 如果有两人,M3 的 Magisk 模块管理和 M2 的常用功能可以并行(都依赖 M1) |
| **M4 内部串行** | BootPatcher → MagiskPatcher → RootService,必须顺序做 |

### 2.3 关键路径

**关键路径 = M1 → M2 → M3 → M4 → M6**(共 6 周)

M5 不在关键路径上(可推迟或简化),但建议在 M6 前完成以保证功能完整。

---

## 3. M1:基础架构 + 设备检测

### 3.1 目标

搭建可运行的 Electron 应用骨架,实现设备检测与基础 ADB/Fastboot 操作,为后续功能提供基础设施。

### 3.2 工期

**1 周**(5 个工作日)

### 3.3 子任务清单

#### Day 1:项目脚手架(0.5 天)

- [ ] 初始化 `iMooDesktop/` 目录
- [ ] `package.json` 配置依赖(electron / vite / react / typescript / tailwind / shadcn/ui)
- [ ] `vite.config.ts`(electron + react 双入口)
- [ ] `tsconfig.json` + `tsconfig.node.json`
- [ ] `tailwind.config.ts`(蓝色主题,见 plan.md UI 规范)
- [ ] `eslint.config.js` + `.prettierrc`
- [ ] `.gitignore`
- [ ] 验证:`bun run dev` 能启动空白 Electron 窗口

#### Day 1-2:Electron 主进程骨架(1 天)

- [ ] `electron/main.ts`:app 入口,创建 BrowserWindow
- [ ] `electron/preload.ts`:contextBridge 暴露基础 API
- [ ] `electron/core/paths.ts`:资源路径解析(dev vs prod)
- [ ] `electron/core/config.ts`:electron-store 配置持久化
- [ ] `electron/core/windows.ts`:主窗口管理
- [ ] `electron/core/single-instance.ts`:单实例锁
- [ ] `electron/ipc/index.ts`:IPC 注册入口
- [ ] `electron/ipc/system.ts`:system:* 通道(窗口/设置/日志)
- [ ] 验证:渲染进程能调 `window.api.system.getSettings()` 拿到配置

#### Day 2:SubprocessPool + Logger(1 天)

- [ ] `electron/services/SubprocessPool.ts`:统一 spawn,流式输出,超时,取消
  - 支持 GBK 解码(`iconv-lite`)
  - 行分割 stdout/stderr
  - `AbortController` 超时控制
- [ ] `electron/services/Logger.ts`:electron-log + logBus
  - 写文件 `%APPDATA%/iMooDesktop/logs/<date>.log`
  - 通过 IPC event `log:line` 推送到渲染进程
  - 按天滚动,保留 7 天
- [ ] `electron/lib/gbk.ts`:GBK 编解码封装
- [ ] 验证:调用 `subprocess.spawn('adb', ['version'])` 能在日志面板看到输出

#### Day 3:DeviceService(1 天)

- [ ] `electron/services/DeviceService.ts`:设备检测/等待/状态机
  - `current()`:当前状态(轮询,1 秒一次)
  - `waitFor(types, timeout)`:等待任一类型
  - `onChange(cb)`:监听变化
  - `detectOnce()`:内部检测逻辑
    - `adb devices` 解析(emulator/unauthorized/offline/device)
    - `fastboot devices` 解析
    - USB 扫描:VID=0x05C6 PID=0x9008 → qcom_edl
    - 9008 COM 端口:Windows 注册表 `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM`
- [ ] `electron/ipc/device.ts`:device:* 通道
- [ ] 验证:连接 ADB 设备,状态条 1 秒内显示;连接 9008 设备,显示 COM 端口

#### Day 4:AdbService + FastbootService(1 天)

- [ ] `electron/services/AdbService.ts`:adb 命令封装
  - 基础:devices / shell / getprop / install / uninstall / push / pull / reboot
  - 高级:waitForBoot / root / listPackages / amStart / inputTap / inputSwipe / setProp / pmInstallCreate / pmInstallWrite / pmInstallCommit
- [ ] `electron/services/FastbootService.ts`:fastboot 命令封装
  - devices / flash / erase / boot / reboot / getVar / oem
- [ ] `electron/ipc/app.ts`:app:* 通道(基础 install/uninstall)
- [ ] 验证:安装一个 APK 成功;`adb shell getprop ro.product.model` 返回正确值

#### Day 5:渲染进程骨架 + 资源迁移(1 天)

- [ ] `src/main.tsx`:React 入口
- [ ] `src/App.tsx`:根组件 + React Router
- [ ] `src/index.css`:Tailwind + 全局样式(蓝色主题)
- [ ] `src/components/layout/AppShell.tsx`:整体布局(顶栏/侧栏/内容/底栏)
- [ ] `src/components/layout/Sidebar.tsx`:侧边导航
- [ ] `src/components/layout/TopBar.tsx`:顶部设备状态条
- [ ] `src/components/layout/Footer.tsx`:页脚(版权/版本)
- [ ] `src/components/layout/LogConsole.tsx`:底部可折叠日志面板
- [ ] `src/routes/Home.tsx`:主菜单(读 `menus/main.json`)
- [ ] `src/routes/Device.tsx`:设备状态页
- [ ] `src/routes/Settings.tsx`:设置页
- [ ] `src/stores/deviceStore.ts`:Zustand 设备状态
- [ ] `src/stores/logStore.ts`:Zustand 日志环形缓冲(5000 条)
- [ ] `src/stores/settingsStore.ts`:Zustand 用户设置
- [ ] `src/hooks/useDevice.ts` / `useLogs.ts` / `useIpc.ts`
- [ ] 资源迁移:复制 `bin/*.exe` 到 `resources/bin/`(见 plan.md 10.1)
- [ ] 资源迁移:复制 `bin/menu/*.json` 到 `resources/menus/`
- [ ] 资源迁移:复制 `bin/EDL/*` 到 `resources/edl/`(改名 cache/work,见 plan.md 2.5.1)
- [ ] `electron/services/ResourceService.ts`:MD5 manifest 校验
- [ ] 验证:启动应用,主菜单显示,连接设备后状态条更新,日志面板有输出

### 3.4 验收标准

- [ ] `bun run dev` 启动,Electron 窗口正常显示
- [ ] 主菜单渲染 `menus/main.json`,点击可跳转(即使目标页是空壳)
- [ ] 连接 ADB 设备,顶部状态条 1 秒内显示设备信息(innermodel/model/androidVersion)
- [ ] 连接 Fastboot 设备,状态条正确显示
- [ ] 9008 模式设备,状态条显示 COM 端口
- [ ] 底部日志面板显示 adb 命令输出(GBK 中文正确)
- [ ] Ctrl+K 命令面板可用
- [ ] 设置页可调整窗口透明度
- [ ] 资源完整性校验:删除一个 .exe 后启动有警告
- [ ] `bun run lint` 通过

### 3.5 依赖

- **无前置依赖**(M1 是起点)

### 3.6 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Electron + Vite + React 配置复杂 | 中 | 中 | 参考 electron-vite 模板 |
| GBK 解码踩坑 | 高 | 低 | iconv-lite + 单元测试 |
| 9008 COM 端口检测在无设备环境难验证 | 高 | 中 | 先用 lsusb.exe fallback,真机测试时验证注册表方案 |

### 3.7 产出物

- 可运行的 Electron 应用(M1 验收标准全通过)
- 完整的目录结构(`electron/` + `src/` + `resources/`)
- 基础服务:SubprocessPool / Logger / DeviceService / AdbService / FastbootService / ResourceService
- 基础 UI:AppShell / Sidebar / TopBar / Footer / LogConsole / Home / Device / Settings
- `docs/fidelity/subprocess.md` / `device.md` / `adb.md` 对照表

---

## 4. M2:常用功能 + 高级重启

### 4.1 目标

实现原项目"常用功能"菜单(OTA/TWRP/备份/root后优化/scrcpy/充电/固件/XP/无线adb)和"高级重启"菜单(9 种模式)。

### 4.2 工期

**1 周**(5 个工作日)

### 4.3 子任务清单

#### Day 1:RebootService(1 天)

- [ ] `electron/services/RebootService.ts`:9 种重启模式
  - system / bootloader / recovery / edl(adb/fastboot/9008 三态)
  - twrp-temp(fastboot boot twrp-<innermodel>.img)
  - qmmi / ffbm / wipe-data / fastbootd(写 misc 分区)
- [ ] `electron/ipc/reboot.ts`:reboot:* 通道
- [ ] `src/routes/Reboot.tsx`:高级重启页
- [ ] 逻辑保真:对照 `rebootpro.bat` 逐行实现(见 plan.md 核心约束)
- [ ] 验证:9 种模式在 ADB 设备上可用(twrp-temp 需真机)

#### Day 2:CloudService(1 天)

- [ ] `electron/services/CloudService.ts`:4 镜像下载 + 资源版本管理
  - `list()`:从 `links.json` 列出所有资源
  - `checkUpdates()`:比对本地 vs 云端版本
  - `download(name, onProgress)`:aria2c subprocess
  - `downloadMultiple(names, onProgress)`
  - `checkAppUpdate()` / `performAppUpdate()`:electron-updater
- [ ] `electron/lib/download.ts`:aria2c 封装
- [ ] `resources/data/links.json`:从原 `link.bat` 转换
- [ ] `resources/data/resversion.json`:从原 `settings/resversion.txt` 转换
- [ ] `electron/ipc/cloud.ts`:cloud:* 通道
- [ ] `src/routes/Cloud.tsx`:资源下载页
- [ ] 验证:下载 userdata.img 成功,MD5 校验通过

#### Day 3:ScrcpyService + AppService 基础(1 天)

- [ ] `electron/services/ScrcpyService.ts`:scrcpy 子进程管理
  - `launch(opts)`:18 个参数拼接
  - `stop(pid)` / `listRunning()`
- [ ] `electron/ipc/scrcpy.ts`:scrcpy:* 通道
- [ ] `src/routes/Tools.tsx`:其他工具页(含 scrcpy 启动器)
- [ ] AppService 基础(install/uninstall/listPackages)
- [ ] `src/routes/Apps.tsx`:应用管理页(基础版,M5 增强)
- [ ] 验证:scrcpy 投屏可启动/停止;APK 安装/卸载可用

#### Day 4:常用功能散件(1 天)

- [ ] `electron/services/AdbService.ts` 高级方法:root / amStart / inputTap / inputSwipe / setProp / cmdPackageCompile
- [ ] OtaService(对应 `ota.bat`):push zip + am start + scrcpy 引导
- [ ] OpenChargeService(对应 `opencharge.bat`):setprop persist.sys.charge.usable true
- [ ] WifiAdbService(对应 `wifiadb.bat`):4 种连接方式
- [ ] ListBuildService(对应 `listbuild.bat`):读 build.txt 的 89 个 prop
- [ ] `src/components/device/DeviceCard.tsx`:设备信息卡(显示 innermodel 对照)
- [ ] `src/components/common/FilePicker.tsx`:替代 filedialog.exe
- [ ] `src/components/common/DisclaimerModal.tsx`:启动免责声明
- [ ] `src/components/common/CommandPalette.tsx`:Ctrl+K 命令面板
- [ ] 验证:读设备信息显示全部 prop;无线 adb 连接可用

#### Day 5:MenuRenderer + 收尾(1 天)

- [ ] `src/components/menu/MenuRenderer.tsx`:通用 JSON 菜单渲染器
  - 读 `resources/menus/*.json`
  - 支持单选/多选(对应原 menu.exe -s)
  - 支持搜索(对应原 menu.exe 的搜索,原 bug 已修)
  - 蓝色主题 + lucide 图标
- [ ] `src/components/menu/MenuOption.tsx`:单个菜单项
- [ ] `src/hooks/useMenu.ts`:加载菜单 JSON
- [ ] `src/lib/models.ts`:内部型号表(从 `innermodel.bat` 转换为 `models.json`)
- [ ] `src/components/device/ConnectGuide.tsx`:连接引导(带 lucide 图标,无 emoji)
- [ ] 逻辑保真:对照 `main.bat` / `commonly.json` / `rebootpro.json` 等
- [ ] 验证:所有菜单渲染正确,点击触发对应功能

### 4.4 验收标准

- [ ] 高级重启 9 种模式在 ADB/Fastboot 设备上可用
- [ ] scrcpy 投屏可启动,18 个参数可调
- [ ] 应用安装:单/多/文件夹三种选择方式
- [ ] 应用卸载:列表选择,批量卸载
- [ ] 资源下载:4 镜像自适应,进度显示,MD5 校验
- [ ] 资源版本:本地 vs 云端对比,有更新提示
- [ ] 型号对照表:可搜索,显示 Z/D/Q/N/U/Y 全系列
- [ ] 命令面板 Ctrl+K 可用,支持拼音搜索
- [ ] 启动免责声明显示,用户必须确认才能用
- [ ] `bun run lint` 通过

### 4.5 依赖

- **强依赖 M1**(SubprocessPool / DeviceService / AdbService / AppShell)

### 4.6 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| scrcpy 参数多,UI 复杂 | 中 | 低 | 用 shadcn Checkbox + Command 组件 |
| aria2c 进度解析 | 中 | 中 | 解析 stdout 的百分比行 |
| 无线 adb 配对(Android 11+)流程复杂 | 中 | 中 | 先实现基础连接,配对作为高级功能 |

### 4.7 产出物

- 内测版 α(功能:设备检测 + 常用功能 + 高级重启 + 资源下载)
- 服务:RebootService / CloudService / ScrcpyService / AppService(基础) / OtaService / OpenChargeService / WifiAdbService / ListBuildService
- UI:Reboot / Cloud / Apps / Tools 路由 + MenuRenderer / CommandPalette / DisclaimerModal / FilePicker / ConnectGuide
- `docs/fidelity/rebootpro.md` / `cloud.md` / `scrcpy.md` / `app.md` 对照表

---

## 5. M3:Magisk 模块管理 + 备份恢复

### 5.1 目标

实现原项目"Magisk 模块管理"菜单和"备份与恢复"菜单,包括 9008 EDL 刷机流程。

### 5.2 工期

**1 周**(5 个工作日)

### 5.3 子任务清单

#### Day 1:EdlService(1 天)

- [ ] `electron/services/EdlService.ts`:9008 刷机封装
  - `loadFirehose(opts)`:QSaharaServer.exe
  - `flashPartitions(opts)`:fh_loader.exe(失败=死循环重试,见 plan.md 6.5)
  - `readPartitions(opts)`:fh_loader.exe --convertprogram2read
  - `reboot(opts)`:fh_loader.exe --sendxml=reboot.xml(失败=跳过,见 plan.md 6.5)
  - `findPort()`:node-usb + 注册表
  - `parseAllXml(xmlPath)`:解析分区表
- [ ] `electron/lib/xml.ts`:fast-xml-parser 封装
- [ ] `electron/ipc/edl.ts`:edl:* 通道
- [ ] 逻辑保真:对照 `edlport.bat` / `QSaharaServer.bat` / `fh_loader.bat` / `qfh_loader.bat` / `P_fh_loader.bat`
- [ ] 验证:9008 设备能加载 firehose,能读 boot 分区(真机或 mock)

#### Day 2:MagiskService(1 天)

- [ ] `electron/services/MagiskService.ts`:模块管理
  - `list()`:push list_modules.sh → su -c sh → 解析输出
  - `install(zip, method)`:3 种方式(magisk/shinst/peremptory)
  - `uninstall(id, method)`:3 种方式(mark/direct/script)
  - `enable(id)` / `disable(id)`
  - `getDefaultMethod()` / `setDefaultMethod()`
- [ ] `electron/ipc/magisk.ts`:magisk:* 通道
- [ ] `src/routes/Magisk.tsx`:Magisk 模块管理页
- [ ] `src/components/magisk/ModuleList.tsx` / `ModuleCard.tsx`
- [ ] 设备端 .sh 改名:见 plan.md 2.5.2(magiskperinster.sh → magisk_force_install.sh 等)
- [ ] 逻辑保真:对照 `userinstmodule.bat` / `instmodule.bat` / `userunmodule.bat` / `unmodule.bat` / `magisklist.bat` / `setmagisk.bat`
- [ ] 验证:列出已安装模块;安装一个模块成功;卸载一个模块成功

#### Day 3:BackupService - DCIM + ADB-dd(1 天)

- [ ] `electron/services/BackupService.ts`:备份恢复
  - `backup({type:'dcim'})`:adb pull /storage/emulated/0/DCIM
  - `recover({type:'dcim'})`:adb push DCIM
  - `backup({type:'adb-dd'})`:su -c ls /dev/block/bootdevice/by-name/ → 逐分区 dd → md5sum → 7z 打包
  - `recover({type:'adb-dd'})`:设备分区表过滤 → 用户确认 → dd of=...
- [ ] `electron/ipc/backup.ts`:backup:* 通道
- [ ] `src/routes/Backup.tsx`:备份恢复页
- [ ] 逻辑保真:对照 `backup.bat` 的 DCIM 和 adb-dd 分支
- [ ] 验证:DCIM 备份/恢复成功(真机);adb-dd 备份需 root 设备

#### Day 4:BackupService - EDL-9008(1 天)

- [ ] `backup({type:'edl-9008'})`:edl + 读 allxml → 7z 打包
- [ ] `recover({type:'edl-9008'})`:选 zip → 7z 解压 → 读 v3.txt 选 mbn → fh_loader 刷 rawprogram0.xml
- [ ] `flashFirmware(folder)`:对应 `super_recovery.bat`,自动检测 loader,逐个刷 rawprogram0/1/2.xml
- [ ] `flashTwrp(innermodel)`:对应 `pashtwrp.bat`,EDL 模式刷 recovery
- [ ] `autoFlashTwrp(innermodel)`:对应 `pashtwrppro.bat`,push recovery.img + su -c cp + /data/adb/service.d/rec.sh
- [ ] 逻辑保真:对照 `backup.bat` 的 9008 分支 + `super_recovery.bat` + `pashtwrp.bat` + `pashtwrppro.bat`
- [ ] 验证:9008 备份 9 个型号各能完整备份(产出 zip);TWRP 刷入可用

#### Day 5:Xposed + 收尾(1 天)

- [ ] XposedService(对应 `Xposed.bat`):SDK19/SDK25 两个分支
  - SDK19:instapp xpinstaller19.apk + instmodule 19xposed.zip shinst
  - SDK25:instapp toolkit.apk + xposed-magisk.apk + instmodule xposed-magisk-1.zip + 重启 + 等 7-15 分钟 + instmodule xposed-magisk-2.zip
- [ ] innermodel 对照表数据化:`resources/data/models.json`(从 `innermodel.bat` 转换,补充 soc/platform/firehose 字段)
- [ ] isv3 阈值数据化:`resources/data/isv3-thresholds.json`(从 `isv3.bat` 转换)
- [ ] `src/components/device/InnermodelTable.tsx`:可搜索的型号对照表
- [ ] 逻辑保真:对照 `Xposed.bat` / `innermodel.bat` / `isv3.bat`
- [ ] 验证:Xposed 框架安装(SDK19/25);型号表搜索可用

### 5.4 验收标准

- [ ] Magisk 模块列表:显示 id/name/version/author/status/description
- [ ] 模块安装:3 种方式(magisk/shinst/peremptory)都可用
- [ ] 模块卸载:3 种方式(mark/direct/script)都可用
- [ ] 模块启用/禁用
- [ ] DCIM 备份/恢复:进度显示
- [ ] 9008 备份:9 个型号各能完整备份(产出 zip 含 rawprogram0.xml + 所有 .img)
- [ ] 9008 恢复:从 zip 完整恢复
- [ ] ADB-dd 备份/恢复(需 root 设备)
- [ ] TWRP 刷入:EDL 模式 + 开机自刷两种方式
- [ ] 超级恢复:选固件目录,自动检测 loader,逐个刷 rawprogram
- [ ] Xposed:SDK19/SDK25 两个分支
- [ ] `bun run lint` 通过

### 5.5 依赖

- **强依赖 M1**(DeviceService / AdbService)
- **强依赖 M2**(AdbService.root() 高级方法)

### 5.6 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| EDL 刷机无真机难验证 | 高 | 高 | 用 mock + 单元测试,真机回归留到 M4 |
| 9008 COM 端口检测在 Linux 不可用 | 中 | 低 | Windows 专属功能,Linux 用 lsusb fallback |
| Magisk 模块列表解析格式复杂 | 中 | 中 | 对照 `magisklistmod.sh` 输出格式 |

### 5.7 产出物

- 内测版 β(功能:α + Magisk 模块管理 + 备份恢复 + EDL 刷机)
- 服务:EdlService / MagiskService / BackupService / XposedService
- UI:Magisk / Backup 路由 + ModuleList / ModuleCard / InnermodelTable
- 数据:models.json / isv3-thresholds.json / links.json
- `docs/fidelity/edl.md` / `magisk.md` / `backup.md` / `xposed.md` 对照表

---

## 6. M4:Root 全流程

### 6.1 目标

实现原项目的核心功能:一键 Root,支持全部 15 个型号(Z2-Z11),包括 SDK19/25/27 三个分支和 ND03(Z10)独立流程。

### 6.2 工期

**2 周**(10 个工作日)—— 最关键、最复杂的里程碑

### 6.3 子任务清单

#### Week 1:Boot 修补基础

##### Day 1:BootPatcher(1 天)

- [ ] `electron/services/BootPatcher.ts`:patch_boot.exe 重写
  - 4 条正则替换(顺序敏感,见 plan.md 6.6)
  - 输出 `success`(已修复原 Sucess 拼写错误,见 plan.md 2.4)
  - 检查方式 `includes('success')`
- [ ] `docs/fidelity/patch_boot.md`:逐字节对照表
- [ ] 单元测试:用真实 boot.img 的 kernel 文件 fixture
- [ ] 验证:4 条正则替换后字节正确

##### Day 2-3:MagiskPatcher(2 天)

- [ ] `electron/services/MagiskPatcher.ts`:magiskpatch.bat 重写
  - 21 vs 25 分支判断
  - magiskboot unpack / cpio / dtb / hexpatch / repack 全流程
  - Stock boot vs Magisk patched boot 检测
  - recovery_dtbo 自动启用 RECOVERYMODE
  - hexpatch 3 处 patch(from/to 字节序列)
  - LEGACYSAR=true 仅 25200 分支
- [ ] `docs/fidelity/magiskpatch.md`:逐行对照表(250 行)
- [ ] 单元测试:用 SDK25/SDK27 的 boot.img fixture
- [ ] 验证:unpack→patch→repack 后的 SHA1 与原版一致

##### Day 4-5:RootService 状态机骨架(2 天)

- [ ] `electron/services/RootService.ts`:状态机
  - 60+ 个 RootStage 枚举(见 plan.md 6.7)
  - `start(options)`:启动流程,返回 taskId
  - `pause(taskId)` / `resume(taskId)` / `cancel(taskId)` / `skipStage(taskId)`
  - `onStageChange(taskId, cb)`:状态订阅
  - 内部 `run(ctx)` 状态机驱动
  - `nextStage(ctx)`:转移规则集中管理
- [ ] `electron/ipc/root.ts`:root:* 通道
- [ ] `src/routes/Root.tsx`:Root 向导页
- [ ] `src/components/root/RootWizard.tsx`:分步骤 UI
- [ ] `src/components/root/ModelPicker.tsx`:型号选择(可搜索)
- [ ] `src/components/root/DisclaimerStep.tsx`:免责声明步骤
- [ ] 验证:状态机能跑通 mock 流程

#### Week 2:Root 流程实现

##### Day 6-7:SDK19 + SDK25(2 天)

- [ ] RootService 的 SDK19 分支:
  - backup DCIM → fastboot flash boot sboot.img → instapp manager.apk → push magiskfile → **instmodule.bat**(已修复 instmodule2.bat bug,见 plan.md 2.4)→ backup DCIM recover
- [ ] RootService 的 SDK25 分支:
  - 选 BOOT/Recovery 方案 → EDL + msm8909w.mbn → 读 boot → magiskpatch 21 → 替换 adbd=711_adbd → patch_boot → repack
  - BOOT 方案:刷 boot → 二次 EDL 刷 recovery+misc
  - Recovery 方案:刷 recovery+misc
  - boot_completed → instapp manager → push xtcpatch+magiskfile → sh setup_magisk_env.sh(改名,见 plan.md 2.5.2)→ instmodule xtcpatch shinst → instapp appstore/MoyeInstaller
- [ ] `docs/fidelity/root-sdk19.md` / `root-sdk25.md`:逐行对照
- [ ] 验证:Z2(Z3)Root 成功(SDK19);Z5A Root 成功(SDK25 BOOT 方案)

##### Day 8-9:SDK27(2 天)—— 最复杂

- [ ] RootService 的 SDK27 分支:
  - EDL + msm8937.mbn → 读 boot → magiskpatch 25 → 替换 adbd=810_adbd + add xse.rc + magisk32.xz → patch_boot → repack
  - smodel=1(Z7A/I25C)分支:刷 recovery + rawprogram0
  - 普通分支:刷 rawprogram0 + 擦 boot(eboot.img 33MB 全零)
  - fastboot flash boot + userdata + misc(ffbm-02 进 qmmi)
  - boot_completed → smodel=1 装 54850.apk important
  - automagisk(11 步 input tap,坐标逐字一致)
  - autosystemplus(激活 SystemPlus + 核心破解)
  - instmodule xtcpatch magisk + isv3 装 systemui
  - 装预装 APK(130510/121750/116100,根据 isv3+innermodel)
  - 擦 misc + reboot
  - 装预装 APK 列表(8 个)+ cmd package compile
  - backup DCIM recover
- [ ] `docs/fidelity/root-sdk27.md`:逐行对照(最复杂)
- [ ] 验证:Z7(I25)Root 成功;Z7A(I25C,smodel=1)Root 成功

##### Day 10:ND03(Z10)(1 天)

- [ ] RootService 的 ND03 分支:
  - cloud z10 → 7z 解压 → EDL + prog_firehose_ddr.elf
  - 刷 281 恢复固件 → root 固件 → 擦 boot → qfh_loader reboot(实际用 fh_loader,见 plan.md 核心约束)
  - fastboot flash boot + boot recovery
  - adb sideload Dm.zip
  - fastboot flash misc(ffbm-02) + reboot
  - 等 3 次重启(循环检测 bin.mt.plus)
  - automagisk(11 步点击)
  - instmodule xtcpatch magisk
  - instapp toolkit_4.8 + Z10_SystemPlus
  - LSPosed 激活(7 步点击)
  - 装预装 APK
  - cmd package compile
- [ ] `docs/fidelity/nd03root.md`:逐行对照
- [ ] 验证:Z10 Root 成功

### 6.4 验收标准(关键)

- [ ] **逻辑保真度审查(强制)**:每个 Root stage 都有 `docs/fidelity/root.md` 逐行对照表
- [ ] **原 Bug 已修复**:`instmodule2.bat` 改为 `instmodule.bat`、彩蛋文案保留
- [ ] **字符串核对**:adb/fastboot/fh_loader/QSaharaServer/magiskboot 参数逐字一致
- [ ] **SDK19(Z2/Z3 老固件)**:fastboot flash boot 流程成功
- [ ] **SDK25 BOOT 方案**:完整流程成功
- [ ] **SDK25 Recovery 方案**:完整流程成功
- [ ] **SDK27 普通分支**(Z6巅峰/Z7/Z7S/Z8/Z8A/Z9):完整流程成功
- [ ] **SDK27 smodel=1 分支**(Z7A/I25C):刷 recovery+rawprogram 路径正确
- [ ] **ND03(Z10)**:281 恢复 + root 固件 + Dm.zip sideload + 3 次重启 + LSPosed 激活
- [ ] **不刷 userdata 选项**:流程在 rawprogram 刷入后正确退出
- [ ] **V3 协议检测**:7 个型号的阈值正确(与 isv3.bat 完全一致)
- [ ] **暂停/取消**:任意 stage 可暂停,取消后 DCIM 恢复
- [ ] **失败恢复**:模拟 patch_boot 失败,UI 显示错误 + 重试
- [ ] `bun run lint` 通过

### 6.5 依赖

- **强依赖 M1**(DeviceService / AdbService / FastbootService)
- **强依赖 M2**(RebootService —— Root 流程中多次调用重启)
- **强依赖 M3**(EdlService —— SDK25/27/ND03 都需要 EDL 刷机)

### 6.6 风险(最高)

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 无真机无法验证 Root 流程 | 高 | 高 | 代码逐行对照 + 单元测试 + 真机回归 checklist(见 plan.md 14.4) |
| SDK27 流程极复杂(40+ 步骤) | 高 | 高 | 状态机设计,每个 stage 独立测试 |
| automagisk 坐标点击可能不兼容 | 中 | 高 | 保留原坐标,失败时 scrcpy 手动 fallback |
| magiskboot 命令参数细节多 | 中 | 高 | 逐行对照 magiskpatch.bat |
| 9008 EDL 流程在无设备环境难调 | 高 | 高 | 用 mock + 真机回归 |

### 6.7 产出物

- 候选版 RC1(功能:β + 完整 Root 流程)
- 服务:BootPatcher / MagiskPatcher / RootService
- UI:Root 路由 + RootWizard / ModelPicker / 各步骤组件
- `docs/fidelity/patch_boot.md` / `magiskpatch.md` / `root.md` / `root-sdk19.md` / `root-sdk25.md` / `root-sdk27.md` / `nd03root.md` / `automagisk.md` / `autosystemplus.md` 对照表

---

## 7. M5:模块商店 + 收尾功能

### 7.1 目标

完成剩余功能,按 plan.md 2.4 节修复已知 bug,业务逻辑严格保留原行为。

### 7.2 工期

**1 周**(5 个工作日)

### 7.3 子任务清单

#### Day 1:模块商店(1 天)

- [ ] `MagiskService.storeSearch(query)` / `installFromStore(module)`:对接 Magisk 官方模块仓库 API(已修复 modapi.exe bug,见 plan.md 2.4)
- [ ] `src/components/magisk/ModuleStore.tsx`:模块商店 UI
- [ ] 搜索 + 分页 + 安装
- [ ] 验证:搜索 "systemplus" 返回结果

#### Day 2:Z10 限制解除 + QQ/微信自启(1 天)

- [ ] `AppService.unlockZ10Install()`:对应 `z10openinst.bat`
  - 检查 QMMI → push switch.db → adb root → setprop → cp switch.db → setprop ctl.restart zygote → 安装 z10apk.Apk + z10apk1.Apk(APK 文件名保留原样,见 plan.md 2.5.4)
- [ ] `AppService.enableAutoStart(packages)`:对应 `qqwxautestart.bat`
  - content call --uri content://com.xtc.launcher.self.start --method METHOD_SELF_START --extra EXTRA_ENABLE:b:true
  - 对 com.tencent.qqlite / qqwatch / wechatkids
- [ ] `src/routes/Apps.tsx` 增强:Z10 解除限制按钮 + 开机自启管理
- [ ] 验证:Z10 解除限制后可安装应用;QQ/微信开机自启启用

#### Day 3:离线 OTA + rootpro(1 天)

- [ ] OtaService 增强(对应 `ota.bat` 完整流程):
  - 检查 QMMI → 选 OTA zip → adb root → rm -rf /data/ota* → push /sdcard/xtc/ota_f_vota.zip → am start OfflineOtaActivity → scrcpy 引导
- [ ] RootProService(对应 `rootpro.bat`):SDK27 专属 root 后优化
  - 下载 rootproapks → 安装拓展应用 → 可选装禁用模式切换桌面 → 可选刷拓展 magisk 模块
- [ ] RootService 末尾询问是否进行 rootpro 优化
- [ ] 验证:OTA 升级流程可用(M5 不做真机测试)

#### Day 4:驱动 + .atbmod + 自更新(1 天)

- [ ] `electron/services/DriverService.ts`:对应 `checkdriver.bat`
  - `check()`:检测 ADB/Qualcomm 9008/VC 运行库
  - `installDrivers()`:解压 drivers.zip → pnputil /add-driver
- [ ] `electron/services/AtbmodService.ts`:对应 `Loadatbmod.bat`
  - `scan()` / `load(file)` / `install(file)` / `listInstalled()` / `uninstall(modid)`
- [ ] `electron/services/UpdateService.ts`:electron-updater 自更新
  - `checkAppUpdate()` / `performAppUpdate()`
- [ ] `src/routes/Settings.tsx` 增强:驱动检测 + 自更新检查
- [ ] 验证:驱动检测显示状态;.atbmod 模块可安装

#### Day 5:收尾 + bug 修复验证(1 天)

- [ ] 验证 plan.md 2.4 节所有 bug 已修复:
  - [ ] instmodule2.bat → instmodule.bat
  - [ ] modapi.exe → Magisk 官方 API
  - [ ] search → 命令面板
  - [ ] Sucess → success
  - [ ] misc_ND07.xml UTF_8 → UTF-8
  - [ ] backup_9008.json 补 Z2/Z3
- [ ] 验证 plan.md 2.5 节所有改名已应用:
  - [ ] tmp → cache / rooting → work
  - [ ] 5 个 .sh 改名
  - [ ] edlPort 单变量
- [ ] 验证 plan.md 2.6 节 .bat 全废弃:无 `call xxx.bat` 残留
- [ ] 验证 UI 规范:蓝色主题 / 无 emoji / lucide 图标
- [ ] 全功能 smoke test

### 7.4 验收标准

- [ ] 模块商店:搜索 + 安装可用(对接 Magisk 官方 API)
- [ ] Z10 限制解除:push switch.db + setprop + 软重启 + 安装 z10apk
- [ ] QQ/微信开机自启:3 个包都能启用
- [ ] 超级恢复:选固件目录,自动检测 loader,逐个刷 rawprogram
- [ ] 离线 OTA:push zip + 启动 Activity + scrcpy 引导
- [ ] Xposed:SDK19/SDK25 两个分支
- [ ] 驱动检测/安装:ADB/9008/VC 三类驱动
- [ ] .atbmod 模块:扫描 + 安装 + 卸载
- [ ] 自更新:检查 + 下载 + 重启
- [ ] plan.md 2.4 节所有 bug 已修复
- [ ] plan.md 2.5 节所有改名已应用
- [ ] `bun run lint` 通过

### 7.5 依赖

- **强依赖 M1-M4**(所有基础服务 + Root 流程)
- **弱依赖 M4 的真机测试**(模块商店可用 mock 测试)

### 7.6 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Magisk 官方 API 不稳定或不可用 | 中 | 中 | fallback 到本地 zip 安装 |
| Z10 限制解除流程复杂 | 中 | 高 | 逐行对照 z10openinst.bat |
| electron-updater 配置复杂 | 低 | 低 | 参考 electron-builder 文档 |

### 7.7 产出物

- 候选版 RC2(功能:RC1 + 模块商店 + 收尾功能)
- 服务:MagiskService.storeSearch / AppService.unlockZ10 / AppService.enableAutoStart / OtaService(完整) / RootProService / DriverService / AtbmodService / UpdateService
- UI:ModuleStore + Apps 增强 + Settings 增强
- `docs/fidelity/modulestore.md` / `z10openinst.md` / `qqwxautestart.md` / `ota.md` / `rootpro.md` / `checkdriver.md` / `loadatbmod.md` 对照表

---

## 8. M6:打磨 + 打包

### 8.1 目标

生产可用的 v1.0 正式版。

### 8.2 工期

**1 周**(5 个工作日)

### 8.3 子任务清单

#### Day 1:UI 打磨(1 天)

- [ ] 动画/过渡:页面切换、菜单展开、对话框淡入
- [ ] 空状态:无设备 / 无模块 / 无日志时的友好提示
- [ ] 错误状态:统一的错误展示组件
- [ ] 加载状态:skeleton / spinner
- [ ] 蓝色主题一致性检查(所有交互元素)
- [ ] 无 emoji 检查(全文 grep)
- [ ] lucide 图标一致性检查

#### Day 2:性能优化(1 天)

- [ ] 日志缓冲优化:环形缓冲 5000 条,虚拟化渲染
- [ ] 大列表虚拟化:模块列表 1000+ / 应用列表 / 型号表
- [ ] IPC 通信优化:批量请求 / 节流
- [ ] 资源加载优化:懒加载路由

#### Day 3:i18n 预留 + 主题(1 天)

- [ ] i18n 框架接入(react-i18next),先只做中文,预留英文
- [ ] 主题切换:亮/暗/跟随系统(next-themes 或自定义)
- [ ] 设置页:主题切换 / 语言切换(英文 disabled)

#### Day 4:打包配置(1 天)

- [ ] `electron-builder.yml`:NSIS + portable
- [ ] `build/icon.ico`:Windows 图标(从原项目 icon.png 转换)
- [ ] `build/icon.png`:应用图标
- [ ] asar 打包:`asarUnpack` 配置(resources/bin/ 必须解包)
- [ ] 签名配置(若有证书)
- [ ] 自动更新配置:electron-updater + 4 镜像站
- [ ] 验证:`bun run build` 生成安装包

#### Day 5:Agent Browser 自验证 + 文档(1 天)

- [ ] Agent Browser 自验证:所有路由可访问,无白屏
- [ ] Agent Browser 自验证:核心交互(设备检测 / 菜单点击 / 日志显示)
- [ ] Agent Browser 自验证:响应式(移动端/桌面端)
- [ ] Agent Browser 自验证:sticky footer
- [ ] 用户文档:README.md + 内置帮助页
- [ ] 发布 checklist(见第 12 节)

### 8.4 验收标准

- [ ] **逻辑保真度审查全部通过**:每个 Service 的 `docs/fidelity/<service>.md` 已完成逐行对照
- [ ] **已知行为保留/修复**:2.4 节所有项已处理
- [ ] Agent Browser 自验证:所有路由可访问,无白屏
- [ ] 亮/暗主题切换
- [ ] 大日志(10 万行)不卡顿
- [ ] 模块列表(1000+)虚拟化滚动
- [ ] NSIS 安装包:静默安装/卸载可用
- [ ] 便携版:解压即用
- [ ] 用户文档:README + 内置帮助
- [ ] `bun run lint` 通过
- [ ] `bun run build` 通过

### 8.5 依赖

- **强依赖 M1-M5**(全部功能完成)

### 8.6 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 打包后 .exe 路径变化导致 subprocess 找不到 | 中 | 高 | asarUnpack + 路径解析测试 |
| 安装包体积过大(>150MB) | 中 | 低 | 压缩资源 / 按需下载 |
| Agent Browser 发现的 UI bug 多 | 中 | 低 | 预留 1 天修复缓冲 |

### 8.7 产出物

- **v1.0 正式版**
- Windows NSIS 安装包(`iMooDesktop-Setup-1.0.0.exe`)
- 便携版(`iMooDesktop-1.0.0-portable.exe`)
- 用户文档(README + 内置帮助)
- 完整的 `docs/fidelity/` 对照表集

---

## 9. 版本规划(v1.0 之后)

### 9.1 版本号策略

采用语义化版本:`MAJOR.MINOR.PATCH`

- **MAJOR**:不兼容的 API/功能变更(如重构架构)
- **MINOR**:向后兼容的新功能
- **PATCH**:bug 修复

### 9.2 v1.0.x(发布后 1-2 周)

**目标**:紧急 bug 修复 + 真机回归反馈处理

- [ ] 收集真机回归测试反馈(见 plan.md 14.4)
- [ ] 修复 M4 阶段无法验证的 Root 流程 bug
- [ ] 修复 Agent Browser 未覆盖的边界情况
- [ ] 补充缺失的型号支持(若有)

### 9.3 v1.1(发布后 1 个月)

**目标**:体验增强

- [ ] 国际化(英文)
- [ ] 主题切换增强(自定义主题色,但仍以蓝色为主)
- [ ] 命令面板增强(历史记录 / 书签 / 自定义命令)
- [ ] 日志查看器增强(过滤 / 搜索 / 导出)
- [ ] 设备信息卡增强(实时刷新 prop)

### 9.4 v1.2(发布后 2 个月)

**目标**:跨平台探索

- [ ] macOS 支持(仅 ADB/Fastboot,EDL 不可用)
  - 替换 adb.exe / fastboot.exe 为跨平台版本
  - 9008 检测在 macOS 用 system_profiler
  - UI 适配 macOS(菜单栏 / 快捷键)
- [ ] 模块商店后端自建(Magisk 模块镜像)
  - 缓存 Magisk 官方 API 响应
  - 支持社区提交模块

### 9.5 v1.3(发布后 3 个月)

**目标**:功能扩展

- [ ] 插件系统预研(让社区贡献功能,无需改主程序)
  - 设计插件 API(基于 IPC)
  - 沙箱化插件执行
- [ ] 批量操作(多设备同时 Root / 刷机)
- [ ] 脚本录制(记录用户操作,生成可重放脚本)

### 9.6 v2.0(发布后 6 个月)

**目标**:架构升级

- [ ] 插件系统正式版
- [ ] 设备端配套 app(显示状态 / 一键操作)
  - 需要在手表上安装一个辅助 APK
  - 通过 ADB 与桌面端通信
- [ ] 云端账号(可选,同步设置 / 资源)
  - 用户自愿注册
  - 同步:设置 / 资源版本 / 自定义命令(不含设备数据)

### 9.7 长期方向(1 年+)

#### 方向 A:迁移到 Tauri 2.0

**动机**:体积优化(80MB → 15MB)

**前提**:
- Rust 学习成本可接受
- Tauri 2.0 生态成熟
- sidecar 机制验证可行

**风险**:Rust 重写所有 Service,工期约 2-3 个月

#### 方向 B:迁移到开源 EDL

**动机**:跨平台 EDL 支持(macOS/Linux)

**方案**:用 `bkerler/edl`(Python)替代 QSaharaServer + fh_loader

**风险**:
- 兼容性不如官方工具
- 需要重新验证所有型号的 EDL 流程
- Python 运行时依赖

#### 方向 C:保持 Electron + 持续优化

**动机**:稳定,无重写风险

**方案**:
- 持续优化体积(按需下载资源)
- 性能优化(Worker 线程)
- UI 持续打磨

**推荐**:**方向 C 为主,方向 A 作为长期目标**。

---

## 10. 关键决策点

### 10.1 M1 决策:Electron 模板选择

**选项**:
- A. electron-vite(推荐,社区主流)
- B. electron-forge
- C. 手动配置

**决策**:M1 Day 1 确认,优先 A。

### 10.2 M2 决策:scrcpy 嵌入方式

**选项**:
- A. 独立窗口(scrcpy.exe 自带窗口,简单)
- B. 嵌入 Electron 窗口(复杂,需 --no-window + 自绘)

**决策**:M2 用 A,M5 或 v1.1 再考虑 B。

### 10.3 M3 决策:9008 COM 端口检测方案

**选项**:
- A. node-usb + Windows 注册表(推荐,无外部依赖)
- B. 保留 lsusb.exe(原项目方案)
- C. wmic 命令

**决策**:M3 用 A,lsusb.exe 作为 fallback。

### 10.4 M4 决策:automagisk 坐标点击 vs uiautomator2

**选项**:
- A. 保留原坐标点击(业务逻辑,不能改)
- B. 改用 uiautomator2(更稳定,但违反核心约束)

**决策**:**A,必须保留原坐标**(见 plan.md 核心约束)。失败时 scrcpy 手动 fallback。

### 10.5 M5 决策:模块商店后端

**选项**:
- A. 对接 Magisk 官方 API(推荐,零运维)
- B. 自建镜像站(可控,但需运维)
- C. 保留"不可用"状态(最简,但功能缺失)

**决策**:M5 用 A,若 API 不可用 fallback 到 C。v1.2 再考虑 B。

### 10.6 M6 决策:是否签名

**选项**:
- A. 自签名(免费,但 SmartScreen 警告)
- B. 购买代码签名证书(约 $200/年,无警告)
- C. 不签名(用户手动信任)

**决策**:v1.0 用 C,若用户量增长再考虑 B。

### 10.7 v2.0 决策:是否做云端账号

**选项**:
- A. 做(同步设置,提升体验)
- B. 不做(保持本地,隐私优先)

**决策**:**倾向 B**,工具类应用无需账号体系。若用户强烈需求再做。

---

## 11. 资源与人力估算

### 11.1 人力估算(单人全职)

| 里程碑 | 工期 | 复杂度 | 备注 |
|---|---|---|---|
| M1 | 1 周 | 中 | 脚手架 + 基础服务 |
| M2 | 1 周 | 中 | 功能散件多 |
| M3 | 1 周 | 高 | EDL 刷机复杂 |
| M4 | 2 周 | 极高 | Root 流程,最关键 |
| M5 | 1 周 | 中 | 收尾 + bug 修复 |
| M6 | 1 周 | 低 | 打磨 + 打包 |
| **合计** | **7 周** | | 含 1 周缓冲 = 8 周 |

### 11.2 双人并行估算

若两人并行,M3 和 M2 可同时做,总工期可压缩到 **6 周**:

```
M1(1周,两人共同搭脚手架)
  │
  ├─ M2(1周,人A:常用功能+重启)
  └─ M3(1周,人B:Magisk+备份,依赖 M1 的 AdbService)
       │
       ▼
M4(2周,两人共同:人A 做 SDK19/25,人B 做 SDK27/ND03)
  │
  ▼
M5(1周,人A:模块商店+收尾)
M6(1周,人B:打磨+打包)
```

### 11.3 外部资源依赖

| 资源 | 用途 | 获取方式 |
|---|---|---|
| 原 AllToolBox 1.3.8fix1 项目 | 逻辑参照 | 已有(`/tmp/alltoolbox/`) |
| 真机(Z7 推荐) | M4 回归测试 | 需用户提供 |
| Windows 开发环境 | 全程开发 | 需用户本地具备 |
| 代码签名证书(可选) | M6 签名 | 需购买 |
| 4 镜像站发布权限 | v1.0 发布 | 需联系原作者或自建 |

---

## 12. 发布流程

### 12.1 发布前 checklist

- [ ] 所有里程碑验收标准通过(M1-M6)
- [ ] `bun run lint` 通过
- [ ] `bun run build` 通过
- [ ] Agent Browser 自验证通过
- [ ] 真机回归测试通过(至少 Z7 + Z10)
- [ ] `docs/fidelity/` 所有对照表完成
- [ ] plan.md 2.4 节所有 bug 已修复
- [ ] plan.md 2.5 节所有改名已应用
- [ ] plan.md 2.6 节 .bat 全废弃验证
- [ ] UI 规范:蓝色主题 / 无 emoji / lucide 图标
- [ ] README.md 完成
- [ ] 内置帮助页完成
- [ ] 免责声明显示且强制确认

### 12.2 版本号

- v1.0.0:首个正式版
- v1.0.1+:bug 修复
- v1.1.0+:新功能

### 12.3 发布渠道

| 渠道 | 用途 | 优先级 |
|---|---|---|
| GitHub Releases | 主渠道 | 高 |
| 4 镜像站 | 与原 AllToolBox 一致 | 中(需联系原作者) |
| 应用内检查更新 | electron-updater | 高 |

### 12.4 发布后监控

- [ ] GitHub Issues 收集 bug
- [ ] 应用内错误上报(可选,需用户同意)
- [ ] 真机回归反馈收集(型号 / 流程 / 结果)
- [ ] 定期检查 Magisk 官方 API 可用性

### 12.5 紧急回滚

若 v1.0 发布后发现严重 bug(如导致设备变砖):

1. 立即在 GitHub Releases 标记为 "Pre-release" / "Broken"
2. 发布紧急修复版本 v1.0.1
3. 应用内推送紧急更新通知
4. 在 README 和公告中说明问题

---

## 13. 长期方向

### 13.1 技术债务监控

| 债务 | 严重度 | 缓解计划 |
|---|---|---|
| EDL 工具闭源,无法跨平台 | 中 | 长期方向 B(开源 EDL) |
| Electron 体积大 | 低 | 长期方向 A(Tauri) |
| Root 流程无自动化测试 | 高 | v1.1 考虑真机 CI(若有条件) |
| 模块商店依赖第三方 API | 中 | v1.2 自建镜像 |

### 13.2 社区建设

- [ ] GitHub Discussions 开放
- [ ] 贡献指南(CONTRIBUTING.md)
- [ ] 插件开发文档(v1.3 插件系统后)
- [ ] 多语言贡献(i18n)

### 13.3 与原项目关系

- **保留原作者声明**:plan.md 17.1 节
- **不抢原项目用户**:iMooDesktop 定位为"现代化重构",非替代品
- **兼容原项目资源**:菜单 JSON / EDL XML / 资源下载链接完全兼容
- **反馈上游**:发现的 bug 同时通知原作者

---

## 14. 风险监控指标

### 14.1 进度风险指标

| 指标 | 阈值 | 行动 |
|---|---|---|
| 里程碑延期 > 2 天 | 黄色 | 评估是否砍功能 / 加人 |
| 里程碑延期 > 1 周 | 红色 | 暂停,重新规划 |
| 关键路径阻塞 > 3 天 | 黄色 | 优先解决阻塞 |
| bug 数 > 50(M6 时) | 黄色 | 延迟发布 |

### 14.2 质量风险指标

| 指标 | 阈值 | 行动 |
|---|---|---|
| 逻辑保真度审查未通过项 > 5 | 红色 | 立即修复 |
| 真机回归失败率 > 10% | 红色 | 延迟发布 |
| Agent Browser 发现 P0 bug > 0 | 红色 | 立即修复 |
| lint 错误 > 0 | 红色 | 立即修复 |

### 14.3 外部依赖风险指标

| 指标 | 阈值 | 行动 |
|---|---|---|
| Magisk 官方 API 不可用 | 黄色 | fallback 到本地 zip 安装 |
| 4 镜像站全不可用 | 红色 | 紧急联系原作者 / 自建镜像 |
| Qualcomm EDL 工具被下架 | 红色 | 紧急寻找替代 / 备份现有版本 |

---

## 15. 附录

### 15.1 与 plan.md 的对应关系

| map.md 章节 | plan.md 章节 | 关系 |
|---|---|---|
| 1. 路线图总览 | 11. 开发阶段划分 | map.md 细化 |
| 2. 里程碑依赖图 | 11.1-11.6 | map.md 新增依赖分析 |
| 3-8. M1-M6 | 11.1-11.6 + 12.1-12.6 | map.md 细化子任务 |
| 9. 版本规划 | 16. 后续路线图 | map.md 扩展 |
| 10. 关键决策点 | (散落各处) | map.md 集中 |
| 11. 资源估算 | (无) | map.md 新增 |
| 12. 发布流程 | 15. 打包与发布 | map.md 细化 |
| 13. 长期方向 | 16. 后续路线图 | map.md 扩展 |
| 14. 风险监控 | 13. 风险登记 | map.md 新增监控指标 |

### 15.2 术语表

| 术语 | 含义 |
|---|---|
| M1-M6 | 6 个开发里程碑(Milestone) |
| RC | Release Candidate,候选版 |
| α / β | 内测版(Alpha / Beta) |
| 关键路径 | 决定项目最短工期的任务序列 |
| 逻辑保真度 | 见 plan.md 核心约束章节 |
| 状态机 | Root 流程的 stage 管理,见 plan.md 6.7 |

### 15.3 相关文档

- **plan.md**:架构设计、技术选型、模块接口、约束规范
- **worklog.md**:开发日志(各 agent 协作记录)
- **docs/fidelity/**:逻辑保真度对照表(每个 Service 一个)
- **README.md**(M6 产出):用户文档
- **CONTRIBUTING.md**(v1.1 产出):贡献指南

### 15.4 文档版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-06-18 | 初始版本,包含 M1-M6 详细子任务、版本规划、决策点、资源估算、发布流程 |

---

**文档结束**。

下一步:等待用户确认本路线图,确认后进入 M1 阶段实施。
