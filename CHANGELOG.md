# 更新日志

## v1.1.1（2026-06-21）

### Bug 修复

- **安装器弹"重试/取消"警告框**：升级安装时旧版 iMooDesktop 进程占用 `iMooDesktop.exe`，NSIS 写入失败弹出"文件被占用，重试/取消"对话框。新增 `build/installer.nsh` 自定义 NSIS 脚本，在 `customInit`（`.onInit` 阶段，文件解压前）用 `taskkill /F` 强制关闭运行中的实例，避免文件占用
- **安装器图标格式不规范**：`win.icon` 原为 PNG 格式，NSIS 原生需要 ICO。PNG→ICO 转换在某些 electron-builder 版本下会失败或生成不规范文件，导致 NSIS 编译告警。新生成 7 尺寸（16/24/32/48/64/128/256）`resources/assets/icon.ico`，`win.icon` 改用 `.ico`
- **NSIS 差异包**：关闭 `differentialPackage`，避免旧版本 patch 文件导致升级安装异常
- **卸载确认框**：启用 `disableDefaultUninstallPrompt`，卸载时不再弹默认确认框

### 其他

- 新增 `build/installer.nsh`（NSIS 自定义脚本）
- 新增 `resources/assets/icon.ico`（7 尺寸 Windows 图标）

---

## v1.1.0（2026-06-21）

### 新增功能

- **EDL 分区管理**：基于 edl-ng v1.5.0 实时读取设备 GPT 分区表，支持单分区备份/恢复/擦除/校验，关键分区擦除需输入名称确认，恢复前自动备份原分区，恢复后可选读回校验
- **APK 解析与预览**：安装 APK 前弹窗显示包名、版本、权限列表、应用图标、CPU 架构、签名信息，确认后再安装
- **全局 Toast 通知**：新增 toastStore + Toaster 组件，任意页面可调用 `toast.ok()/err()/info()`，自动 3-5 秒消失
- **设备信息增强**：首页设备状态从 8 项扩展到 18 项，新增型号名、CPU 架构、屏幕密度、电量百分比（彩色徽章）、存储可用容量、Build ID、构建时间，自动填充 V3 协议和平台信息

### 重构优化

- **构建工具切换**：从 vite-plugin-electron 迁移到 electron-vite，原生支持 native addon 打包，彻底解决 usb 包构建崩溃问题
- **设备检测改为事件驱动**：使用 node-usb 监听 USB 插拔事件，设备连接响应从 2 秒降至 800ms，无设备时进程开销降低 80%，10 秒兜底轮询捕获状态切换
- **窗口状态事件化**：删除 500ms 轮询，改用 Electron 原生 maximize/unmaximize 事件
- **scrcpy 进程事件推送**：删除 2 秒轮询，改用进程 exit 事件实时推送，修复 stop/exit 双重 emit
- **文件管理/EDL 分区页面轮询清除**：改用 `api.device.onChange` 订阅
- **IPC 代码重构**：新增 `wrap` 高阶函数，消除 60 个重复 try-catch 和 requireAdb 函数
- **超时常量集中**：新增 `timeouts.ts`，160+ 处硬编码超时替换为 `TIMEOUT.device/shell/flash/install/backup` 等语义常量
- **CSS 语义化**：新增 24 个语义类（`.card` `.section-title` `.btn-primary` `.alert-ok` 等），替换 122 处重复的 zinc 配色
- **AdbService 安装方法补全**：实现 data/3install/create 三种安装方式（原为空壳 fallback 到 installDirect）

### Bug 修复

- **打包后白屏**：修复 preload 路径不匹配（electron-vite 输出子目录结构）、CSP 阻止 file:// 脚本加载、BrowserRouter 在 file:// 下不工作（改用 HashRouter）、renderer base 路径缺失
- **usb 包构建崩溃**：Rollup commonjs 插件扫描 usb native addon 的 .node 二进制导致崩溃，迁移到 electron-vite 后原生支持
- **Root 流程内存泄漏**：任务完成后 tasks Map 和 EventEmitter 监听器不清理，新增 `scheduleCleanup` 30 分钟后自动清理
- **edlWork 临时文件堆积**：root 完成后 edlWork 目录（boot.img 33MB 等）不清理，现在随 scheduleCleanup 自动清理
- **SDK25 方案无条件显示**：改为仅在 SDK=25 或 9008 模式（未知 SDK）时显示
- **Root 免责声明多余文案**：删除"Root 后请在 48 小时内恢复官方系统"
- **innermodel 路径遍历**：RootService 从设备 getprop 读取的 innermodel 未清洗，恶意设备可伪造路径遍历，现已清洗只允许字母数字下划线
- **MagiskService 命令注入**：moduleId 直接拼接到 shell 命令，新增 `escapeModuleId()` 转义
- **AdbService 命令注入**：installData/install3rd/installCreate/setProp/cmdPackageCompile 的参数未转义，已全部加引号/清洗
- **ApkParser buffer 越界**：ZIP 解析无边界检查，恶意 APK 可导致 RangeError，已加边界校验
- **ScrcpyService 双重 emit**：stop() 和 proc.on('exit') 同时触发 process-change 事件，已修复
- **React key 使用数组 index**：8 处 `key={i}` 改为唯一值
- **Home.tsx window.alert**：改为 toast 通知

### 安全

- innermodel 路径遍历防护（`replace(/[^a-zA-Z0-9_]/g, '')`）
- MagiskService moduleId 命令注入防护（`escapeModuleId()`）
- AdbService shell 命令参数转义（installData/install3rd/installCreate/setProp/cmdPackageCompile）
- ApkParser ZIP 解析 buffer 边界检查

### 其他

- 删除死代码 `Placeholder.tsx`（未被引用的占位页）
- 删除未实现的 `ResourceService.repair()` 占位方法
- 清理所有 M1-M7 阶段标识（代码注释 30+ 处 + UI 徽章 7 个）
- SubprocessPool 顶部注释说明实际职责
- `window.alert` 全部替换为 toast
- 未处理的 Promise `.then()` 补 `.catch()`
- GitHub Actions 升级 setup-bun@v2 + Node 22
- 新增 `usb@3.0.0` 依赖（USB 事件驱动）
- 新增 edl-ng 二进制（resources/bin/edl-ng/，7MB）

---

## v1.0.0（初始版本）

- 完整 Root 流程：SDK 19 / SDK 25 / SDK 27 / ND03 四条线，60+ 个 stage
- 文件管理器：多设备、搜索、排序、书签、剪贴板、拖拽上传、文本编辑、chmod
- Magisk 模块管理：安装/卸载/启用/禁用/模块商店
- 9008 备份恢复：全盘备份打包、ADB-dd 分区级备份、超级恢复、TWRP 刷入
- 应用管理：安装/卸载、Z10 解除安装限制、QQ/微信开机自启
- 其他工具：scrcpy 投屏、充电可用、无线 ADB、OTA 升级、驱动检测、.atbmod 模块
- 高级重启：9 种重启模式（系统/Bootloader/Recovery/9008/TWRP/QMMI/FFBM/wipe/fastbootd）
- 资源下载：4 镜像自适应下载、完整性校验
- 自定义窗口：无边框圆角、自定义标题栏、窗口透明度
- 实时日志面板、EULA 许可协议
