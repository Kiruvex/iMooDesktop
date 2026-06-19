# iMooDesktop — 项目实施计划书

> **代号**:iMooDesktop
> **目标**:将 `AllToolBox 1.3.8fix1`(Windows 批处理 + 自研 .exe 工具包)迁移为现代化桌面应用
> **技术栈**:Electron + Vite + React + TypeScript + Tailwind CSS + shadcn/ui
> **作者声明**:本工具仅供学习交流,严禁用于商业用途与手表强制解绑(拾取他人手表请归还失主或联系 110)
> **文档版本**:v1.7 · 编写日期:2026-06-18

---

## 核心约束:逻辑保真度(最高优先级)

> **本节优先级高于文档其他所有章节。若其他章节与本节冲突,以本节为准。**
> **任何偏离本约束的实现都视为 P0 级 bug,必须回滚重做。**

### 约束声明(精确边界)

iMooDesktop 的**业务逻辑**(Root 流程、刷机步骤、命令参数、状态机分支)必须与原 AllToolBox 1.3.8fix1 项目 **1:1 等价**,严禁任何形式的"自由发挥""优化""改进""重构逻辑"。

**但"技术实现细节"允许优化**,只要业务行为等价。

这是一条**不可妥协**的硬约束,原因:

1. 原项目涉及真机刷机与 Root,**任何业务逻辑偏差都可能导致设备变砖或 Root 失败**
2. 原作者已通过真机验证过整套流程,我们**无权也无法重新验证**,只能照搬
3. "看起来可以优化"的业务逻辑,往往隐藏着我们不了解的边界条件
4. 用户已明确指示:"逻辑一点不能错,严禁瞎写或者自由发挥,那些逻辑必须与原项目的逻辑完全一致,一步都不能错"
5. 用户已澄清:"严禁瞎改的是 Root 步骤这种的业务逻辑,不是技术实现细节"

### 绝对不能改的(业务逻辑)

以下属于**业务逻辑**,任何改动都视为 P0 bug:

| 类别 | 说明 | 例子 |
|---|---|---|
| **Root 流程步骤** | SDK19/25/27 的执行顺序、分支条件、stage 边界 | smodel=1 分支、nouserdata 退出点、ND03 的 281→root→Dm.zip 三步 |
| **刷机命令参数** | adb/fastboot/fh_loader/QSaharaServer/magiskboot 的参数顺序、参数值 | `--sendxml=boot.xml --convertprogram2read` 的等号不能省、`adb install -r -t -d` 不能合并成 `-rtd` |
| **分区表/XML** | EDL XML 文件原样保留 | `EDL/allxml/*.xml`、`EDL/misc/*.xml`、`reboot.xml` |
| **状态机分支** | 型号路由、SDK 路由、isv3 阈值 | Z7→I25→SDK27、isv3 的 7 个阈值 |
| **执行顺序** | 步骤先后不能调换 | 先 backup DCIM → 再 root → 再 restore |
| **文件路径** | 设备端 push/pull 的目标路径 | `/data/adb/modules/`、`/sdcard/xtc/ota_f_vota.zip` |
| **自动操作坐标** | input tap/swipe 的坐标值 | `input tap 304 26`(automagisk)、11 步点击序列 |
| **关键提示文案** | 用户可见的提示、错误信息、免责声明 | 包括彩蛋文案("你是怎么运行到这里的?"等) |
| **重试策略** | 重试次数、间隔 | `instapp.bat important` 重试 6 次每次 30 秒 |
| **镜像选择策略** | aria2c 的 4 镜像 adaptive 选择 | `--uri-selector=adaptive` |
| **misc 扩展名差异** | MSM8909W 用 `misc.mbn`,MSM8937 用 `misc.img` | 必须保留 |

### 可以优化/合并/重写的(技术实现细节)

以下属于**实现细节**,允许改动,只要业务行为等价:

| 类别 | 允许的改动 | 必须保持等价的部分 |
|---|---|---|
| **临时文件传值** | `menutmp.txt`/`smodel.txt`/`isv3.txt`/`tmp.txt`/`nouserdata.txt`/`innermodel.txt` → 内存变量 | 变量的值和写入时机与原 `.bat` 一致 |
| **.bat 包装层** | `goto run` 死循环 → TS `while(true)` / 递归 | 重试语义一致(何时重试、何时跳过) |
| **GBK 编码** | 内部用 UTF-8 | 与 .exe 交互时仍用 GBK 编解码 |
| **进度显示** | 无 → 进度条 | 进度计算依据一致(如 7z 的 `bsp1` 输出百分比解析) |
| **日志输出位置** | stdout → IPC 推送到渲染进程 | 日志内容、顺序、级别与原 `.bat` 的 echo 一致 |
| **pause.exe** | → UI 确认对话框 | 确认时机和提示文案一致 |
| **color.bat** | ANSI 转义 → Tailwind 类 | 颜色语义一致(ERROR=红、INFO=蓝、WARN=黄、SUCCESS=绿) |
| **自研 .exe** | menu/device_check/timer/progress/filedialog/atblogo/run_cmd/ground_glass → TS 重写 | 行为等价(详见各 Service 对照表) |
| **工具 .exe 合并** | 多个等价协议的工具合并为一个(如 fh_loader/qfh_loader 合并为 fh_loader) | 协议等价 + 业务语义保留 |
| **文件操作** | `del`/`md`/`copy`/`move`/`rd` → fs API | 行为等价(删不存在的文件仍 no-op,不报错) |
| **菜单渲染** | menu.exe → React 组件 | 菜单覆盖的功能与原项目一致(不漏功能),但选项文案/字段/分组/样式可自由调整(2026-06-18 重新定位:菜单 JSON 不再打包,选项写死在代码里) |
| **错误日志分类** | 可保留也可简化 | 能追溯即可 |
| **命名/拼写规范** | 修正原项目的误导性目录名、拼写错误、冗余变量名 | 行为等价,详见 2.5 节清单 |

### 已知 Bug 的处理(用户已批准修复)

原项目中有若干"bug",用户已明确指示**顺手修掉**。以下 bug 在迁移时修复,不保留原行为:

| 原行为 | 位置 | 修复方案 |
|---|---|---|
| `instmodule2.bat` 不存在,调用会失败 | ROOT-SDK19.bat:232 | 改为调用 `instmodule.bat`(等价语义,文件实际存在) |
| `modapi.exe` 不存在,模块商店不可用 | modulestore.bat | 模块商店对接 Magisk 官方模块仓库 API,或保留"不可用"状态待 M5 决定 |
| `search` 不存在,按 s 键无效 | main.bat:15 | 实现命令面板(Ctrl+K),可绑定 s 键作为快捷键 |
| `patch_boot.exe` 输出 `Sucess`(拼写错误) | patch_boot.exe | BootPatcher 重写后输出 `success`,检查方式改为 `includes('success')` |
| `misc_ND07.xml` encoding=`UTF_8` | EDL/misc/misc_ND07.xml | 修正为 `UTF-8` |
| `backup_9008.json` 缺 Z2/Z3 | menu/backup_9008.json | 补充 I12/IB 的 9008 备份支持(其 misc xml 已存在) |
| 彩蛋逻辑(SDK=11 / Z11) | root.bat:196-202 / nd08root.bat | **保留彩蛋文案**(这是作者意图,非 bug),不删 |

> 注:彩蛋文案虽然列在这里,但实际是"作者意图"而非 bug,所以保留。其他 bug 按上表修复。

### fh_loader / qfh_loader 合并(用户已批准)

用户已明确指示:**只保留 fh_loader.exe,qfh_loader.exe 不打包**。EdlService 的 reboot 方法改用 fh_loader.exe 调用 `reboot.xml`。

**但错误处理语义保留分离**(用户已批准保留):

| 操作 | 原 .exe | 新 .exe | 失败处理语义(保留) |
|---|---|---|---|
| 读写分区(flash/read) | fh_loader.exe | fh_loader.exe | **死循环重试**(对应原 fh_loader.bat 的 goto run),日志写 `logs/FHerror_<nutime>.txt` |
| 9008 重启(reboot) | qfh_loader.exe | **fh_loader.exe** | **跳过 + 提示手动按电源键 10 秒**(对应原 qfh_loader.bat),日志写 `logs/qfherror_<nutime>.txt`,返回成功 |
| 带进度读写 | fh_loader.exe(经 P_fh_loader.bat) | fh_loader.exe | 失败时写 `fh_error.txt` 标识 + 返回非0退出码(配合 progress 等价物) |

详见 6.5 节 EdlService 设计。

### 具体要求

1. **逐行对照实现**:每个 Service 方法的实现,必须能在原 `.bat` / `.exe` 调用中找到对应的代码行。实现时在代码注释中标注原文件名 + 行号,例如:
   ```typescript
   // root.bat:134 — for /f "delims=" %%i in ('adb shell getprop ro.product.innermodel') do set innermodel=%%i
   const innermodel = await adb.getprop('ro.product.innermodel');
   // root.bat:135 — echo %INFO%您的设备innermodel为:%innermodel%
   logger.info(`您的设备innermodel为:${innermodel}`);
   ```

2. **参数与字符串完全一致**:adb / fastboot / fh_loader / QSaharaServer 等命令的**参数顺序、参数值、环境变量、文件名、扩展名**,必须与原 `.bat` 完全一致,**包括拼写错误、多余的空格、大小写**。例如:
   - 原 `fh_loader.exe --sendxml=boot.xml --convertprogram2read` 不得改成 `--sendxml boot.xml`(等号不能省)
   - 原 `adb install -r -t -d` 不得改成 `adb install -rtd`(参数顺序不能合并)
   - 原 `misc.mbn` vs `misc.img` 的扩展名差异必须保留(MSM8909W 用 `.mbn`,MSM8937 用 `.img`)

3. **执行顺序不可调换**:原 `.bat` 中的命令执行顺序(包括看似无关的 `del` / `md` / `set` / `copy` 语句)必须在 TS 中有等价操作。即使某条 `del` 删除的是不存在的文件,也要保留这个操作(行为是 no-op,但不能省)。

4. **错误处理路径不可简化**:原 `.bat` 中的 `if errorlevel` / `goto` / `exit /b` / `||` / `&&` 分支,必须完整复刻。不能因为"看起来不可能发生"就省略某个分支。

5. **已知 Bug 修复(用户已批准)**:原项目中的已知 bug(见上方"已知 Bug 的处理"表)**不再保留原行为**,按表中所列方案修复。其他未列出的疑似 bug,记录到 `docs/fidelity/questions.md`,待用户确认后决定。

6. **业务逻辑禁止"更聪明"**:即使发现原**业务逻辑**有更优写法,也不得采用。典型禁区:
   - ç¦æ­¢: 原 `automagisk.bat` 用固定坐标 `input tap 304 26` → 不得改用 `uiautomator2`(业务逻辑)
   - ç¦æ­¢: 原 `root.bat` 中"彩蛋"文案 → 必须保留(作者意图)
   - ç¦æ­¢: 原 `cloud.bat` 的 4 镜像选择策略(`--uri-selector=adaptive`)→ 不得改用"更智能"的负载均衡(业务逻辑)
   - ç¦æ­¢: 原 `instapp.bat important` 重试 6 次每次 30 秒 → 不得改成"指数退避"(业务逻辑)
   - ç¦æ­¢: 原 Root 流程的 stage 顺序 → 不得合并/重排(业务逻辑)
   - ç¦æ­¢: 原 `isv3.bat` 的阈值表 → 不得"补全"或"修正"(业务逻辑)
   - åè®¸: 原 `edlport.bat` 用 `lsusb` 字符串解析 → **可以**改用 `node-usb` 的更优雅实现(实现细节,只要 COM 端口检测结果一致)
   - åè®¸: 原 fh_loader/qfh_loader 两个 .exe → **可以**合并为 fh_loader(实现细节,只要协议等价 + 错误处理语义保留)

7. **UI 层可现代化,业务层不可改动**:
   - åè®¸: 允许:菜单渲染从字符界面 → React 组件、日志从 stdout → 流式面板、进度从无 → 进度条、文件选择从 filedialog.exe → Electron dialog
   - ç¦æ­¢: 禁止:合并/删除菜单项、改变菜单选项的 value 映射、调整 Root 流程步骤、修改资源下载的镜像选择策略、修改任何命令的参数

8. **业务数据文件零改造**:`EDL/allxml/*.xml`、`EDL/misc/*.xml`、`build.txt`、`innermodel.bat` 内的对照表、`isv3.bat` 内的阈值表、`link.bat` 内的 URL 映射,原样搬运,**不得"标准化"字段名或结构**。若需要结构化数据(如 `models.json`),必须保证转换后能 1:1 还原原文件内容。
   - **菜单 JSON 不在此约束内**(2026-06-18 调整):原 `menu/*.json` 降级为"参考文档",菜单选项写死在 `src/lib/menus.ts`,可自由加 icon/description/分组/合并/删除。UI 层不影响手表,不属于业务逻辑。

### 逻辑保真度审查流程(每个 Service 强制执行)

每个 Service 实现时,必须执行以下流程,否则不算完成:

1. **建立对照表**:在 `docs/fidelity/<ServiceName>.md` 中,列出原 `.bat` 的每一行 → 新 TS 代码的对应行。格式:
   ```markdown
   | 原文件:行号 | 原代码 | 新代码:文件:行号 | 备注 |
   |---|---|---|---|
   | root.bat:134 | `for /f "delims=" %%i in ('adb shell getprop ro.product.innermodel') do set innermodel=%%i` | RootService.ts:287 `const innermodel = await adb.getprop('ro.product.innermodel')` | 等价 |
   ```

2. **逐行 review**:实现完成后,逐行对照,确认无遗漏。审查清单:
   - [ ] 每条 `adb` / `fastboot` / `fh_loader` / `QSaharaServer` / `magiskboot` / `7z` / `aria2c` / `busybox` 命令都已复刻(qfh_loader 已合并到 fh_loader,见上方约束)
   - [ ] 每个 `if` / `for` / `goto` / `call` 分支都已复刻
   - [ ] 每个 `set` 变量都有对应的 TS 变量,且**变量名语义一致**
   - [ ] 每个 `del` / `md` / `copy` / `move` / `rd` 文件操作都已复刻(或确认在 TS 中行为等价)
   - [ ] 每个错误码检查(`%errorlevel%` / `||` / `&&`)都已复刻
   - [ ] 每个 `pause.exe` 都有对应的 UI 确认点,**提示文案一致**
   - [ ] 每个 `timeout` / `sleep` / `busybox sleep` 都已复刻,**时长一致**
   - [ ] 原文的字符串(包括中文提示、参数值、文件名)**逐字一致**(GBK 解码后的 UTF-8)
   - [ ] 已知 Bug 已按上方"已知 Bug 的处理"表修复(不再保留原 bug 行为)

3. **保留原文注释**:在 TS 代码中,用注释保留原 `.bat` 的关键行号和原始字符串,方便后续对照。

4. **禁止"顺手优化"**:即使发现原代码可以更简洁,也不得改动。若确有必要的改动(如原 `.bat` 的临时文件 `menutmp.txt` 在 TS 中改为内存变量),必须在代码注释中标注:
   ```typescript
   // 原逻辑:menu.exe .\menu\main.json → 写 menutmp.txt → set /p MENU=<menutmp.txt
   // TS 改动:menu JSON 直接由 React 渲染,选中结果直接 return,不写文件
   // 行为等价性:menutmp.txt 仅用于 .bat 进程间传值,TS 单进程内无需文件,选中值与原 value 字段一致
   ```

### UI 规范(用户强制要求)

以下三条是用户明确指示的 UI 层硬约束,优先级与业务逻辑约束等同,违反即视为 P0 bug:

1. **主题色用蓝色**:所有交互元素的主色用 Tailwind 蓝色系。原项目 `color.bat` 的语义色保留(错误=红、警告=黄、成功=绿、信息=蓝),但**主交互色调统一为蓝色**。具体:
   - 主按钮:`bg-blue-600 hover:bg-blue-700 text-white`
   - 次按钮:`bg-blue-50 text-blue-700 border-blue-200`
   - 选中态:`bg-blue-50 border-blue-500`
   - 焦点框:`focus:ring-blue-500`
   - 进度条:`bg-blue-600`
   - 链接:`text-blue-600 hover:text-blue-700`
   - 活跃菜单项:`bg-blue-50 text-blue-700`
   - 严禁使用 indigo(与全局规则一致)

2. **严禁使用 emoji**:整个项目(代码、注释、文档、UI 文案、日志输出)严禁出现任何 emoji 字符。状态标记用纯文本或 SVG 图标:
   - 警告 → "警告" 或 lucide `AlertTriangle`
   - 禁止 → "禁止" 或 lucide `Ban`
   - 允许 → "允许" 或 lucide `CheckCircle2`
   - 进行中 → "进行中" 或 lucide `Loader2`(带旋转动画)
   - 完成 → "完成" 或 lucide `Check`
   - 失败 → "失败" 或 lucide `X`
   - 设置 → lucide `Settings`
   - 设备状态:adb → `Smartphone`,fastboot → `Zap`,9008 → `Cpu`
   - 原 `.bat` 输出若含 emoji,迁移时去除(本计划文档已清理)

3. **图标用 SVG 图库**:所有图标统一用 `lucide-react`(SVG 图标库,已在技术栈中)。不使用:
   - emoji 字符(见上条)
   - 位图图标(.png/.ico,**应用图标 icon.png/icon.ico 除外**)
   - 字体图标(FontAwesome / Iconfont 等)
   - 自绘 SVG(除非 lucide 没有合适的,需在代码注释说明原因)
   - 图标尺寸统一用 Tailwind 类(`h-4 w-4` / `h-5 w-5` / `h-6 w-6`),不用 emoji 占位

### 违反约束的后果

- 代码审查不通过
- 已合并的代码必须回滚
- 重新实现
- 若导致真机变砖,责任由实现者承担

### 疑问处理流程

实现过程中,若遇到原 `.bat` 逻辑不清晰或疑似有错的地方:
1. **不得自行判断**
2. 记录到 `docs/fidelity/questions.md`,格式:`[文件名:行号] 疑问描述:... 我的理解:... 待用户确认`
3. 暂时按"字面意思"实现
4. 集中向用户确认后,再决定是否调整

---

## 0. 文档导航

- [核心约束:逻辑保真度(最高优先级)](#核心约束逻辑保真度最高优先级)
- [1. 项目概述](#1-项目概述)
- [2. 原项目逆向分析摘要](#2-原项目逆向分析摘要)
- [3. 技术栈选型与理由](#3-技术栈选型与理由)
- [4. 目标系统架构](#4-目标系统架构)
- [5. 项目目录结构](#5-项目目录结构)
- [6. 核心模块设计](#6-核心模块设计)
- [7. 数据模型与类型定义](#7-数据模型与类型定义)
- [8. IPC 通道设计](#8-ipc-通道设计)
- [9. 前端架构与状态管理](#9-前端架构与状态管理)
- [10. 资产迁移映射表](#10-资产迁移映射表)
- [11. 开发阶段划分(M1–M6)](#11-开发阶段划分m1m6)
- [12. 各阶段验收标准](#12-各阶段验收标准)
- [13. 风险登记与缓解策略](#13-风险登记与缓解策略)
- [14. 测试与验证策略](#14-测试与验证策略)
- [15. 打包与发布](#15-打包与发布)
- [16. 后续路线图](#16-后续路线图)
- [17. 附录](#17-附录)

---

## 1. 项目概述

### 1.1 背景

`AllToolBox` 是面向 **XTC(小天才)电话手表全系列**(Z1–Z11、D/Q/N/U/Y 系列)的 Windows 桌面工具,由原作者 xgj_236 以批处理(.bat)+ 自研 Rust/.NET/Python .exe 实现。功能覆盖 Root、刷机(EDL 9008)、应用/模块管理、备份恢复、投屏等。

**痛点**:
- 批处理脚本维护困难,GBK 编码 + `goto`/`call` 状态机难以追踪
- 字符菜单交互落后,无实时日志/进度反馈
- 临时文件(`menutmp.txt`/`smodel.txt`/`isv3.txt`...)满天飞,状态隐式
- 自研 .exe 闭源,出 bug 无法定位
- 单 Windows 平台、单 GBK 编码,扩展性差

### 1.2 目标

构建一个 **iMooDesktop** 桌面应用,满足:

| 维度 | 目标 |
|---|---|
| **功能等价** | 100% 覆盖原 AllToolBox 1.3.8fix1 的用户可见功能 |
| **体验提升** | 现代 Web UI、实时日志流、进度可视化、命令面板、可搜索型号表 |
| **可维护性** | TypeScript 类型贯穿、模块化服务层、状态机显式化 |
| **可扩展性** | 加新功能不改主菜单结构,插件化 |
| **安全** | 不引入任何"强制解绑"相关能力,免责声明前置 |
| **平台** | 仍以 Windows 为主(EDL 工具闭源),架构层预留跨平台 |

### 1.3 非目标(Out of Scope)

- ç¦æ­¢: 不支持手表强制解绑(明确禁止)
- ç¦æ­¢: 不重写 Qualcomm 官方 EDL 工具(QSaharaServer/fh_loader 保留调用)
- ç¦æ­¢: 不重写 Magisk 官方工具(magiskboot 保留调用)
- ç¦æ­¢: 不做云端账号体系(沿用原 4 镜像站下载)
- ç¦æ­¢: 不做 macOS/Linux 真机支持(EDL 驱动仅 Windows)

### 1.4 命名由来

`iMoo` —— 取自"小天才/imoO"谐音,体现工具定位;`Desktop` —— 桌面应用形态。

---

## 2. 原项目逆向分析摘要

> 完整分析见 worklog.md(research-1)。此处仅摘要与本计划相关的内容。

### 2.1 原项目规模

| 指标 | 数值 |
|---|---|
| 文件总数 | 246 |
| 解压后大小 | 121 MB |
| 批处理脚本(.bat/.sh) | 约 90 个 |
| 菜单 JSON(参考用) | 33 个(原项目 bin/menu/) |
| 自研 .exe | 11 个(AllToolBox/menu/device_check/timer/progress/pause/ground_glass/filedialog/atblogo/run_cmd/patch_boot) |
| 第三方 .exe | 12+(adb/fastboot/QSaharaServer/fh_loader/qfh_loader/magiskboot/7z/aria2c/busybox/scrcpy/lsusb/device_check) |
| EDL 资源 | 9 allxml + 14 misc xml + 4 misc img + 3 firehose loader + 1 eboot.img |
| 支持型号 | Z1–Z11、D1–D5、Q1A–Q3、N3–N5、U3–U5、Y01–Y8(共 60+ 型号) |

### 2.2 Root 流程核心分支

```
root.bat
├── ADB 模式入口
│   ├── innermodel=ND03 → nd03root.bat(Z10 独立流程)
│   ├── SDK=19 → ROOT-SDK19.bat(Z2/Z3 老固件,fastboot 直刷)
│   ├── SDK=25 → ROOT-SDK25.bat(Android 7.1,EDL + magiskpatch 21)
│   └── SDK=27 → ROOT-SDK27.bat(Android 8.1,EDL + magiskpatch 25,最复杂)
└── EDL(9008)模式入口
    ├── 老机型(Z2/Z3/Z5A/Z5Q/Z5Pro/Z6)→ rebootpro wipe otherpash → 切回 ADB
    ├── 新机型(Z6巅峰/Z7/Z7A/Z7S/Z8/Z8A/Z9)→ rebootpro qmmi v3pash → 切回 ADB
    └── Z10 → nd03root.bat / Z11 → nd08root.bat(彩蛋)
```

### 2.3 关键技术决策(已验证可行)

1. **EDL 工具链保留**:QSaharaServer.exe + fh_loader.exe 闭源且稳定,直接 subprocess 调用(qfh_loader.exe 已合并到 fh_loader.exe,见核心约束)
2. **magiskboot.exe 保留**:官方 Magisk boot 操作工具
3. **patch_boot.exe 可重写**:核心是 4 条正则替换,Python/TS 可在 30 行内实现
4. **menu.exe 可废弃**:菜单选项写死在 `src/lib/menus.ts`(参考原 JSON 确保功能覆盖完整)
5. **device_check.exe 可重写**:基于 `adb devices` + `fastboot devices` + USB VID/PID 检测,TS 200 行可搞定
6. **timer/progress/pause/ground_glass/filedialog/run_cmd/atblogo 全部废弃**:用 Electron/Node 原生能力替代

### 2.4 已知的原项目 Bug(迁移时**修复,不保留**)

> **用户已批准修复以下所有 bug**(见核心约束章节"已知 Bug 的处理"表)。
> 以下行为在 iMooDesktop 中**不再保留原行为**,按"修复方案"列执行。
> 每一项的实现都必须在 `docs/fidelity/bugfixes.md` 中记录对照(原行为 vs 修复后行为)。

| 原行为 | 位置 | 修复方案 |
|---|---|---|
| `instmodule2.bat` 不存在,调用会失败 | ROOT-SDK19.bat:232 | 改为调用 `instmodule.bat`(等价语义,文件实际存在)。原 `.bat` 不检查失败直接继续,修复后正常执行模块安装。 |
| `modapi.exe` 不存在,模块商店功能不可用 | modulestore.bat | 模块商店对接 Magisk 官方模块仓库 API(或保留"不可用"状态待 M5 阶段决定)。原"不可用"状态不再保留。 |
| `search` 不存在,主菜单按 s 调用会失败 | main.bat:15 | 实现命令面板(Ctrl+K),可绑定 s 键作为快捷键。原"按 s 无效"行为不再保留。 |
| `patch_boot.exe` 输出 `Sucess`(拼写错误) | patch_boot.exe | BootPatcher 重写后输出 `success`,检查方式改为 `includes('success')`。原拼写错误不再保留。 |
| `misc_ND07.xml` encoding=`UTF_8`(应为 `UTF-8`) | EDL/misc/misc_ND07.xml | 修正为 `UTF-8`。 |
| `backup_9008.json` 缺 Z2/Z3 | menu/backup_9008.json | 补充 I12/IB 的 9008 备份支持(其 misc xml 已存在,只是菜单没列)。 |
| `whoami.txt` 初始值影响更新检查 | start.bat + whoyou.txt | 保留 `whoyou` 状态机(1=未使用,2=已使用,3=已更新),`start.bat` 中的分支逻辑完整复刻。(**注:这不是 bug,是设计,保留**) |
| 彩蛋逻辑(SDK=11 / Z11) | root.bat:196-202 / nd08root.bat | **保留彩蛋文案**(如"你是怎么运行到这里的?""这只是个彩蛋而已 qwq"),这是作者意图,非 bug。(**注:保留,不删**) |

### 2.5 命名/拼写规范(用户已批准修复)

> **用户已批准**:原项目中存在命名误导、拼写错误、变量冗余、风格不一等问题,属于技术实现细节,迁移时**修正为新规范名**,不保留原名。
> 每一项的实现必须在 `docs/fidelity/renaming.md` 中记录对照(原名 → 新名 → 影响范围)。
> **核心原则**:
> - 改名后,所有引用该名的代码/配置/文档同步更新,不得残留旧名
> - **设备端 push 的 .sh 文件名可以改**(用户已批准,脚本内容不动,只改文件名 + push 路径)
> - **设备端业务路径不改**(如 `/sdcard/xtc/ota_f_vota.zip`、`/data/adb/modules/` 是业务逻辑)
> - **所有 .bat 脚本废弃**(详见 2.6 节),其逻辑进 TS,.bat 文件名问题自然消失,不单独处理

#### 2.5.1 工具本地目录命名误导

| 原路径 | 新路径 | 原因 |
|---|---|---|
| `bin/tmp/` | `resources/cache/` | 原目录放的是 eboot.img(擦除占位)+ 下载的 userdata.img/systemui.zip/xtcpatch.zip,这些是**持久缓存资源**,不是临时文件 |
| `bin/EDL/rooting/` | `resources/edl/work/` | 原目录是解压 `innermodel.zip` 的**临时工作目录**,不是"rooting 资源"(真正的 rooting 资源在 zip 内) |

**约束**:
- 原目录名 `tmp` / `rooting` 在 TS 代码中**不再出现**,统一用 `cache` / `work`
- 设备端路径(如 `/sdcard/xtc/ota_f_vota.zip`)**不改**(那是业务路径)
- 日志/错误提示中若提到这些目录,用新名

#### 2.5.2 设备端 .sh 文件改名(用户已批准)

以下 .sh 文件会被 push 到设备执行,**文件名可以改**(用户已批准)。改名后,`adb push` 的源路径和目标路径**同步更新**,脚本内容**不动**。

| 原文件名 | 新文件名 | 原因 | 原 push 路径 | 新 push 路径 |
|---|---|---|---|---|
| `magiskperinster.sh` | `magisk_force_install.sh` | `perinster` 是 `per-install` 的错误连写,语义不清 | `/sdcard/magiskperinster.sh` | `/sdcard/magisk_force_install.sh` |
| `magisklistmod.sh` | `list_modules.sh` | `listmod` 连写不规范,语义是"列出模块" | `/sdcard/magisklistmod.sh` | `/sdcard/list_modules.sh` |
| `sh_module_installer.sh` | `module_installer.sh` | 前缀 `sh_` 多余(本来就是 .sh) | `/sdcard/sh_module_installer.sh` | `/sdcard/module_installer.sh` |
| `2100.sh` | `setup_magisk_env.sh` | 纯数字无语义(实际是 SDK25 复制 Magisk 运行环境) | `/sdcard/2100.sh` | `/sdcard/setup_magisk_env.sh` |
| `rec.sh` | `auto_flash_recovery.sh` | 缩写过短(实际是开机自刷 recovery) | `/data/rec.sh`(注:这个路径是业务逻辑,见下) | 见下方说明 |

**关于 `rec.sh` 的特殊处理**:
- 原 `rec.sh` 的 push 路径是 `/data/rec.img`(被 `rec.sh` 脚本当作输入文件)和 `/data/adb/service.d/rec.sh`(开机自启服务)
- 其中 `/data/adb/service.d/rec.sh` 是 **Magisk 服务目录约定路径**,属于业务逻辑,路径不能改
- 但脚本文件名 `rec.sh` 可以改成 `auto_flash_recovery.sh`,push 时:
  ```typescript
  // 原:adb push rec.sh /data/adb/service.d/rec.sh
  // 新:adb push auto_flash_recovery.sh /data/adb/service.d/rec.sh
  //     (源文件改名,目标路径保留 Magisk 约定)
  ```
- 脚本内容不动(里面的 `dd if=/data/rec.img of=...` 保持原样)

**保留不改的 .sh**(语义清晰):
- `toolkit.sh` / `systemplus.sh` / `autosystemplus.sh` / `write_md5.sh` —— 命名规范,保留

#### 2.5.3 冗余变量名

| 原变量(.bat,4个等价) | 新变量(TS) | 原因 |
|---|---|---|
| `chkdev__edl_port` / `chkdev__edl__port` / `edl_port` / `edlport` | `edlPort`(单个) | `edlport.bat` 为兼容不同调用方,设置了 4 个指向同一值的变量,TS 中无需这种兼容 |

**约束**:
- TS 代码中**只保留一个变量名** `edlPort`
- 原变量的值(9008 COM 端口号)和写入时机不变

#### 2.5.4 不修复的项(保留原样)

以下虽也有"不规范"嫌疑,但属于**业务逻辑或作者意图**,不修复:

| 项 | 原因 |
|---|---|
| `misc.mbn` vs `misc.img` 扩展名差异(MSM8909W 用 `.mbn`,MSM8937 用 `.img`) | 这是 firehose 协议约定,属于业务逻辑,见核心约束"绝对不能改的"表 |
| `whoyou.txt` 的变量名 `whoyou` | 持久化状态文件,TS 里改名为 `usageState`(内存变量),文件名保留(便于和原项目对照) |
| 彩蛋文案("你是怎么运行到这里的?"等) | 作者意图,非命名问题,见 2.4 节 |
| `instmod.txt` / `magiskinstmod.txt` / `magiskunmod.txt` 等配置文件名 | 改为内存变量后自然消失,无需单独"修复" |
| 所有 .bat 文件名(如 `pashroot.bat` / `qqwxautestart.bat` / `nutime.bat` 等) | .bat 全部废弃(见 2.6 节),文件名问题自然消失 |
| APK 文件名 `z10apk.Apk` / `z10apk1.Apk`(扩展名大写) | **用户指示保留原样**(2026-06-18)。原 .bat 用 `adb install z10apk.Apk`,改名会触及业务路径,保留 |

#### 2.5.5 审查要求

每个 Service 实现时,若发现新的命名/拼写问题:
1. **不得自行修复**(避免范围蔓延)
2. 记录到 `docs/fidelity/renaming-questions.md`,格式:`[文件名:行号] 原名:... 建议新名:... 待用户确认`
3. 集中向用户确认后,补充到本节清单

### 2.6 .bat 脚本处理原则(重要澄清)

> **核心原则:所有 .bat 脚本废弃,业务逻辑用 TypeScript 重写。**
> **保留的只有 .exe 二进制**(adb/fastboot/fh_loader/QSaharaServer/magiskboot/7z/aria2c/busybox/scrcpy 等闭源工具)。

#### 2.6.1 .bat 文件的处理

原项目共 65 个 .bat 脚本,**全部不打包、不保留、不调用**。每个 .bat 的业务逻辑迁移到对应的 TS Service:

| 原 .bat | 迁移目标 |
|---|---|
| `start.bat` | `electron/main.ts`(应用入口) |
| `main.bat` | `src/routes/Home.tsx`(主菜单渲染) |
| `root.bat` + `ROOT-SDK19/25/27.bat` + `nd03root.bat` + `nd08root.bat` | `RootService.ts` |
| `rebootpro.bat` | `RebootService.ts` |
| `cloud.bat` + `link.bat` + `curltool.bat` + `resvertool.bat` | `CloudService.ts` |
| `userinstapp.bat` + `instapp.bat` + `unapp.bat` + `qqwxautestart.bat` + `z10openinst.bat` | `AppService.ts` |
| `userinstmodule.bat` + `instmodule.bat` + `userunmodule.bat` + `unmodule.bat` + `magisklist.bat` + `setmagisk.bat` + `xtcpatch.bat` + `modulestore.bat` | `MagiskService.ts` |
| `backup.bat` + `super_recovery.bat` + `pashtwrp.bat` + `pashtwrppro.bat` + `write_md5.bat` | `BackupService.ts` + `ResourceService.ts` |
| `edlport.bat` + `QSaharaServer.bat` + `fh_loader.bat` + `qfh_loader.bat` + `P_fh_loader.bat` | `EdlService.ts` |
| `adbdevice.bat` + `boot_completed.bat` + `wifiadb.bat` | `AdbService.ts` + `DeviceService.ts` |
| `magiskpatch.bat` + `automagisk.bat` + `autosystemplus.bat` | `MagiskPatcher.ts` + `BootPatcher.ts` + `RootService.ts` |
| `scrcpy-ui.bat` + `scrcpy-noconsole.vbs` | `ScrcpyService.ts` |
| `ota.bat` + `opencharge.bat` + `Xposed.bat` + `listbuild.bat` + `innermodel.bat` + `pashroot.bat` + `rootpro.bat` | 散落到对应 Service 或独立 Route |
| `color.bat` + `logo.bat` + `thank.bat` + `atblogo.exe` | React 组件 + Tailwind |
| `checkfile.bat` + `checkdriver.bat` + `check_res.bat` | `ResourceService.ts` + `DriverService.ts` |
| `upall.bat` + `uplog.bat` + `runupall.bat` | `UpdateService.ts`(electron-updater) |
| `Loadatbmod.bat` | `AtbmodService.ts` |
| `speedstart.bat` + `sel.bat` + `nutime.bat` + `number.bat` + `isv3.bat` | TS 内联函数 / Zustand store |
| `menu.exe` + 33 个 menu/*.json(参考) | React 组件 + `src/lib/menus.ts`(菜单选项写死在代码,原 JSON 降级为参考) |

#### 2.6.2 .exe 的处理

**保留并打包**到 `resources/bin/`(闭源工具,直接 subprocess 调用):

| .exe | 用途 | 处理 |
|---|---|---|
| `adb.exe` + DLLs | ADB | 保留 |
| `fastboot.exe` | Fastboot | 保留 |
| `QSaharaServer.exe` | 9008 引导 | 保留 |
| `fh_loader.exe` | 9008 读写 | 保留(qfh_loader 已合并,见核心约束) |
| `magiskboot.exe` | Magisk boot 操作 | 保留 |
| `7z.exe` + `7z.dll` | 压缩 | 保留 |
| `aria2c.exe` | 下载 | 保留 |
| `busybox.exe` | Unix 工具 | 保留 |
| `scrcpy.exe` + scrcpy-server + DLLs | 投屏 | 保留 |
| `lsusb.exe` | USB 列表 | 保留(可选,优先用 node-usb) |

**废弃**(自研,TS 重写):

| .exe | TS 替代 |
|---|---|
| `AllToolBox.exe` | Electron 主进程 |
| `menu.exe` + `c_prompt_toolkit.dll` | React 组件 + `src/lib/menus.ts` |
| `device_check.exe` | `DeviceService.ts` |
| `timer.exe` | `lib/timer.ts` |
| `progress.exe` | `<TaskProgress/>` + SubprocessPool 流式输出 |
| `pause.exe` | shadcn `<AlertDialog/>` |
| `ground_glass.exe` | `BrowserWindow.setOpacity()` |
| `filedialog.exe` | Electron `dialog.showOpenDialog()` |
| `atblogo.exe` | React `<Logo/>` 组件 |
| `run_cmd.exe` | `string-argv` + `subprocess.run` |
| `patch_boot.exe` | `BootPatcher.ts`(4 条正则) |

#### 2.6.3 约束

- TS 代码中**不得出现 `call xxx.bat` 或 `cmd /c xxx.bat`** 的调用
- 所有原 .bat 的业务逻辑,必须在对应 TS Service 中有等价实现(见核心约束"逻辑保真度")
- .bat 文件名问题(如 `pashroot.bat` 的 "pash" 拼写错)在 TS 重写后自然消失,不单独处理
- 原 .bat 的行号用于对照(在 TS 注释中标注 `// root.bat:134`),方便审查


---

## 3. 技术栈选型与理由

### 3.1 最终选型

| 层 | 技术 | 版本 | 用途 |
|---|---|---|---|
| **运行时** | Electron | ^33 | 桌面壳子 + Node.js 主进程 |
| **构建** | Vite | ^6 | 前端 HMR + 打包 |
| **框架** | React | ^19 | 渲染进程 UI |
| **语言** | TypeScript | ^5.6 | 全栈类型安全 |
| **样式** | Tailwind CSS | ^4 | 原子化 CSS |
| **组件库** | shadcn/ui | New York | 复合组件(对话框/菜单/表格/命令面板) |
| **图标** | lucide-react | latest | SVG 图标库(符合禁 emoji 约束,见核心约束 UI 规范) |
| **状态** | Zustand | ^5 | 客户端状态 |
| **服务端状态** | TanStack Query | ^5 | 设备/资源等异步数据缓存 |
| **路由** | React Router | ^7 | 多页面/多视图 |
| **日志** | electron-log | ^5 | 跨进程日志文件 |
| **打包** | electron-builder | ^25 | Windows 安装包 |
| **IPC** | electron-typed-ipc | ^0.x | 类型安全 IPC(或自写类型封装) |
| **测试** | Vitest(单元) | ^2 | 关键服务逻辑单测 |
| **Lint** | ESLint + Prettier | latest | 代码质量 |

### 3.2 为什么是这套

1. **JS 全栈,无语言切换成本** —— 前端 React 后端 Node,类型定义可共享
2. **child_process 是 Node 一等公民** —— 调 .exe + 流式输出 + 错误处理成熟
3. **IPC 天然适配** —— `ipcMain.handle` + `ipcRenderer.invoke` 比 HTTP/WebSocket 少一层
4. **shadcn/ui 组件齐全** —— Dialog/DropdownMenu/Command/DataTable/Toast 全覆盖工具类 UI 需求
5. **生态成熟** —— VSCode/Discord/Slack 都是 Electron,遇到问题能搜到答案
6. **electron-builder 打包简单** —— 一键生成 NSIS 安装包,支持签名/自动更新

### 3.3 代价与接受度

| 代价 | 数值 | 接受度 | 说明 |
|---|---|---|---|
| 安装包体积 | 80–100 MB | 接受 | 工具类应用,用户偶尔启动,非敏感 |
| 运行内存 | 150–200 MB | 接受 | 同上 |
| 启动时间 | 1–2 秒 | 接受 | Root/刷机场景,启动慢可接受 |

---

## 4. 目标系统架构

### 4.1 进程模型

```
┌─────────────────────────────────────────────────────────────────────┐
│  Electron 主进程 (main/) — Node.js 运行时                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  应用生命周期 (app/window)                                    │  │
│  │  ├─ 创建 BrowserWindow(含菜单/托盘)                          │  │
│  │  └─ 单实例锁 + 自动更新(electron-updater)                    │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │  IPC 路由层 (ipc/)                                            │  │
│  │  └─ typed handlers: device/root/edl/magisk/app/backup/cloud   │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │  服务层 (services/)                                           │  │
│  │  ├─ DeviceService   — ADB/Fastboot/9008 检测与等待            │  │
│  │  ├─ AdbService      — adb 命令封装(install/shell/push/pull)  │  │
│  │  ├─ FastbootService — fastboot 命令封装                       │  │
│  │  ├─ EdlService      — QSaharaServer/fh_loader 封装            │  │
│  │  ├─ BootPatcher     — magiskboot + patch_boot 重写            │  │
│  │  ├─ RootService     — Root 全流程状态机                       │  │
│  │  ├─ RebootService   — 9 种重启模式                            │  │
│  │  ├─ MagiskService   — 模块安装/卸载/列表                      │  │
│  │  ├─ AppService      — APK 安装/卸载/开机自启                  │  │
│  │  ├─ BackupService   — DCIM/EDL/dd 备份恢复                    │  │
│  │  ├─ CloudService    — 4 镜像站下载 + 资源版本管理             │  │
│  │  ├─ ScrcpyService   — scrcpy 子进程管理                       │  │
│  │  ├─ ResourceService — bin/ 资源完整性校验                     │  │
│  │  └─ LoggerService   — electron-log + 前端日志流               │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │  子进程管理 (SubprocessPool)                                  │  │
│  │  └─ 统一 spawn/exec,捕获 stdout/stderr,转发到渲染进程       │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │  资源管理 (resources/)                                        │  │
│  │  ├─ bin/           — adb/fastboot/QSaharaServer/... (原样保留)│  │
│  │  ├─ edl/           — allxml/misc img/firehose loader          │  │
│  │  ├─ magisk/        — magiskinit21/25/magisk32.xz/...          │  │
│  │  ├─ scripts/       — *.sh (push 到设备)                       │  │
│  │  ├─ menus (代码内) — src/lib/menus.ts(原 32 个 JSON 降级为参考)    │  │
│  │  └─ data/          — innermodel.json/isv3.json/links.json     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ IPC (contextBridge + invoke/handle)
┌──────────────────────────▼──────────────────────────────────────────┐
│  Electron 渲染进程 (renderer/) — Chromium                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  React 应用根 (<App/>)                                        │  │
│  │  ├─ 路由(React Router)                                       │  │
│  │  │   ├─ /                  主菜单                              │  │
│  │  │   ├─ /device            设备状态页                          │  │
│  │  │   ├─ /root              Root 向导(分步骤)                 │  │
│  │  │   ├─ /reboot            高级重启                            │  │
│  │  │   ├─ /cloud             资源下载                            │  │
│  │  │   ├─ /apps              应用管理                            │  │
│  │  │   ├─ /magisk            Magisk 模块管理                     │  │
│  │  │   ├─ /backup            备份恢复                            │  │
│  │  │   ├─ /tools             其他工具                            │  │
│  │  │   ├─ /settings          设置                                │  │
│  │  │   └─ /logs              日志查看器                          │  │
│  │  ├─ 全局组件                                                  │  │
│  │  │   ├─ <CommandPalette/>   Ctrl+K 命令面板                    │  │
│  │  │   ├─ <DeviceStatusBar/>  顶部设备状态条                     │  │
│  │  │   ├─ <LogConsole/>       底部可折叠实时日志(WebSocket 风格)│  │
│  │  │   ├─ <TaskProgress/>     任务进度条/Toast                   │  │
│  │  │   └─ <DisclaimerModal/>  启动免责声明                       │  │
│  │  ├─ 状态(Zustand + TanStack Query)                          │  │
│  │  │   ├─ useDeviceStore      当前设备状态                       │  │
│  │  │   ├─ useTaskStore        当前任务/进度                      │  │
│  │  │   ├─ useLogStore         日志缓冲(环形 5000 条)           │  │
│  │  │   ├─ useSettingsStore    用户设置                           │  │
│  │  │   └─ useResourceStore    资源版本/缓存                      │  │
│  │  └─ UI(shadcn/ui + Tailwind)                                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                           │ child_process.spawn
┌──────────────────────────▼──────────────────────────────────────────┐
│  外部二进制(resources/bin/)                                         │
│  adb.exe / fastboot.exe / QSaharaServer.exe / fh_loader.exe /       │
│  magiskboot.exe / 7z.exe / aria2c.exe / busybox.exe / scrcpy.exe    │
│  (注:qfh_loader.exe 已合并到 fh_loader.exe,不单独打包)           │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 数据流

```
用户点击按钮
  │
  ▼
React 组件 → useMutation(React Query)
  │
  ▼
renderer 调用 window.api.device.detect()(preload 暴露)
  │
  ▼ contextBridge
main 进程 ipcMain.handle('device:detect')
  │
  ▼
DeviceService.detect() → SubprocessPool.spawn('device_check', ...)
  │                       (或直接 adb devices 循环)
  ▼
子进程 stdout 流 → LoggerService → 通过 IPC event 'log:stream' 推送
  │
  ▼
renderer 的 useLogStore 追加日志 → <LogConsole/> 渲染
  │
  ▼
子进程 exit → DeviceService 返回 {type:'adb', serial:'...'}
  │
  ▼
ipcMain.handle 返回 → React Query mutation onSuccess → UI 更新
```

### 4.3 实时日志的关键设计

- **主进程**维护一个 `EventEmitter`(名为 `logBus`),所有 `SubprocessPool.spawn` 的 stdout/stderr 行都 emit 到 `logBus`
- **主进程**通过 `BrowserWindow.webContents.send('log:line', line)` 推送到渲染进程
- **渲染进程**用 `useLogStore`(Zustand)订阅,环形缓冲 5000 行,超出丢弃最旧的
- 日志按 `taskId` 分组,UI 可按任务过滤
- 同时用 `electron-log` 写文件到 `%APPDATA%/iMooDesktop/logs/<date>.log`,供事后排查

---

## 5. 项目目录结构

```
iMooDesktop/
├── package.json
├── electron-builder.yml          # 打包配置
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── eslint.config.js
├── .gitignore
├── README.md
├── plan.md                       # 本文档
│
├── electron/                     # Electron 主进程源码
│   ├── main.ts                   # app 入口,创建窗口/托盘/菜单
│   ├── preload.ts                # contextBridge 暴露 API
│   ├── ipc/
│   │   ├── index.ts              # 注册所有 handler
│   │   ├── device.ts             # device:* 通道
│   │   ├── root.ts               # root:* 通道
│   │   ├── edl.ts                # edl:* 通道
│   │   ├── reboot.ts             # reboot:* 通道
│   │   ├── magisk.ts             # magisk:* 通道
│   │   ├── app.ts                # app:* 通道(应用管理)
│   │   ├── backup.ts             # backup:* 通道
│   │   ├── cloud.ts              # cloud:* 通道
│   │   ├── scrcpy.ts             # scrcpy:* 通道
│   │   ├── system.ts             # system:* 通道(窗口/设置/日志)
│   │   └── types.ts              # IPC 请求/响应类型(与渲染进程共享)
│   │
│   ├── services/
│   │   ├── SubprocessPool.ts     # 统一 spawn,流式输出,超时控制
│   │   ├── Logger.ts             # electron-log + logBus
│   │   ├── DeviceService.ts      # 设备检测/等待/状态机
│   │   ├── AdbService.ts         # adb 命令封装
│   │   ├── FastbootService.ts    # fastboot 命令封装
│   │   ├── EdlService.ts         # QSaharaServer/fh_loader(qfh_loader 已合并)
│   │   ├── BootPatcher.ts        # magiskboot + patch_boot(重写)
│   │   ├── MagiskPatcher.ts      # magiskpatch.bat 的 TS 重写
│   │   ├── RootService.ts        # Root 全流程状态机
│   │   ├── RebootService.ts      # 9 种重启模式
│   │   ├── MagiskService.ts      # 模块 install/uninstall/list
│   │   ├── AppService.ts         # APK install/uninstall/autostart
│   │   ├── BackupService.ts      # DCIM/EDL/dd 备份恢复
│   │   ├── CloudService.ts       # 4 镜像下载 + 资源版本
│   │   ├── ScrcpyService.ts      # scrcpy 子进程
│   │   ├── ResourceService.ts    # bin/ 完整性校验(MD5 manifest)
│   │   ├── DriverService.ts      # 驱动检测/安装(原 checkdriver.bat)
│   │   ├── UpdateService.ts      # 自更新检查(electron-updater)
│   │   └── AtbmodService.ts      # .atbmod 模块包加载
│   │
│   ├── core/
│   │   ├── paths.ts              # 资源路径解析(dev vs prod)
│   │   ├── config.ts             # 应用配置持久化(electron-store)
│   │   ├── windows.ts            # 主窗口/投屏窗口管理
│   │   ├── menu.ts               # 应用菜单(文件/编辑/视图/帮助)
│   │   ├── tray.ts               # 系统托盘
│   │   └── single-instance.ts    # 单实例锁
│   │
│   └── lib/
│       ├── gbk.ts                # GBK 编解码(iconv-lite)
│       ├── xml.ts                # EDL XML 解析(fast-xml-parser)
│       ├── zip.ts                # 7z/解压封装
│       ├── download.ts           # aria2c/https 下载封装
│       ├── timer.ts              # 计时器(替代 timer.exe)
│       └── fs-extra.ts           # 文件操作辅助
│
├── src/                          # 渲染进程源码(React)
│   ├── main.tsx                  # React 入口
│   ├── App.tsx                   # 根组件 + 路由
│   ├── index.css                 # Tailwind + 全局样式
│   │
│   ├── routes/                   # 页面
│   │   ├── Home.tsx              # 主菜单(读 menus/main.json)
│   │   ├── Device.tsx            # 设备状态
│   │   ├── Root.tsx              # Root 向导
│   │   ├── Reboot.tsx            # 高级重启
│   │   ├── Cloud.tsx             # 资源下载
│   │   ├── Apps.tsx              # 应用管理
│   │   ├── Magisk.tsx            # Magisk 模块管理
│   │   ├── Backup.tsx            # 备份恢复
│   │   ├── Tools.tsx             # 其他工具
│   │   ├── Settings.tsx          # 设置
│   │   └── Logs.tsx              # 日志查看器
│   │
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 组件(已生成)
│   │   ├── layout/
│   │   │   ├── AppShell.tsx      # 整体布局(顶栏/侧栏/内容/底栏)
│   │   │   ├── Sidebar.tsx       # 侧边导航
│   │   │   ├── TopBar.tsx        # 顶部设备状态条
│   │   │   ├── Footer.tsx        # 页脚(版权/版本)
│   │   │   └── LogConsole.tsx    # 底部可折叠日志面板
│   │   ├── device/
│   │   │   ├── DeviceCard.tsx    # 设备信息卡
│   │   │   ├── DeviceWatcher.tsx # 设备热插拔监听
│   │   │   └── ConnectGuide.tsx  # 连接引导
│   │   ├── menu/
│   │   │   ├── MenuRenderer.tsx  # 通用 JSON 菜单渲染器
│   │   │   └── MenuOption.tsx    # 单个菜单项
│   │   ├── root/
│   │   │   ├── RootWizard.tsx    # Root 步骤向导
│   │   │   ├── ModelPicker.tsx   # 型号选择(可搜索)
│   │   │   ├── DisclaimerStep.tsx
│   │   │   ├── ConnectingStep.tsx
│   │   │   ├── PatchingStep.tsx
│   │   │   └── FinalizingStep.tsx
│   │   ├── task/
│   │   │   ├── TaskProgress.tsx  # 进度条
│   │   │   ├── TaskList.tsx      # 任务队列
│   │   │   └── TaskCancel.tsx
│   │   ├── common/
│   │   │   ├── CommandPalette.tsx # Ctrl+K 命令面板
│   │   │   ├── DisclaimerModal.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── FilePicker.tsx    # 替代 filedialog.exe
│   │   │   └── EmptyState.tsx
│   │   └── magisk/
│   │       ├── ModuleList.tsx
│   │       ├── ModuleCard.tsx
│   │       └── ModuleStore.tsx
│   │
│   ├── hooks/
│   │   ├── useDevice.ts          # 当前设备状态
│   │   ├── useTask.ts            # 当前任务
│   │   ├── useLogs.ts            # 日志订阅
│   │   ├── useIpc.ts             # 通用 IPC invoke 封装
│   │   ├── useMenu.ts            # 加载菜单(从代码内常量,见 src/lib/menus.ts)
│   │   └── useShortcut.ts        # 键盘快捷键
│   │
│   ├── stores/
│   │   ├── deviceStore.ts        # Zustand: 设备状态
│   │   ├── taskStore.ts          # Zustand: 任务队列
│   │   ├── logStore.ts           # Zustand: 日志环形缓冲
│   │   ├── settingsStore.ts      # Zustand: 用户设置
│   │   └── resourceStore.ts      # Zustand: 资源版本
│   │
│   ├── lib/
│   │   ├── api.ts                # window.api 类型封装(preload 暴露)
│   │   ├── ipc-channels.ts       # IPC 通道名常量(与主进程共享)
│   │   ├── models.ts             # 内部型号表(从 innermodel.bat 转换)
│   │   ├── format.ts             # 格式化(字节/时间/状态)
│   │   └── utils.ts              # cn() 等
│   │
│   └── types/
│       ├── device.ts             # DeviceType, DeviceInfo
│       ├── root.ts               # RootOptions, RootStage
│       ├── magisk.ts             # Module, InstallMethod
│       ├── cloud.ts              # Resource, ResourceVersion
│       ├── ipc.ts                # IPC 请求/响应类型
│       └── menu.ts               # MenuJSON, MenuOption
│
├── resources/                    # 打包资源(原 bin/ 内容)
│   ├── bin/                      # 所有 .exe + .dll(原样保留)
│   │   ├── adb.exe
│   │   ├── fastboot.exe
│   │   ├── QSaharaServer.exe
│   │   ├── fh_loader.exe
│   │   ├── qfh_loader.exe        # 不打包(已合并到 fh_loader.exe,见核心约束)
│   │   ├── magiskboot.exe
│   │   ├── 7z.exe + 7z.dll
│   │   ├── aria2c.exe
│   │   ├── busybox.exe
│   │   ├── lsusb.exe
│   │   ├── scrcpy.exe + scrcpy-server + SDL2.dll + av*.dll + ...
│   │   ├── magiskinit21
│   │   ├── magiskinit25
│   │   ├── libmagisk32.so
│   │   ├── magisk32.xz
│   │   ├── magisk25.apk
│   │   ├── 711_adbd
│   │   ├── 810_adbd
│   │   └── xse.rc
│   │
│   ├── edl/
│   │   ├── allxml/               # 9 个分区表(原 EDL/allxml/)
│   │   ├── misc/                 # 14 个 misc xml + 4 个 misc img(原 EDL/misc/)
│   │   ├── msm8909w.mbn
│   │   ├── msm8937.mbn
│   │   ├── prog_firehose_ddr.elf
│   │   ├── reboot.xml
│   │   ├── cache/                # 持久缓存(原 bin/tmp/,改名见 2.5.1)
│   │   │   └── eboot.img         # 33MB 全零,擦除 boot 占位
│   │   └── work/                 # 解压 innermodel.zip 的临时工作目录(原 EDL/rooting/,改名见 2.5.1)
│   │
│   ├── scripts/                  # push 到设备的 .sh(原 bin/*.sh,改名见 2.5.2)
│   │   ├── toolkit.sh              # 保留(语义清晰)
│   │   ├── auto_flash_recovery.sh  # 原名 rec.sh
│   │   ├── setup_magisk_env.sh     # 原名 2100.sh
│   │   ├── systemplus.sh           # 保留
│   │   ├── autosystemplus.sh       # 保留
│   │   ├── module_installer.sh     # 原名 sh_module_installer.sh
│   │   ├── magisk_force_install.sh # 原名 magiskperinster.sh
│   │   ├── list_modules.sh         # 原名 magisklistmod.sh
│   │   └── write_md5.sh            # 保留
│   │
│   ├── (menus 目录已移除,菜单选项写死在 src/lib/menus.ts)
│   │
│   ├── data/                     # 数据化后的静态表
│   │   ├── models.json           # 型号对照表(从 innermodel.bat 转换)
│   │   ├── isv3-thresholds.json  # V3 协议阈值(从 isv3.bat 转换)
│   │   ├── links.json            # 4 镜像 URL + 26 文件名映射(从 link.bat 转换)
│   │   ├── build-props.json      # 89 个 ro.build.* 字段(从 build.txt 转换)
│   │   ├── switch.db             # Z10 解除限制用(原样保留)
│   │   └── manifest.json         # bin/ 文件 MD5 清单(运行时校验)
│   │
│   └── assets/                   # 应用自身资源
│       ├── icon.png              # 应用图标
│       ├── icon.ico              # Windows 图标
│       └── logo.svg              # 启动 logo
│
├── scripts/                      # 开发辅助脚本
│   ├── convert-menus.ts          # (已废弃)菜单选项改为代码内定义
│   ├── convert-models.ts         # 从 innermodel.bat 生成 models.json
│   ├── convert-links.ts          # 从 link.bat 生成 links.json
│   ├── generate-manifest.ts      # 扫描 resources/bin/ 生成 MD5 manifest
│   └── verify-assets.ts          # 启动前校验资源完整性
│
└── tests/                        # 单元测试(关键服务)
    ├── services/
    │   ├── BootPatcher.test.ts
    │   ├── MagiskPatcher.test.ts
    │   ├── DeviceService.test.ts
    │   └── RootService.test.ts
    └── lib/
        ├── gbk.test.ts
        └── xml.test.ts
```

---

## 6. 核心模块设计

### 6.1 SubprocessPool(子进程池)

**职责**:统一管理所有外部 .exe 调用,提供流式输出、超时、取消、编码处理。

```typescript
interface SpawnOptions {
  cmd: string;                    // 如 'adb'
  args: string[];                 // ['devices']
  cwd?: string;                   // 默认 resources/bin
  timeout?: number;               // 毫秒,0=不超时
  encoding?: 'utf-8' | 'gbk';     // 默认 'gbk'(兼容原 .exe 输出)
  taskId?: string;                // 关联任务 ID,用于日志分组
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

interface SpawnResult {
  exitCode: number;
  stdout: string;                 // 完整 stdout
  stderr: string;
  duration: number;               // 毫秒
}

class SubprocessPool {
  async spawn(opts: SpawnOptions): Promise<SpawnResult>;
  spawnStreaming(opts: SpawnOptions): AsyncGenerator<string>;  // 行流
  kill(taskId: string): void;
  list(): TaskInfo[];
}
```

**关键点**:
- 用 `child_process.spawn`(非 execFile,避免缓冲区限制)
- `iconv-lite` 解码 GBK 输出(原 .exe 多为 GBK)
- 行分割:`stdout.on('data')` 累积,按 `\n` 切分 emit
- 超时:`AbortController` + `proc.kill('SIGTERM')` → 5 秒后 `SIGKILL`
- 取消:外部调 `pool.kill(taskId)`

### 6.2 Logger(日志服务)

**职责**:统一日志出口,同时写文件 + 推送渲染进程。

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
interface LogEntry {
  ts: number;
  level: LogLevel;
  taskId?: string;
  source: string;                 // 服务名
  message: string;
  raw?: string;                   // 原始子进程输出
}

class Logger {
  log(entry: LogEntry): void;
  child(source: string): Logger;  // 创建子 logger,自动填 source
  // 内部:
  //  1. electron-log 写 %APPDATA%/iMooDesktop/logs/<date>.log
  //  2. logBus.emit('log', entry)
  //  3. BrowserWindow.getAllWindows().forEach(w => w.webContents.send('log:line', entry))
}
```

**日志文件轮转**:按天滚动,保留最近 7 天。

### 6.3 DeviceService(设备检测)

**职责**:替代 `device_check.exe`,检测/等待设备。

```typescript
type DeviceType = 'adb' | 'fastboot' | 'qcom_edl' | 'sprd_edl' | 'emulator' | 'unauthorized' | 'offline';

interface DeviceInfo {
  type: DeviceType;
  serial: string;                 // adb/fastboot 序列号
  mode?: string;                  // 9008 时为 COM 端口
  // ADB/Fastboot 专属:
  innermodel?: string;            // ro.product.innermodel
  model?: string;                 // ro.product.model
  androidVersion?: string;
  sdkVersion?: string;
  softVersion?: string;           // ro.product.current.softversion
  isV3?: boolean;
}

class DeviceService {
  // 当前状态(轮询,1 秒一次)
  current(): DeviceInfo | null;
  
  // 等待任一类型(阻塞,带超时)
  async waitFor(types: DeviceType[], timeout?: number): Promise<DeviceInfo>;
  
  // 监听变化
  onChange(cb: (info: DeviceInfo | null) => void): () => void;
  
  // 内部检测逻辑
  private async detectOnce(): Promise<DeviceInfo | null>;
  //  1. adb devices → 解析,匹配 emulator/unauthorized/offline/device
  //  2. fastboot devices → 解析
  //  3. USB 扫描 → VID=0x05C6 PID=0x9008 → qcom_edl,找 COM 端口(注册表或 wmic)
}
```

**实现要点**:
- 不再写 `tmp.txt`,直接返回对象
- ADB 设备的属性(innermodel 等)用 `adb shell getprop` 懒加载
- 9008 检测:用 `usb.lookup(VID=0x05C6, PID=0x9008)`(node-usb) + Windows 注册表 `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM` 找 COM 端口(替代 `lsusb` + 字符串解析)

### 6.4 AdbService / FastbootService

**职责**:封装常用 adb/fastboot 命令,返回结构化结果。

```typescript
class AdbService {
  async devices(): Promise<DeviceInfo[]>;
  async shell(cmd: string, opts?: {timeout?: number; root?: boolean}): Promise<string>;
  async getprop(prop: string): Promise<string>;
  async install(apk: string, opts?: {reinstall?: boolean; userData?: boolean}): Promise<void>;
  async uninstall(pkg: string): Promise<void>;
  async push(local: string, remote: string): Promise<void>;
  async pull(remote: string, local: string): Promise<void>;
  async reboot(target: 'system' | 'bootloader' | 'recovery' | 'edl' | 'sideload'): Promise<void>;
  async waitForBoot(timeout?: number): Promise<void>;
  async root(): Promise<{granted: boolean; method: 'adb-root' | 'su'}>;
  async listPackages(thirdParty?: boolean): Promise<string[]>;
  // 高级:
  async amStart(activity: string, extras?: Record<string, string>): Promise<void>;
  async pmInstallCreate(opts: {user?: number; session?: number}): Promise<number>;
  async pmInstallWrite(session: number, apk: string): Promise<void>;
  async pmInstallCommit(session: number): Promise<void>;
  async inputTap(x: number, y: number): Promise<void>;
  async inputSwipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void>;
  async setProp(prop: string, value: string): Promise<void>;
  async cmdPackageCompile(pkg: string, mode: string): Promise<void>;
}

class FastbootService {
  async devices(): Promise<DeviceInfo[]>;
  async flash(partition: string, img: string): Promise<void>;
  async erase(partition: string): Promise<void>;
  async boot(img: string): Promise<void>;
  async reboot(target: 'system' | 'bootloader' | 'recovery'): Promise<void>;
  async getVar(name: string): Promise<string>;
  async oem(cmd: string): Promise<void>;
}
```

### 6.5 EdlService(9008 刷机)

**职责**:封装 QSaharaServer + fh_loader(**qfh_loader 已合并到 fh_loader**,见核心约束章节)。

```typescript
interface EdlOptions {
  port: string;                   // COM3 等
  loader: 'msm8909w.mbn' | 'msm8937.mbn' | 'prog_firehose_ddr.elf';
  taskId?: string;
}

class EdlService {
  // 加载 firehose(初始化 9008 通信)
  async loadFirehose(opts: EdlOptions): Promise<void>;
  //  {
  //    QSaharaServer.exe -p \\.\COM3 -s 13:<loader>
  //    检查返回码,失败时读 QStmp.txt 日志
  //  }
  
  // 按分区表 XML 刷入(写)—— 用 fh_loader.exe
  // 警告:错误处理语义:失败=死循环重试(对应原 fh_loader.bat 的 goto run)
  //    日志写 logs/FHerror_<nutime>.txt
  //    UI 显示"9008读取或刷入失败![输入log输出日志]按任意键重新尝试..."
  async flashPartitions(opts: EdlOptions & {xmlPath: string; imagesDir: string}): Promise<void>;
  //  {
  //    fh_loader.exe --port=\\.\COM3 --sendxml=<xml> --convertprogram2write
  //    失败时读 FHtmp.txt,写 fh_error.txt(若用 P_fh_loader 等价模式)
  //  }
  
  // 按分区表 XML 读取(备份)—— 用 fh_loader.exe
  // 警告:错误处理语义:同 flashPartitions(失败=重试)
  async readPartitions(opts: EdlOptions & {xmlPath: string; outputDir: string}): Promise<void>;
  //  {
  //    fh_loader.exe --port=\\.\COM3 --sendxml=<xml> --convertprogram2read
  //    读取后 .img 文件在当前目录
  //  }
  
  // 重启设备 —— 原逻辑用 qfh_loader.exe,现已合并为 fh_loader.exe(用户批准)
  //    但错误处理语义保留:失败=跳过+提示,不重试,返回成功
  //    日志写 logs/qfherror_<nutime>.txt(保留分类,便于追溯)
  //    UI 提示"9008重启失败!已跳过,可能需要手动按10秒电源键重启"
  async reboot(opts: EdlOptions): Promise<void>;
  //  {
  //    fh_loader.exe --port=\\.\COM3 --sendxml=reboot.xml --noprompt
  //    reboot.xml 内容:<power value="reset"/>
  //    失败时:记录日志,返回成功(不抛错)
  //  }
  
  // 找 9008 COM 端口(替代 edlport.bat)
  // 警告:实现细节可优化:原用 lsusb 字符串解析,允许改用 node-usb(只要 COM 端口检测结果一致)
  async findPort(): Promise<string | null>;
  //  {
  //    1. node-usb 查 VID=0x05C6 PID=0x9008
  //    2. Windows: 读注册表 HKLM\HARDWARE\DEVICEMAP\SERIALCOMM
  //       匹配 \Device\QCBQN > COMn
  //    3. 或 wmic path Win32_PnPEntity where "Name like '%Qualcomm%9008%'" get /value
  //  }
  
  // 解析 allxml,返回分区清单
  parseAllXml(xmlPath: string): Partition[];
}
```

### 6.6 BootPatcher + MagiskPatcher(Boot 修补)

**职责**:替代 `magiskpatch.bat` + `patch_boot.exe`。

```typescript
// 替代 patch_boot.exe —— 4 条正则修补 kernel cmdline
// 警告:核心约束:必须 1:1 复刻 patch_boot.exe 的行为,包括:
//    - 4 条正则的顺序、模式、替换字符串(详见 docs/fidelity/patch_boot.md)
//    - 成功输出 "success"(原作者拼写错误 "Sucess" 已修复,见核心约束 2.4 节)
//    - 失败输出 "Error" 或抛 panic
//    - 调用方检查方式:includes('success')(原find "Suc" 已修复)
class BootPatcher {
  // 输入:magiskboot unpack 后的 kernel 文件路径
  // 输出:成功/失败
  patch(kernelPath: string): {success: boolean; patches: string[]};
  //  正则替换(顺序敏感,严禁调整):
  //  1. 'builduser=root' → 'builduser=root' (重复一次,确保存在)
  //     实际是把 cmdline 里的 builduser 字段补一份(原作者逻辑)
  //  2. 'androidboot.selinux=' 后补 'permissive'
  //     即 'androidboot.selinux=enforcing' → 'androidboot.selinux=permissive'
  //     (若已是 permissive 则不变)
  //  3. 'buildvariant=user ' → 'buildvariant=userdebug '
  //     (注意尾部空格,避免匹配 userdebug)
  //  4. 移除 'buildsoftversion=x.y.z' 后的多余空白
  //  
  //  输出字符串:成功输出 "success"(已修复原拼写错误 "Sucess"),失败输出 "Error"
  //  用 fs.readFile → Buffer → 逐字节正则(注意 \0 终止)→ fs.writeFile
  //  详见:docs/fidelity/patch_boot.md(逐字节对照表)
}

// 替代 magiskpatch.bat —— Magisk boot 修补状态机
// 警告:核心约束:必须 1:1 复刻 magiskpatch.bat 的 250 行状态机
//    - 21 vs 25 分支的判断逻辑
//    - magiskboot 每条子命令的参数顺序
//    - Stock boot vs Magisk patched boot 的检测分支
//    - recovery_dtbo 自动启用 RECOVERYMODE 的逻辑
//    - hexpatch 的 3 处 patch 及其 from/to 字节序列
//    - LEGACYSAR=true 仅在 25200 分支(严禁在 21200 启用)
//    详见:docs/fidelity/magiskpatch.md(逐行对照表)
class MagiskPatcher {
  constructor(
    private magiskboot: string,   // magiskboot.exe 路径
    private arch: 'arm_32',
    private magiskVer: 21 | 25,
    private resources: string     // magiskinit/magisk32.xz 所在目录
  ) {}
  
  // 主入口
  async patch(bootImg: string, outputPath: string): Promise<{success: boolean; status: 'stock' | 'magisk-patched' | 'restored'}>;
  
  // 内部步骤(Magisk 25 为例):
  //  1. magiskboot unpack -h boot.img
  //  2. magiskboot cpio ramdisk.cpio test → 读 STATUS(0=stock, 1=magisk)
  //     - stock: 计算 SHA1, 备份 ramdisk.cpio.orig
  //     - magisk: magiskboot cpio ramdisk.cpio restore, 再备份
  //  3. 写 config 文件(KEEPVERITY/KEEPFORCEENCRYPT/PATCHVBMETAFLAG/RECOVERYMODE/SHA1)
  //  4. magiskboot cpio ramdisk.cpio 操作序列:
  //     - "add 0750 init magiskinit"
  //     - "mkdir 0750 overlay.d"
  //     - "mkdir 0750 overlay.d/sbin"
  //     - "add 0644 overlay.d/sbin/magisk32.xz magisk32.xz"  (仅 v25)
  //     - "patch"
  //     - "backup ramdisk.cpio.orig"
  //     - "mkdir 000 .backup"
  //     - "add 000 .backup/.magisk config"
  //  5. magiskboot dtb test → 若有 dtb: magiskboot dtb patch
  //  6. magiskboot hexpatch kernel 三处:
  //     - '4901005401...' → 'A102005401...'  (内核 cmdline)
  //     - '821B8012' → 'E2FF8F12'  (关闭检查)
  //     - 'want_initramfs' → 'skip_initramfs'  (强制跳过)
  //  7. magiskboot repack boot.img <outputPath>
  //  8. 比较大小,异常则告警
}
```

### 6.7 RootService(Root 全流程状态机)

**职责**:替代 `root.bat` + `ROOT-SDK19/25/27.bat` + `nd03root.bat`。

这是**最复杂**的模块,必须用显式状态机实现,每个状态可暂停/取消/回滚。

```typescript
type RootStage =
  | 'idle'
  | 'preparing-resources'        // 检查/下载 userdata/apks/xtcpatch/systemui
  | 'showing-disclaimer'         // 显示免责声明(等用户确认)
  | 'detecting-device'           // device_check adb qcom_edl
  | 'selecting-model'            // (EDL 模式)让用户选型号
  | 'entering-edl'               // rebootpro wipe/qmmi,写 misc
  | 'waiting-adb-after-edl'      // 等设备重新连上 ADB
  | 'reading-device-info'        // innermodel/model/sdk/version
  | 'detecting-v3'               // isv3 判断
  | 'extracting-root-zip'        // 7z 解压 EDL/<innermodel>.zip
  | 'routing-by-sdk'             // 根据 SDK 分支
  // SDK19 子状态:
  | 'sdk19-backup-dcim'
  | 'sdk19-flash-boot'           // fastboot flash boot sboot.img
  | 'sdk19-install-magisk'       // instapp manager.apk + push magiskfile
  | 'sdk19-install-xtcpatch'     // 警告:原逻辑:调用 instmodule2.bat(文件不存在);已修复为 instmodule.bat(见 2.4 节)
  | 'sdk19-restore-dcim'
  // SDK25 子状态:
  | 'sdk25-select-scheme'        // BOOT 方案 vs Recovery 方案
  | 'sdk25-entering-edl'
  | 'sdk25-reading-boot'         // fh_loader read boot
  | 'sdk25-patching-boot'        // magiskpatch 21 + 替换 adbd=711 + patch_boot + repack
  | 'sdk25-flashing'             // BOOT 方案:刷 boot;Recovery 方案:刷 recovery+misc
  | 'sdk25-rebooting'
  | 'sdk25-waiting-boot'
  | 'sdk25-install-magisk'
  | 'sdk25-install-xtcpatch'     // shinst 方式
  | 'sdk25-boot-scheme-second-edl'  // BOOT 方案需二次进 EDL 刷 recovery+misc
  | 'sdk25-restore-dcim'
  // SDK27 子状态:
  | 'sdk27-backup-dcim'
  | 'sdk27-entering-edl'
  | 'sdk27-reading-boot'
  | 'sdk27-patching-boot'        // magiskpatch 25 + 810_adbd + xse.rc + patch_boot + repack
  | 'sdk27-flashing-rawprogram'  // smodel=1: recovery + rawprogram0;否则:rawprogram0 + 擦 boot
  | 'sdk27-rebooting-to-fastboot'
  | 'sdk27-fastboot-flash-boot'
  | 'sdk27-fastboot-flash-userdata'  // 除非 nouserdata
  | 'sdk27-fastboot-flash-misc'      // ffbm-02 进 qmmi
  | 'sdk27-waiting-boot'
  | 'sdk27-install-preinstall'   // smodel=1: 54850.apk important
  | 'sdk27-enable-charge'
  | 'sdk27-auto-grant-magisk'    // automagisk 11 步点击
  | 'sdk27-activate-systemplus'  // autosystemplus
  | 'sdk27-install-xtcpatch'     // magisk 方式
  | 'sdk27-install-systemui'     // isv3 且 ≠I20
  | 'sdk27-install-preinstall-apk'  // 130510/121750/116100
  | 'sdk27-erase-misc-reboot'
  | 'sdk27-install-bundled-apks'  // 8 个预装
  | 'sdk27-compile-packages'     // i3launcher/setting
  | 'sdk27-restore-dcim'
  // ND03(Z10)子状态:
  | 'nd03-download-zip'
  | 'nd03-extract'
  | 'nd03-entering-edl'
  | 'nd03-flash-281-recovery'
  | 'nd03-flash-root-firmware'
  | 'nd03-erase-boot'
  | 'nd03-reboot-to-fastboot'
  | 'nd03-fastboot-flash-boot'
  | 'nd03-boot-recovery'
  | 'nd03-sideload-dm'
  | 'nd03-flash-misc-reboot'
  | 'nd03-wait-3-reboots'        // 循环检测 bin.mt.plus
  | 'nd03-auto-grant-magisk'
  | 'nd03-install-xtcpatch'
  | 'nd03-install-toolkit'
  | 'nd03-activate-lsposed'      // 7 步点击
  | 'nd03-install-preinstall'
  | 'nd03-compile-packages'
  // 完成:
  | 'completed'
  | 'failed'
  | 'cancelled';

interface RootContext {
  stage: RootStage;
  options: {
    nouserdata?: boolean;
    sdkBranch?: 19 | 25 | 27 | 'nd03' | 'nd08';
    modelChoice?: string;          // EDL 模式用户选的型号
    sdk25Scheme?: 'boot' | 'recovery';
  };
  device: DeviceInfo;
  innermodel: string;
  isV3: boolean;
  smodel: boolean;                 // I25C=true
  startedAt: number;
  logs: LogEntry[];
  error?: {stage: RootStage; message: string; recoverable: boolean};
}

class RootService {
  // 启动 Root 流程(返回 taskId,异步执行)
  async start(options: RootOptions): Promise<string>;
  
  // 暂停(在下一个状态边界停下)
  async pause(taskId: string): Promise<void>;
  
  // 恢复
  async resume(taskId: string): Promise<void>;
  
  // 取消(尝试回滚:恢复 DCIM,不回滚已刷的分区)
  async cancel(taskId: string): Promise<void>;
  
  // 跳过当前步骤(高级)
  async skipStage(taskId: string): Promise<void>;
  
  // 状态订阅
  onStageChange(taskId: string, cb: (ctx: RootContext) => void): () => void;
  
  // 内部状态机驱动
  private async run(ctx: RootContext): Promise<void>;
  //  while (ctx.stage not in ['completed','failed','cancelled']) {
  //    if (paused) await waitForResume();
  //    await this[ctx.stage](ctx);  // 执行当前 stage
  //    ctx.stage = nextStage(ctx);  // 计算下一 stage
  //    emit(ctx);
  //  }
}
```

**关键实现策略**:
- 每个 stage 对应一个 private 方法,如 `private async sdk27PatchingBoot(ctx)`
- stage 之间用 `nextStage(ctx)` 函数计算,集中管理转移规则(避免散落)
- 用户暂停 → 设置 `ctx.paused=true`,在 stage 边界检查
- 失败 → `ctx.error`,stage=`failed`,UI 显示错误 + 重试按钮
- 日志 → 每步通过 Logger 输出,taskId 关联

### 6.8 RebootService(高级重启)

**职责**:替代 `rebootpro.bat`,9 种重启模式。

```typescript
type RebootMode =
  | 'system'        // adb reboot / fastboot reboot
  | 'bootloader'    // adb reboot bootloader
  | 'recovery'      // adb reboot recovery
  | 'edl'           // adb reboot edl
  | 'twrp-temp'     // fastboot boot twrp-<innermodel>.img
  | 'qmmi'          // misc=ffbm-02
  | 'ffbm'          // misc=ffbm-01
  | 'wipe-data'     // misc=boot-recovery(1MB wipe.img)
  | 'fastbootd';    // misc=boot-fastbootd(仅 Z10/Z11)

interface RebootOptions {
  mode: RebootMode;
  innermodel?: string;            // twrp-temp / qmmi / ffbm / wipe-data 需要
  platform?: 'otherpash' | 'v3pash' | 'z10';  // 选 firehose loader
}

class RebootService {
  async reboot(opts: RebootOptions): Promise<void>;
  //  内部分支:
  //  - system/bootloader/recovery/edl:
  //      adb 设备 → adb reboot xxx
  //      fastboot 设备 → fastboot reboot / fastboot reboot bootloader
  //      9008 设备 → 选 loader + fh_loader reboot.xml(qfh_loader 已合并)
  //  - twrp-temp:
  //      adb reboot bootloader → device_check fastboot → fastboot boot twrp/<innermodel>.img
  //  - qmmi/ffbm/wipe-data/fastbootd:
  //      根据设备当前状态:
  //        adb → adb reboot edl → edl + 选 loader → fh_loader 刷 misc_<innermodel>.xml + 对应 misc img → fh_loader reboot(qfh_loader 已合并)
  //        9008 → 直接 edl + 刷 misc → fh_loader reboot
  //      misc img 映射:
  //        qmmi → misc.img (ffbm-02)
  //        ffbm → ffbm.img (ffbm-01)
  //        wipe-data → wipe.img (boot-recovery)
  //        fastbootd → fastbootd.img (boot-fastbootd)
}
```

### 6.9 MagiskService(模块管理)

**职责**:替代 `userinstmodule/unmodule/magisklist/instmodule/unmodule/setmagisk/modulestore` 系列。

```typescript
type InstallMethod = 'magisk' | 'shinst' | 'peremptory';
type UninstallMethod = 'mark' | 'direct' | 'script';

interface MagiskModule {
  id: string;
  name: string;
  version: string;
  versionCode: number;
  author: string;
  description: string;
  status: 'active' | 'disabled' | 'remove-marked' | 'update-marked';
  updateJson?: string;             // 模块的更新 JSON URL
}

class MagiskService {
  // 列出已安装模块(替代 magisklist.bat)
  async list(): Promise<MagiskModule[]>;
  //  push magisklistmod.sh → su -c sh → 解析输出
  
  // 安装模块(替代 instmodule.bat)
  async install(zipPath: string, method: InstallMethod): Promise<{id: string; success: boolean}>;
  //  magisk: adb push zip → su -c magisk --install-module <remote>
  //  shinst: adb push sh_module_installer.sh → su -c sh ... (调 Magisk util_functions.sh)
  //  peremptory: adb push magisk_force_install.sh → su -c sh ... (强制解压,禁 exit/abort;原名 magiskperinster.sh,见 2.5.2)
  
  // 卸载模块(替代 unmodule.bat)
  async uninstall(moduleId: string, method: UninstallMethod): Promise<void>;
  //  mark: su -c touch /data/adb/modules/<id>/remove
  //  direct: su -c touch disable + rm -rf
  //  script: su -c sh uninstall.sh + rm -rf
  
  // 启用/禁用
  async enable(moduleId: string): Promise<void>;
  async disable(moduleId: string): Promise<void>;
  
  // 切换默认安装/卸载方式(替代 setmagisk.bat)
  getDefaultMethod(): {install: InstallMethod; uninstall: UninstallMethod};
  setDefaultMethod(method: Partial<{install: InstallMethod; uninstall: UninstallMethod}>): void;
  
  // 模块商店(对应 modulestore.bat)
  // 警告:逻辑保真:原 modulestore.bat 调用不存在的 modapi.exe,功能不可用
  //    已修复(用户批准,见 2.4 节):对接 Magisk 官方模块仓库 API
  //    M5 阶段决定具体对接方式或保留"不可用"状态
  async searchStore(query: string): Promise<StoreModule[]>;
  async installFromStore(module: StoreModule): Promise<void>;
}
```

### 6.10 AppService(应用管理)

**职责**:替代 `userinstapp/unapp/instapp/qqwxautestart/z10openinst`。

```typescript
type InstallMethod = 'install' | 'data' | '3install' | 'create' | 'important' | 'nostreaming';

class AppService {
  async install(apkPath: string, method?: InstallMethod): Promise<{success: boolean; pkg?: string}>;
  //  install: adb install -r -t -d
  //  data: push /data/app/<random>/base.apk + chown system:system
  //  3install: push + am start VIEW intent
  //  create: pm install-create + install-write + install-commit
  //  important: 重试 6 次,每次间隔 30 秒
  //  nostreaming: adb install -r -t -d -S
  
  async installMultiple(apks: string[], method?: InstallMethod): Promise<...>;
  async installFromFolder(folder: string, method?: InstallMethod): Promise<...>;
  
  async uninstall(pkg: string): Promise<void>;
  async listPackages(thirdParty?: boolean): Promise<PackageInfo[]>;
  
  // QQ/微信开机自启(替代 qqwxautestart.bat)
  async enableAutoStart(packages: string[]): Promise<void>;
  //  content call --uri content://com.xtc.launcher.self.start
  //    --method METHOD_SELF_START --extra EXTRA_ENABLE:b:true
  //  对 com.tencent.qqlite / qqwatch / wechatkids
  
  // 解除 Z10 安装限制(替代 z10openinst.bat)
  async unlockZ10Install(): Promise<void>;
  //  1. 检查是否在 QMMI
  //  2. push switch.db → /data/data/com.xtc.i3launcher/databases/
  //  3. adb root + setprop persist.sys.xtc.adb_port=1 + persist.sys.adb.install=1
  //  4. setprop ctl.restart zygote (软重启)
  //  5. 安装 z10apk.Apk + z10apk1.Apk
}
```

### 6.11 BackupService(备份恢复)

**职责**:替代 `backup.bat` + `super_recovery.bat` + `pashtwrp*.bat`。

```typescript
type BackupType = 'dcim' | 'edl-9008' | 'adb-dd';
type BackupMode = 'backup' | 'recover';

interface BackupOptions {
  type: BackupType;
  mode: BackupMode;
  innermodel?: string;            // edl-9008 需要
  outputPath?: string;            // backup 时
  inputPath?: string;             // recover 时
  includeUserData?: boolean;      // adb-dd 时
}

class BackupService {
  async backup(opts: BackupOptions): Promise<{path: string; size: number}>;
  async recover(opts: BackupOptions): Promise<void>;
  
  // DCIM:adb pull /storage/emulated/0/DCIM
  // EDL-9008:edl + 读 allxml → 7z 打包
  // ADB-dd:su -c ls /dev/block/bootdevice/by-name/ → 逐分区 dd → md5sum → 7z
  
  // 刷入固件包(替代 super_recovery.bat)
  async flashFirmware(folder: string): Promise<void>;
  //  自动检测 prog_firehose_ddr.elf / msm8937.mbn / msm8909w.mbn
  //  根据 rawprogram0/1/2.xml 数量分支
  //  P_fh_loader 逐个刷入 + patch0.xml + fh_loader reboot(qfh_loader 已合并)
  
  // 刷入 TWRP(替代 pashtwrp.bat)
  async flashTwrp(innermodel: string): Promise<void>;
  //  EDL 模式:fh_loader 刷 recovery.xml + recovery.img
  // 开机自刷 TWRP(替代 pashtwrppro.bat)
  async autoFlashTwrp(innermodel: string): Promise<void>;
  //  adb push recovery.img → su -c cp + chmod 755
  //  放到 /data/adb/service.d/rec.sh (dd if=/data/rec.img of=.../recovery)
}
```

### 6.12 CloudService(资源下载)

**职责**:替代 `cloud.bat` + `link.bat` + `curltool.bat` + `resvertool.bat`。

```typescript
interface CloudResource {
  name: string;                    // 'userdata' | 'apks' | 'xtcpatch' | ...
  filename: string;                // 'userdata.img' | 'apks.zip' | ...
  version: string;                 // 云端版本
  localVersion?: string;           // 本地版本
  size?: number;
  mirrors: string[];               // 4 个镜像 URL
  extractTo?: string;              // 解压目标(若为 zip)
  required: boolean;               // 必需 vs 可选
}

class CloudService {
  // 列出所有资源(从 links.json + resversion.txt 合并)
  async list(): Promise<CloudResource[]>;
  
  // 检查更新(比对本地 vs 云端版本)
  async checkUpdates(): Promise<{resource: CloudResource; updateAvailable: boolean}[]>;
  
  // 下载单个资源
  async download(name: string, onProgress?: (p: number) => void): Promise<void>;
  //  内部:
  //  1. 从 links.json 读 4 个镜像 URL
  //  2. aria2c --uri-selector=adaptive --max-connection-per-server=8 --split=8
  //     --continue=false --allow-overwrite=true --lowest-speed-limit=1M
  //     --check-certificate=false
  //  3. 下载到 resources/<目标目录>
  //  4. 若是 zip:7z x 解压
  //  5. 更新 settings/resversion.txt 中的版本号
  
  // 下载多个
  async downloadMultiple(names: string[], onProgress?: (name: string, p: number) => void): Promise<void>;
  
  // 工具箱自更新(替代 upall/runupall)
  async checkAppUpdate(): Promise<{version: string; changelog: string; url: string} | null>;
  async performAppUpdate(): Promise<void>;
  //  electron-updater 接管
}
```

### 6.13 ScrcpyService(投屏)

**职责**:替代 `scrcpy-ui.bat` + `scrcpy-noconsole.vbs`。

```typescript
interface ScrcpyOptions {
  noControl?: boolean;
  turnScreenOff?: boolean;
  stayAwake?: boolean;
  record?: string;                 // 录屏文件路径
  noAudio?: boolean;
  audio?: boolean;
  noClipboardAutosync?: boolean;
  legacyPaste?: boolean;
  showTouches?: boolean;
  maxFps?: number;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  windowBorderless?: boolean;
  recordFormat?: 'mp4' | 'mkv';
  bitRate?: number;
  crop?: string;
  windowTitle?: string;
  maxSize?: number;
}

class ScrcpyService {
  async launch(opts: ScrcpyOptions): Promise<{pid: number}>;
  //  拼接参数 → scrcpy.exe(独立窗口,不由 Electron 管理)
  //  或:--no-window + 启动 electron 子窗口渲染(复杂,M2 先用独立窗口)
  
  async stop(pid: number): Promise<void>;
  async listRunning(): Promise<{pid: number; opts: ScrcpyOptions}[]>;
}
```

### 6.14 ResourceService(资源完整性)

**职责**:替代 `checkfile.bat`,但用 MD5 manifest 而非 .backup 副本。

```typescript
class ResourceService {
  // 启动时校验所有 bin/ 文件的 MD5
  async verify(): Promise<{file: string; ok: boolean; expected: string; actual: string}[]>;
  //  读 resources/data/manifest.json(打包时生成)
  //  遍历 resources/bin/*,计算 MD5,比对
  
  // 重新生成 manifest(开发用)
  async generateManifest(): Promise<void>;
  
  // 修复(从云端重新下载损坏的文件)
  async repair(file: string): Promise<void>;
}
```

### 6.15 DriverService(驱动检测)

**职责**:替代 `checkdriver.bat`。

```typescript
class DriverService {
  async check(): Promise<{
    adb: boolean;
    qualcomm9008: boolean;
    vcRuntime: boolean;
  }>;
  //  adb: pnputil /enum-drivers | find android_winusb.inf
  //  qualcomm9008: pnputil | find qdbusb / qcfilter / qcmbn
  //  vcRuntime: 检查 mfc100/110/120
  
  async installDrivers(): Promise<void>;
  //  解压 drivers.zip → pnputil /add-driver xxx.inf /install
  //  VC 运行库:静默安装 vc_redist.exe
}
```

### 6.16 AtbmodService(.atbmod 模块)

**职责**:替代 `Loadatbmod.bat`,加载社区扩展模块。

```typescript
interface AtbmodManifest {
  modid: string;
  modname: string;
  modversion: string;
  modversioncode: number;
  modtype: string;
}

class AtbmodService {
  async scan(): Promise<string[]>;              // 扫描 *.atbmod 文件
  async load(file: string): Promise<AtbmodManifest>;
  async install(file: string): Promise<void>;   // 7z 解压 → 执行 install.bat/exe
  async listInstalled(): Promise<AtbmodManifest[]>;
  async uninstall(modid: string): Promise<void>;
}
```

---

## 7. 数据模型与类型定义

### 7.1 设备相关

```typescript
// src/types/device.ts
export type DeviceType = 'adb' | 'fastboot' | 'qcom_edl' | 'sprd_edl' | 'emulator' | 'unauthorized' | 'offline';

export interface DeviceInfo {
  type: DeviceType;
  serial: string;
  port?: string;                  // 9008 的 COM 端口
  innermodel?: string;
  model?: string;
  androidVersion?: string;
  sdkVersion?: string;
  softVersion?: string;
  isV3?: boolean;
  innermodelName?: string;        // 如 'Z7' = innermodel 'I25'
  platform?: 'otherpash' | 'v3pash' | 'z10';
  connectedAt?: number;
}
```

### 7.2 型号映射(从 innermodel.bat 转换)

```typescript
// resources/data/models.json
[
  {
    "series": "Z",
    "model": "Z7",
    "innermodel": "I25",
    "soc": "MSM8937",
    "platform": "v3pash",
    "firehose": "msm8937.mbn",
    "allxml": "I25.xml",
    "miscXml": "misc_I25.xml",
    "miscImgExt": "img",
    "rootable": true,
    "android": "8.1",
    "sdk": 27,
    "notes": ""
  },
  {
    "series": "Z",
    "model": "Z2",
    "innermodel": "I12",
    "soc": "MSM8909W",
    "platform": "otherpash",
    "firehose": "msm8909w.mbn",
    "allxml": null,                // 不支持 9008 备份
    "miscXml": "misc_I12.xml",
    "miscImgExt": "mbn",
    "rootable": true,
    "android": "4.4 / 7.1",
    "sdk": [19, 25],
    "notes": ""
  }
  // ... 完整 60+ 型号
]
```

### 7.3 V3 阈值(从 isv3.bat 转换)

```typescript
// resources/data/isv3-thresholds.json
[
  {"innermodel": "ND07", "minSoftVersion": "1.5.1", "model": "Z8A"},
  {"innermodel": "ND01", "minSoftVersion": "3.3.2", "model": "Z9"},
  {"innermodel": "I32",  "minSoftVersion": "3.1.0", "model": "Z8"},
  {"innermodel": "I25D", "minSoftVersion": "1.5.8", "model": "Z7S"},
  {"innermodel": "I25C", "minSoftVersion": "1.9.1", "model": "Z7A"},
  {"innermodel": "I25",  "minSoftVersion": "2.5.1", "model": "Z7"},
  {"innermodel": "I20",  "minSoftVersion": "2.8.1", "model": "Z6巅峰"}
]
```

### 7.4 下载链接(从 link.bat 转换)

```typescript
// resources/data/links.json
{
  "mirrors": [
    "https://mirror1.xgj.qzz.io/atb/",
    "https://mirror2.xgj.qzz.io/atb/",
    "https://mirror3.xgj.qzz.io/atb/",
    "https://mirror4.xgj.qzz.io/atb/"
  ],
  "resources": {
    "userdata":    {"filename": "userdata.img",  "required": true,  "extract": false},
    "apks":        {"filename": "apks.zip",      "required": true,  "extract": true, "extractTo": "apks/"},
    "xtcpatch":    {"filename": "xtcpatch.zip",  "required": true,  "extract": false},
    "systemui":    {"filename": "systemui.zip",  "required": true,  "extract": false},
    "twrp":        {"filename": "twrp.zip",      "required": false, "extract": true, "extractTo": "EDL/twrp/"},
    "xp":          {"filename": "xp.zip",        "required": false, "extract": false},
    "rootproapks": {"filename": "rootproapks.zip","required": false,"extract": true, "extractTo": "rootproapks/"},
    "drivers":     {"filename": "drivers.zip",   "required": false, "extract": true, "extractTo": "drivers/"},
    "bin":         {"filename": "bin.zip",       "required": false, "extract": false, "note": "工具箱自更新"},
    "I12":         {"filename": "I12.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "IB":          {"filename": "IB.zip",        "required": false, "extract": true, "extractTo": "EDL/"},
    "I13":         {"filename": "I13.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "I13C":        {"filename": "I13C.zip",      "required": false, "extract": true, "extractTo": "EDL/"},
    "I16":         {"filename": "I16.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "I17":         {"filename": "I17.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "I17D":        {"filename": "I17D.zip",      "required": false, "extract": true, "extractTo": "EDL/"},
    "I18":         {"filename": "I18.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "I19":         {"filename": "I19.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "I20":         {"filename": "I20.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "I25":         {"filename": "I25.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "I25C":        {"filename": "I25C.zip",      "required": false, "extract": true, "extractTo": "EDL/"},
    "I25D":        {"filename": "I25D.zip",      "required": false, "extract": true, "extractTo": "EDL/"},
    "I32":         {"filename": "I32.zip",       "required": false, "extract": true, "extractTo": "EDL/"},
    "ND01":        {"filename": "ND01.zip",      "required": false, "extract": true, "extractTo": "EDL/"},
    "ND03":        {"filename": "ND03.zip",      "required": false, "extract": true, "extractTo": "EDL/"},
    "ND07":        {"filename": "ND07.zip",      "required": false, "extract": true, "extractTo": "EDL/"}
  },
  "versionFiles": {
    "versiontmp":     "versiontmp.txt",
    "versionnotice":   "versionnotice.txt",
    "notice":          "notice.txt",
    "resversion":      "resversion.txt"
  }
}
```

### 7.5 菜单定义(代码内,不读 JSON)

> 2026-06-18 重新定位:菜单选项写死在 `src/lib/menus.ts`,不再读 `resources/menus/*.json`。
> 原 33 个 JSON 降级为"参考文档",确保功能覆盖完整(不漏功能),但字段/文案/分组可自由调整。

```typescript
// src/lib/menus.ts
import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export interface MenuItem {
  /** 选项值(对应原 JSON 的 value,业务逻辑可能依赖) */
  value: string;
  /** 显示文案 */
  label: string;
  /** 描述 */
  description?: string;
  /** 图标(lucide-react 组件) */
  icon: ComponentType<LucideProps>;
  /** 是否危险操作(红色高亮) */
  danger?: boolean;
  /** 跳转路由 */
  to?: string;
  /** 是否未实现 */
  disabled?: boolean;
  /** 里程碑标识 */
  milestone?: string;
}

// 主菜单(对应原 main.json,10 个选项)
export const MAIN_MENU: MenuItem[] = [
  { value: '1', label: '一键 Root 设备', description: '通过 ADB 或 EDL 模式 Root 手表', icon: ShieldAlert, danger: true, to: '/root', disabled: true, milestone: 'M4' },
  { value: '2', label: '在此处打开 CMD', description: '打开含 adb 环境的命令行', icon: TerminalSquare, disabled: true, milestone: 'M2' },
  { value: '3', label: '关于脚本', description: '版本信息与作者', icon: Info, to: '/settings' },
  // ... 其余 7 项
];

// 其他菜单(commonly/rebootpro/appset/magisk/settings/scripttool/root)同理定义
// 详见 src/lib/menus.ts

/** 按 name 获取菜单 */
export function getMenu(name: string): MenuItem[] { /* ... */ }
```

**约束**:
- 菜单选项的 `value` 必须与原 JSON 一致(业务逻辑可能依赖,如 `rebootpro` 的 1-9 对应 9 种重启模式)
- 菜单覆盖的功能必须与原项目一致(不漏功能)
- 但 `label` / `description` / `icon` / 分组 / 顺序可自由调整(UI 层)
- 原 JSON 文件不再打包,仅作为开发时的参考

### 7.6 IPC 类型(主进程与渲染进程共享)

```typescript
// electron/ipc/types.ts(通过 alias 同时被 src/types/ipc.ts 引用)
export interface IpcRequest {
  'device:detect': { types: DeviceType[]; timeout?: number };
  'device:current': void;
  'device:wait': { types: DeviceType[]; timeout?: number };
  
  'root:start': { options: RootOptions };
  'root:cancel': { taskId: string };
  'root:pause': { taskId: string };
  'root:resume': { taskId: string };
  'root:status': { taskId: string };
  
  'reboot:execute': { mode: RebootMode; innermodel?: string };
  
  'magisk:list': void;
  'magisk:install': { zip: string; method: InstallMethod };
  'magisk:uninstall': { id: string; method: UninstallMethod };
  'magisk:enable': { id: string };
  'magisk:disable': { id: string };
  'magisk:store-search': { query: string };
  
  'app:install': { apk: string; method?: InstallMethod };
  'app:install-multiple': { apks: string[]; method?: InstallMethod };
  'app:uninstall': { pkg: string };
  'app:list': { thirdParty?: boolean };
  'app:enable-autostart': { packages: string[] };
  'app:unlock-z10': void;
  
  'backup:backup': { type: BackupType; outputPath?: string; innermodel?: string };
  'backup:recover': { type: BackupType; inputPath: string };
  'backup:flash-firmware': { folder: string };
  'backup:flash-twrp': { innermodel: string };
  'backup:auto-flash-twrp': { innermodel: string };
  
  'cloud:list': void;
  'cloud:check-updates': void;
  'cloud:download': { name: string };
  'cloud:download-multiple': { names: string[] };
  'cloud:check-app-update': void;
  
  'scrcpy:launch': { opts: ScrcpyOptions };
  'scrcpy:stop': { pid: number };
  'scrcpy:list': void;
  
  'system:pick-file': { kind: 'open' | 'folder'; filter?: string; multi?: boolean };
  'system:open-external': { path: string };
  'system:show-in-folder': { path: string };
  'system:get-settings': void;
  'system:set-settings': { settings: Partial<Settings> };
  'system:get-logs': { date?: string };
  'system:verify-resources': void;
  'system:check-drivers': void;
  'system:install-drivers': void;
  
  'log:subscribe': void;
  'log:unsubscribe': void;
}

export interface IpcResponse {
  'device:detect': DeviceInfo | null;
  'device:current': DeviceInfo | null;
  'device:wait': DeviceInfo;
  
  'root:start': { taskId: string };
  'root:cancel': void;
  'root:status': RootContext;
  
  // ...每个请求都有对应响应
}

export interface IpcEvents {
  'log:line': (entry: LogEntry) => void;
  'device:change': (info: DeviceInfo | null) => void;
  'root:stage-change': (ctx: RootContext) => void;
  'cloud:progress': (data: {name: string; progress: number}) => void;
  'scrcpy:exit': (data: {pid: number; code: number}) => void;
}
```

---

## 8. IPC 通道设计

### 8.1 通道命名规范

- `<域>:<动作>` 格式,如 `device:detect`、`root:start`
- 请求-响应用 `ipcMain.handle` / `ipcRenderer.invoke`
- 事件推送用 `webContents.send` / `ipcRenderer.on`

### 8.2 preload.ts 暴露

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  device: {
    detect: (types, timeout?) => ipcRenderer.invoke('device:detect', {types, timeout}),
    current: () => ipcRenderer.invoke('device:current'),
    wait: (types, timeout?) => ipcRenderer.invoke('device:wait', {types, timeout}),
    onChange: (cb) => {
      const handler = (_, info) => cb(info);
      ipcRenderer.on('device:change', handler);
      return () => ipcRenderer.removeListener('device:change', handler);
    },
  },
  root: {
    start: (options) => ipcRenderer.invoke('root:start', {options}),
    cancel: (taskId) => ipcRenderer.invoke('root:cancel', {taskId}),
    pause: (taskId) => ipcRenderer.invoke('root:pause', {taskId}),
    resume: (taskId) => ipcRenderer.invoke('root:resume', {taskId}),
    onStageChange: (cb) => {
      const handler = (_, ctx) => cb(ctx);
      ipcRenderer.on('root:stage-change', handler);
      return () => ipcRenderer.removeListener('root:stage-change', handler);
    },
  },
  // ... 其他域
  log: {
    subscribe: () => ipcRenderer.invoke('log:subscribe'),
    onLine: (cb) => {
      const handler = (_, entry) => cb(entry);
      ipcRenderer.on('log:line', handler);
      return () => ipcRenderer.removeListener('log:line', handler);
    },
  },
  system: {
    pickFile: (opts) => ipcRenderer.invoke('system:pick-file', opts),
    openExternal: (path) => ipcRenderer.invoke('system:open-external', {path}),
    showInFolder: (path) => ipcRenderer.invoke('system:show-in-folder', {path}),
    getSettings: () => ipcRenderer.invoke('system:get-settings'),
    setSettings: (settings) => ipcRenderer.invoke('system:set-settings', {settings}),
    verifyResources: () => ipcRenderer.invoke('system:verify-resources'),
    checkDrivers: () => ipcRenderer.invoke('system:check-drivers'),
    installDrivers: () => ipcRenderer.invoke('system:install-drivers'),
  },
});
```

### 8.3 渲染进程封装

```typescript
// src/lib/api.ts
declare global {
  interface Window {
    api: {
      device: {...};
      root: {...};
      // ...
    };
  }
}

export const api = window.api;
```

### 8.4 安全

- `contextIsolation: true`(必须)
- `nodeIntegration: false`
- `sandbox: true`
- preload 仅暴露白名单 API,不暴露 `ipcRenderer` 本身
- CSP 严格限制,渲染进程不加载远程资源(除 4 个镜像站)

---

## 9. 前端架构与状态管理

### 9.1 路由

```typescript
// src/App.tsx
<Router>
  <AppShell>
    <Routes>
      <Route path="/" element={<Home/>}/>
      <Route path="/device" element={<Device/>}/>
      <Route path="/root" element={<Root/>}/>
      <Route path="/reboot" element={<Reboot/>}/>
      <Route path="/cloud" element={<Cloud/>}/>
      <Route path="/apps" element={<Apps/>}/>
      <Route path="/magisk" element={<Magisk/>}/>
      <Route path="/backup" element={<Backup/>}/>
      <Route path="/tools" element={<Tools/>}/>
      <Route path="/settings" element={<Settings/>}/>
      <Route path="/logs" element={<Logs/>}/>
    </Routes>
  </AppShell>
  <CommandPalette/>
  <LogConsole/>
</Router>
```

### 9.2 状态分层

| Store | 内容 | 持久化 |
|---|---|---|
| `deviceStore` | 当前设备信息、连接状态 | 否(运行时) |
| `taskStore` | 当前任务(root/scrcpy/backup)、进度、可取消 | 否 |
| `logStore` | 日志环形缓冲(5000 条) | 否(运行时) |
| `settingsStore` | 用户设置(快速启动/检查更新间隔/窗口透明度/默认安装方式) | 是(electron-store) |
| `resourceStore` | 资源版本、缓存状态 | 部分(electron-store) |

### 9.3 TanStack Query 用途

- 设备属性查询(`useDevice` → 5 秒刷新一次)
- 资源列表/版本(`useCloudResources`)
- 已安装模块列表(`useMagiskModules`,手动 invalidate)
- 已安装应用列表(`usePackages`)

### 9.4 关键组件

#### AppShell(整体布局)

```
┌──────────────────────────────────────────────────────────┐
│  TopBar: [logo] iMooDesktop  [设备状态: Z7 I25 adb]  [è®¾ç½®] │  ← sticky top
├────────┬─────────────────────────────────────────────────┤
│        │                                                 │
│ Side   │                                                 │
│ bar    │            Main Content (Route)                │
│        │                                                 │
│ 主菜单 │                                                 │
│ 设备   │                                                 │
│ Root   │                                                 │
│ 重启   │                                                 │
│ 资源   │                                                 │
│ 应用   │                                                 │
│ Magisk │                                                 │
│ 备份   │                                                 │
│ 工具   │                                                 │
│ 设置   │                                                 │
│        │                                                 │
├────────┴─────────────────────────────────────────────────┤
│  LogConsole (可折叠,默认收起)  [▶ 显示日志]              │  ← sticky bottom
├──────────────────────────────────────────────────────────┤
│  Footer: v1.0 · 免责声明 · 作者 · QQ群                    │  ← sticky bottom
└──────────────────────────────────────────────────────────┘
```

- 整体 `min-h-screen flex flex-col`
- TopBar `sticky top-0`
- Sidebar `sticky top-[56px] self-start` 高度 `calc(100vh - 56px - footer)`
- LogConsole `sticky bottom-0`,默认 `h-8`,展开 `h-64`
- Footer `mt-auto`

#### CommandPalette(Ctrl+K)

- 用 shadcn `<CommandDialog>`
- 索引:所有菜单项 + 所有路由 + 快速操作(检测设备/重启至 fastboot/打开日志目录)
- 支持中文拼音搜索(用 `pinyin-pro` 库)

#### LogConsole

- 底部固定,可拖拽调整高度
- 等宽字体,ANSI 颜色(`ansi-to-html`)
- 按任务过滤(顶部 chip)
- 自动滚动到底,有新日志时若用户在底部则跟随,否则显示"↓ 新日志"提示
- 复制/导出按钮
- 日志级别过滤(debug/info/warn/error)

#### RootWizard

- 分步骤 UI,左侧显示当前 stage,右侧显示日志
- 每个 stage 有进度条 + 状态图标(进行中/完成/失败)
- 暂停/取消按钮常驻
- 失败时显示错误 + 重试按钮
- 关键步骤(如刷 boot)前显示二次确认

---

## 10. 资产迁移映射表

### 10.1 直接复用(零改造)

| 原路径 | 新路径 | 说明 |
|---|---|---|
| `bin/adb.exe` + DLLs | `resources/bin/adb.exe` + DLLs | ADB 工具 |
| `bin/fastboot.exe` | `resources/bin/fastboot.exe` | Fastboot |
| `bin/QSaharaServer.exe` | `resources/bin/QSaharaServer.exe` | 9008 引导 |
| `bin/fh_loader.exe` | `resources/bin/fh_loader.exe` | 9008 读写 |
| `bin/qfh_loader.exe` | ~~`resources/bin/qfh_loader.exe`~~ | **不打包**(已合并到 fh_loader.exe,见核心约束) |
| `bin/magiskboot.exe` | `resources/bin/magiskboot.exe` | Magisk boot |
| `bin/7z.exe` + `7z.dll` | `resources/bin/7z.exe` + `7z.dll` | 压缩 |
| `bin/aria2c.exe` | `resources/bin/aria2c.exe` | 下载 |
| `bin/busybox.exe` | `resources/bin/busybox.exe` | Unix 工具 |
| `bin/lsusb.exe` | `resources/bin/lsusb.exe` | USB 列表(可选,优先用 node-usb) |
| `bin/scrcpy.exe` + scrcpy-server + DLLs | `resources/bin/scrcpy.exe` + ... | 投屏 |
| `bin/magiskinit21` | `resources/bin/magiskinit21` | Magisk 21 init |
| `bin/magiskinit25` | `resources/bin/magiskinit25` | Magisk 25 init |
| `bin/libmagisk32.so` | `resources/bin/libmagisk32.so` | Magisk 运行时 |
| `bin/magisk32.xz` | `resources/bin/magisk32.xz` | ramdisk 嵌入 |
| `bin/magisk25.apk` | `resources/bin/magisk25.apk` | Magisk Manager |
| `bin/711_adbd` | `resources/bin/711_adbd` | Android 7.1 adbd |
| `bin/810_adbd` | `resources/bin/810_adbd` | Android 8.1 adbd |
| `bin/xse.rc` | `resources/bin/xse.rc` | SELinux 覆盖 |
| `bin/EDL/allxml/*.xml`(9个) | `resources/edl/allxml/*.xml` | 分区表 |
| `bin/EDL/misc/*.xml`(14个) | `resources/edl/misc/*.xml` | misc 指令 |
| `bin/EDL/misc/{misc,ffbm,wipe,fastbootd}.img` | `resources/edl/misc/*.img` | misc 镜像 |
| `bin/EDL/msm8909w.mbn` | `resources/edl/msm8909w.mbn` | firehose 8909 |
| `bin/EDL/msm8937.mbn` | `resources/edl/msm8937.mbn` | firehose 8937 |
| `bin/EDL/prog_firehose_ddr.elf` | `resources/edl/prog_firehose_ddr.elf` | firehose 64位 |
| `bin/EDL/reboot.xml` | `resources/edl/reboot.xml` | 重启指令 |
| `bin/tmp/eboot.img` | `resources/edl/cache/eboot.img` | 33MB 全零(目录改名见 2.5.1) |
| `bin/menu/*.json`(33个) | (不打包,降级为参考) | 菜单选项写死在 `src/lib/menus.ts`,UI 自由设计(见 7.5 节) |
| `bin/*.sh`(8个) | `resources/scripts/*.sh`(5 个改名,3 个保留,见 2.5.2) | push 到设备 |
| `bin/switch.db` | `resources/data/switch.db` | Z10 限制解除 |
| `bin/build.txt` | `resources/data/build-props.json`(转换) | 89 个 prop 字段 |

### 10.2 转换后复用

| 原路径 | 新路径 | 转换内容 |
|---|---|---|
| `bin/innermodel.bat` | `resources/data/models.json` | 提取 Z/D/Q/N/U/Y → innermodel 映射,补充 soc/platform/firehose 字段 |
| `bin/isv3.bat` | `resources/data/isv3-thresholds.json` | 提取 innermodel → softversion 阈值 |
| `bin/link.bat` | `resources/data/links.json` | 提取 4 镜像 head + 26 文件名映射 |
| `bin/settings/resversion.txt` | `resources/data/resversion.json` | 转为 JSON |
| `bin/menu/*.json` | (不打包) | 菜单选项写死在 `src/lib/menus.ts`(2026-06-18 重新定位,见 7.5 节) |

### 10.3 废弃(用 Node/TS 重写)

| 原 .exe / .bat | 替代实现 |
|---|---|
| `AllToolBox.exe` | Electron 主进程 |
| `menu.exe` + `c_prompt_toolkit.dll` | React `<MenuRenderer/>` 组件 |
| `device_check.exe` | `DeviceService.ts`(adb devices + node-usb) |
| `timer.exe` | `lib/timer.ts`(`time.monotonic` 等价) |
| `progress.exe` | `<TaskProgress/>` + SubprocessPool 流式输出 |
| `pause.exe` | React `<ConfirmDialog/>` / shadcn `<AlertDialog/>` |
| `ground_glass.exe` | `BrowserWindow.setOpacity()`(简化,不调 Windows Terminal) |
| `filedialog.exe` | Electron `dialog.showOpenDialog()` |
| `atblogo.exe` | React `<Logo/>` 组件 + SVG |
| `run_cmd.exe` | `shlex` 等价 → 用 `string-argv` 或自写解析 |
| `patch_boot.exe` | `BootPatcher.ts`(4 条正则) |
| `color.bat` | Tailwind 颜色类 |
| `checkfile.bat` | `ResourceService.verify()`(MD5 manifest) |
| `checkdriver.bat` | `DriverService.ts` |
| `check_res.bat` | `CloudService.checkUpdates()` |
| `cloud.bat` | `CloudService.ts` |
| `link.bat` | `links.json` 静态数据 |
| `curltool.bat` | `lib/download.ts`(aria2c subprocess) |
| `nutime.bat` | `Date.now()` |
| `number.bat` | `str.replace(/\D/g, '')` |
| `sel.bat` | Electron `dialog.showOpenDialog()` |
| `loadatbmod.bat` | `AtbmodService.ts` |
| `upall.bat` / `uplog.bat` / `runupall.bat` | `UpdateService.ts`(electron-updater) |

### 10.4 合并/重写

| 原 .bat 系列 | 新服务 | 说明 |
|---|---|---|
| `root.bat` + `ROOT-SDK19/25/27.bat` + `nd03root.bat` + `nd08root.bat` + `isv3.bat` + `magiskpatch.bat` + `automagisk.bat` + `autosystemplus.bat` | `RootService.ts` + `BootPatcher.ts` + `MagiskPatcher.ts` | 状态机统一管理 |
| `rebootpro.bat` + 9 个 reboot 分支 | `RebootService.ts` | 单一入口 |
| `userinstapp.bat` + `instapp.bat` + `unapp.bat` + `qqwxautestart.bat` + `z10openinst.bat` | `AppService.ts` | 统一应用管理 |
| `userinstmodule.bat` + `instmodule.bat` + `userunmodule.bat` + `unmodule.bat` + `magisklist.bat` + `setmagisk.bat` + `xtcpatch.bat` + `modulestore.bat` | `MagiskService.ts` | 统一模块管理 |
| `backup.bat` + `super_recovery.bat` + `pashtwrp.bat` + `pashtwrppro.bat` + `write_md5.bat` | `BackupService.ts` + `ResourceService.ts` | 备份/恢复/资源校验分离 |
| `ota.bat` + `opencharge.bat` + `Xposed.bat` + `listbuild.bat` + `innermodel.bat` + `pashroot.bat` + `rootpro.bat` | 散落到对应 Service 或独立 Route | 按功能归类 |
| `scrcpy-ui.bat` + `scrcpy-noconsole.vbs` | `ScrcpyService.ts` | 子进程管理 |
| `wifiadb.bat` + `adbdevice.bat` + `edlport.bat` + `boot_completed.bat` | `AdbService.ts` + `DeviceService.ts` | 设备/连接管理 |
| `start.bat` + `speedstart.bat` + `logo.bat` + `thank.bat` + `main.bat` | Electron `main.ts` + React `<App/>` | 启动流程 |

---

## 11. 开发阶段划分(M1–M6)

### M1:基础架构 + 设备检测(1 周)

**目标**:可运行的 Electron 应用,能检测设备并显示状态。

**范围**:
- Electron + Vite + React + TS + Tailwind + shadcn/ui 脚手架
- 主进程骨架:`main.ts` / `preload.ts` / `ipc/index.ts`
- `SubprocessPool` / `Logger` / `paths` / `config`
- `DeviceService`(检测 adb/fastboot/9008)
- `AdbService`(基础:devices/shell/getprop/install/uninstall/push/pull/reboot)
- `FastbootService`(基础:devices/flash/erase/reboot)
- 渲染进程:`AppShell` / `TopBar` / `Sidebar` / `Footer` / `LogConsole` / `CommandPalette`
- 路由:`Home` / `Device` / `Settings`
- 资源迁移:把 `bin/*.exe` 复制到 `resources/bin/`
- 资源校验:`ResourceService.verify()`(MD5 manifest)

**交付**:
- 双击启动,显示主菜单(读 `menus/main.json`)
- 顶部设备状态条实时显示连接的设备
- 底部日志面板显示 adb 调用日志
- 设置页可调窗口透明度/快速启动

### M2:常用功能 + 高级重启(1 周)

**目标**:替代原"常用功能"菜单 + "高级重启"菜单。

**范围**:
- `RebootService`(9 种模式)
- `CloudService`(下载/版本管理)
- `ScrcpyService`(投屏)
- `AppService`(基础:install/uninstall/list)
- `AdbService` 高级(root/listPackages/amStart/inputTap/inputSwipe/setProp)
- 渲染进程:`Reboot` / `Cloud` / `Apps` / `Tools` 路由
- `MenuRenderer` 通用组件(读 JSON 渲染)
- `FilePicker`(替代 filedialog.exe)
- `DisclaimerModal`(启动免责声明)
- `ConnectGuide`(连接引导,带图)

**交付**:
- 高级重启 9 种模式全可用
- scrcpy 投屏可启动/停止
- 应用安装/卸载/列表可用
- 资源下载可勾选/进度显示
- 内部型号对照表可查(读 models.json)

### M3:Magisk 模块管理 + 备份恢复(1 周)

**目标**:替代原"Magisk 模块管理"菜单 + "备份与恢复"菜单。

**范围**:
- `MagiskService`(list/install/uninstall/enable/disable)
- `BackupService`(dcim/edl-9008/adb-dd)
- `EdlService`(loadFirehose/flashPartitions/readPartitions/reboot/findPort/parseAllXml)
- 渲染进程:`Magisk` / `Backup` 路由
- `ModuleList` / `ModuleCard` 组件
- 备份/恢复向导(分步骤)

**交付**:
- Magisk 模块列表显示(含状态)
- 模块安装(单/多/文件夹,3 种方式)
- 模块卸载(3 种方式)
- DCIM 备份/恢复
- 9008 备份/恢复(支持 9 个型号)
- ADB-dd 备份/恢复(需 root)
- TWRP 刷入(EDL + 开机自刷两种方式)

### M4:Root 全流程(2 周)—— 最关键

**目标**:替代 `root.bat` + `ROOT-SDK19/25/27.bat` + `nd03root.bat`。

**范围**:
- `BootPatcher`(patch_boot.exe 重写,4 条正则)
- `MagiskPatcher`(magiskpatch.bat 重写,magiskboot 流程)
- `RootService`(状态机,所有 stage)
- 渲染进程:`Root` 路由 + `RootWizard`
- 型号选择器(可搜索,带图标)
- 实时进度(每个 stage)
- 暂停/取消/重试

**子阶段**:
- **M4.1**(3 天):BootPatcher + MagiskPatcher 单元测试通过(用真实 boot.img fixture)
- **M4.2**(3 天):SDK19 + SDK25 流程(简单分支)
- **M4.3**(4 天):SDK27 流程(最复杂,含 smodel=1 分支)
- **M4.4**(2 天):ND03(Z10)流程

**交付**:
- 一键 Root 完整流程,支持全部 15 个型号
- 不刷 userdata 选项可用
- V3 协议自动检测
- 失败时显示错误详情 + 建议的恢复操作

### M5:模块商店 + 收尾功能(1 周)

**目标**:完成剩余功能,**按 2.4 节修复已知 bug,业务逻辑严格保留原行为**。

**范围**:
- `MagiskService.storeSearch/installFromStore`(对应 modulestore.bat,**已修复 modapi.exe bug**,对接 Magisk 官方 API 或保留不可用状态)
- `AppService.unlockZ10Install`(Z10 限制解除)
- `AppService.enableAutoStart`(QQ/微信开机自启)
- `BackupService.flashFirmware`(超级恢复)
- `ota.bat` → `OtaService`(离线 OTA)
- `Xposed.bat` → `XposedService`
- `rootpro.bat` → 集成到 `RootService` 末尾询问
- `DriverService`(驱动检测/安装)
- `AtbmodService`(.atbmod 模块)
- `UpdateService`(electron-updater 自更新)

**交付**:
- 所有原功能 100% 覆盖(**逻辑保真度审查全部通过**)
- 模块商店**保留原"不可用"状态**(对应原 modapi.exe 不存在的行为,不主动对接 Magisk API)
- 自更新检查可用

### M6:打磨 + 打包(1 周)

**目标**:生产可用。

**范围**:
- UI 打磨:动画/过渡/空状态/错误状态
- 性能:日志缓冲优化、大列表虚拟化
- 国际化(可选,i18n 预留)
- 主题:亮/暗(原版只有暗,可保留暗为主)
- electron-builder 配置:NSIS 安装包 + 自动更新
- 签名(若有证书)
- 用户文档(README + 内置帮助页)
- Agent Browser 自验证所有流程

**交付**:
- Windows 安装包(.exe)
- 便携版(.zip,免安装)
- 完整用户文档

---

## 12. 各阶段验收标准

### M1 验收

- [ ] `bun run dev` 启动,Electron 窗口正常显示
- [ ] 主菜单渲染 `menus/main.json`,点击可跳转
- [ ] 连接 ADB 设备后,顶部状态条 1 秒内显示设备信息
- [ ] 连接 Fastboot 设备,状态条正确显示
- [ ] 9008 模式设备,状态条显示 COM 端口
- [ ] 底部日志面板显示 adb 命令输出(GBK 中文正确)
- [ ] Ctrl+K 命令面板可用
- [ ] 设置页可调整窗口透明度
- [ ] 资源完整性校验:删除一个 .exe 后启动有警告

### M2 验收

- [ ] 高级重启 9 种模式在 ADB/Fastboot/9008 三种设备状态下都可用
- [ ] scrcpy 投屏可启动,可调整 18 个参数
- [ ] 应用安装:单/多/文件夹三种选择方式
- [ ] 应用卸载:列表选择,批量卸载
- [ ] 资源下载:4 镜像自适应,断点续传,进度显示
- [ ] 资源版本:本地 vs 云端对比,有更新提示
- [ ] 型号对照表:可搜索,显示 Z/D/Q/N/U/Y 全系列

### M3 验收

- [ ] Magisk 模块列表:显示 id/name/version/author/status/description
- [ ] 模块安装:3 种方式(magisk/shinst/peremptory)都可用
- [ ] 模块卸载:3 种方式(mark/direct/script)都可用
- [ ] 模块启用/禁用
- [ ] DCIM 备份/恢复:进度显示
- [ ] 9008 备份:9 个型号各能完整备份(产出 zip 含 rawprogram0.xml + 所有 .img)
- [ ] 9008 恢复:从 zip 完整恢复
- [ ] ADB-dd 备份/恢复(需 root 设备)
- [ ] TWRP 刷入:EDL 模式 + 开机自刷两种方式

### M4 验收(关键)

- [ ] **逻辑保真度审查(强制)**:每个 Root stage 都有 `docs/fidelity/root.md` 逐行对照表,核对原 `root.bat` / `ROOT-SDK19.bat` / `ROOT-SDK25.bat` / `ROOT-SDK27.bat` / `nd03root.bat` / `isv3.bat` / `magiskpatch.bat` / `automagisk.bat` / `autosystemplus.bat`
- [ ] **原 Bug 已修复**:`instmodule2.bat` 改为 `instmodule.bat`、`patch_boot.exe` 输出 `success`、`misc_ND07.xml` encoding 修正、`backup_9008.json` 补全 Z2/Z3、命令面板替代 `search`
- [ ] **彩蛋文案保留**:SDK=11 提示、Z11 提示保留(作者意图,非 bug)
- [ ] **字符串核对**:`adb`/`fastboot`/`fh_loader`/`QSaharaServer`/`magiskboot` 参数逐字一致(包括 `--sendxml=` 等号、`-s 13:` 空格等)
- [ ] **SDK19(Z2/Z3 老固件)**:fastboot flash boot 流程成功,设备开机后 Magisk Manager 可用
- [ ] **SDK25 BOOT 方案**:EDL 读 boot → 修补 → 刷 boot → 二次 EDL 刷 recovery+misc → 开机 Root 成功
- [ ] **SDK25 Recovery 方案**:EDL 读 boot → 修补 → 刷 recovery+misc → 重启进 recovery 应用 Root
- [ ] **SDK27 普通分支(Z6巅峰/Z7/Z7S/Z8/Z8A/Z9)**:EDL 读 boot → 修补(810_adbd+xse.rc+magisk32.xz)→ 刷 rawprogram+擦 boot → fastboot 刷 boot+userdata+misc → qmmi → 自动授权 → 装模块 → 完成
- [ ] **SDK27 smodel=1 分支(Z7A/I25C)**:刷 recovery+rawprogram 路径正确
- [ ] **ND03(Z10)**:281 恢复 + root 固件 + Dm.zip sideload + 3 次重启检测 + LSPosed 激活
- [ ] **不刷 userdata 选项**:流程在 rawprogram 刷入后正确退出
- [ ] **V3 协议检测**:7 个型号的阈值正确(与 `isv3.bat` 完全一致)
- [ ] **暂停/取消**:任意 stage 可暂停,取消后 DCIM 恢复
- [ ] **失败恢复**:模拟 patch_boot 失败(输出 `success` 以外的字符串),UI 显示错误 + 重试

### M5 验收

- [ ] **模块商店已修复**(对应原 modapi.exe bug):searchStore 可用(对接 Magisk 官方 API)或保留"不可用"状态(M5 阶段决定),不再抛错
- [ ] Z10 限制解除:push switch.db + setprop + 软重启 + 安装 z10apk
- [ ] QQ/微信开机自启:3 个包都能启用
- [ ] 超级恢复:选固件目录,自动检测 loader,逐个刷 rawprogram
- [ ] 离线 OTA:push zip + 启动 Activity + scrcpy 引导
- [ ] Xposed:SDK19/SDK25 两个分支
- [ ] 驱动检测/安装:ADB/9008/VC 三类驱动
- [ ] .atbmod 模块:扫描 + 安装 + 卸载
- [ ] 自更新:检查 + 下载 + 重启

### M6 验收

- [ ] Agent Browser 自验证:所有路由可访问,无白屏
- [ ] 亮/暗主题切换
- [ ] 大日志(10 万行)不卡顿
- [ ] 模块列表(1000+)虚拟化滚动
- [ ] NSIS 安装包:静默安装/卸载可用
- [ ] 便携版:解压即用
- [ ] 用户文档:README + 内置帮助

---

## 13. 风险登记与缓解策略

### R1:Root 流程回归测试无法进行(高风险)

**描述**:本环境无 Windows 真机,无法验证 Root 流程的正确性。

**缓解**:
- M4 阶段代码完成后,提供详细的真机测试 checklist
- BootPatcher / MagiskPatcher 用真实 boot.img fixture 做单元测试(从原 EDL/rooting/ 提取,迁移后路径为 resources/edl/work/)
- 状态机设计支持"重试当前 stage",真机出错时可从断点继续
- 关键参数(loader 选择/misc 内容/分区 XML)集中配置,便于真机调试时修改

### R2:GBK 编码处理(中风险)

**描述**:原 .exe 输出多为 GBK,subprocess 传递易乱码。

**缓解**:
- `SubprocessPool` 默认 `encoding: 'gbk'`,用 `iconv-lite` 解码
- adb shell 输出统一加 `LANG=C` 强制英文(避免设备端中文)
- 用户提示文字全部 UTF-8,渲染进程天然支持
- 日志文件统一 UTF-8(electron-log 默认)

### R3:9008 COM 端口检测(中风险)

**描述**:原 `edlport.bat` 用 `lsusb` + 字符串解析,Node 实现需跨平台兼容。

**缓解**:
- Windows:读注册表 `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM` 匹配 `\Device\QCBQN`
- 备选:`wmic path Win32_PnPEntity where "Name like '%Qualcomm%9008%'"` 解析 COM
- 备选:保留 `lsusb.exe` 作为 fallback
- 提供"手动输入 COM 端口"UI 选项

### R4:Electron 打包体积过大(低风险)

**描述**:80–100MB 安装包,用户可能抱怨。

**缓解**:
- 用 `electron-builder` 的 `asar` 打包,压缩资源
- `resources/bin/` 的大文件(adb 6.6MB / aria2c 5.6MB / run_cmd 6.5MB)→ run_cmd 已废弃,adb/aria2c 无法压缩
- 提供"便携版"(免安装 zip)+ "安装版"(NSIS)两种
- 首次启动后自动检查资源更新,按需下载(不预打包所有 EDL root zip)

### R5:自动点击 automagisk 兼容性(中风险)

**描述**:SDK27 的 `automagisk.bat` 用固定坐标(input tap 304 26 等)点击 Magisk Manager UI,不同版本 APK 坐标可能变化。

**缓解**:
- 保留坐标点击作为快速路径
- 失败时启动 scrcpy 让用户手动操作(原逻辑已有)
- M5 阶段研究用 `uiautomator2` 替代坐标点击(更稳定,但需设备端装 agent)

### R6:Qualcomm EDL 工具闭源升级(低风险)

**描述**:QSaharaServer/fh_loader 可能随 Qualcomm 更新而变化。

**缓解**:
- 锁定当前版本(1.3.8fix1 内的版本),不主动升级
- 若必须升级,单独测试 EDL 流程
- 长期可考虑迁移到开源 `bkerler/edl`(但兼容性待验证,非本计划范围)

### R7:Magisk 模块商店 API 不稳定(中风险)

**描述**:原 `modulestore.bat` 调用的 `modapi.exe` 已坏,自建 API 需要后端。

**缓解**:
- M5 阶段直接对接 Magisk 官方模块仓库(https://api.magiskmodule.com)
- 若官方 API 不可用,提供"从本地 zip 安装"作为主路径
- 长期可建镜像站(但非 MVP 范围)

### R9:逻辑偏差(最高风险,与 R1 并列)

**描述**:迁移过程中,开发者可能"顺手优化"或"自由发挥",导致新实现与原 `.bat` 业务逻辑不一致,引发真机变砖或 Root 失败。用户已明确指示"逻辑一点不能错,严禁瞎写或者自由发挥",并澄清"严禁瞎改的是 Root 步骤这种的业务逻辑,不是技术实现细节"。

**缓解**:
- 严格执行"核心约束:逻辑保真度"章节的审查流程
- 区分"业务逻辑"(禁止改)和"技术实现细节"(允许优化),见核心约束章节两表
- 每个 Service 必须有 `docs/fidelity/<service>.md` 逐行对照表
- 代码审查时,审查者必须打开原 `.bat` 逐行核对业务逻辑
- 任何边界模糊的改动,先记录到 `docs/fidelity/questions.md`,待用户确认后再决定
- 已知 bug 按 2.4 节修复方案处理(用户已批准),不保留原 bug 行为
- 真机回归测试时,若业务行为与原版有任何差异(除 2.4 节修复项外),视为 P0 bug,必须回滚

### R8:免责声明与法律风险(中风险)

**描述**:工具涉及 Root/刷机,可能被滥用。

**缓解**:
- 首次启动强制显示免责声明,用户必须勾选"已阅读并同意"才能使用
- Root 入口二次确认(显示风险清单)
- 明确禁止"强制解绑",代码中不实现任何解绑相关功能
- README 和应用内都标注"仅供个人学习"
- 保留原作者声明,不删除版权信息

---

## 14. 测试与验证策略

> 用户明确不写测试代码,但需要有测试思路。本节描述**验证方法**,不写 test 文件。

### 14.1 单元验证(关键服务)

| 服务 | 验证方法 |
|---|---|
| `BootPatcher` | 用真实 boot.img 的 kernel 文件 fixture,验证 4 条正则替换后字节正确 |
| `MagiskPatcher` | 用 SDK25/SDK27 的 boot.img fixture,验证 unpack→patch→repack 后的 SHA1 与原版一致 |
| `gbk.ts` | 编码解码往返测试(中文 + emoji + 控制字符) |
| `xml.ts` | 解析 9 个 allxml + 14 个 misc xml,验证分区数和 start_sector |
| `models.json` | 加载后验证 60+ 型号都有 innermodel + platform |

### 14.2 集成验证(主进程服务)

| 服务 | 验证方法 |
|---|---|
| `DeviceService` | 真机连接 ADB/Fastboot/9008,验证检测准确 |
| `AdbService` | 真机执行 install/uninstall/push/pull/reboot |
| `EdlService` | 真机 9008 模式执行 backup(读 allxml) |
| `CloudService` | 下载 userdata.img 验证 MD5 与云端一致 |
| `RootService` | **真机回归**(M4 验收标准) |

### 14.3 端到端验证(Agent Browser)

每个 milestone 完成后,用 Agent Browser 自验证:
- 打开应用,无白屏/控制台错误
- 主菜单可点击跳转
- 设备状态条正确显示
- 日志面板有输出
- 关键按钮可点击(不报错)

### 14.5 逻辑保真度审查(强制,每个 Service)

> 详见文档开头"核心约束:逻辑保真度"章节。此处仅列检查清单。

每个 Service 实现完成后,必须完成以下审查,否则不算完成:

1. **对照表完整**:`docs/fidelity/<service>.md` 已建立,原 `.bat` 每一行都有对应 TS 行
2. **逐行核对**:自我审查(若有第二人,交叉审查)
3. **字符串核对**:adb/fastboot/fh_loader/QSaharaServer/magiskboot 命令的参数、文件名、提示文案,逐字比对(注意 GBK 解码)
4. **分支核对**:所有 if/goto/for/call 分支都已复刻
5. **错误处理核对**:所有 errorlevel 检查、`||`、`&&` 都已复刻
6. **原 Bug 修复核对**:2.4 节列出的已知 bug 已按修复方案处理(`instmodule2`→`instmodule`、`Sucess`→`success`、`UTF_8`→`UTF-8`、模块商店修复、search 替代为命令面板、backup_9008 补全);彩蛋文案保留(作者意图)
7. **变量名核对**:原 `.bat` 的 `set` 变量都有对应 TS 变量,语义一致
8. **文件操作核对**:原 `del`/`md`/`copy`/`move`/`rd` 都已复刻(或确认在 TS 中行为等价并注释说明)
9. **暂停/超时核对**:原 `pause.exe`/`timeout`/`busybox sleep` 的时长和时机一致
10. **疑问记录**:所有不清晰的逻辑都已记录到 `docs/fidelity/questions.md`

审查未通过的 Service,不得进入下一个 milestone。

### 14.4 真机回归 checklist(M4 完成后)

```
□ Z2 (I12, SDK19) Root 成功
□ Z3 (IB, SDK19 或 SDK25) Root 成功
□ Z5A (I13C, SDK25) Root 成功
□ Z5Q (I13, SDK25) Root 成功
□ Z5Pro (I19, SDK25) Root 成功
□ Z6 (I18, SDK25) Root 成功
□ Z6巅峰 (I20, SDK27) Root 成功
□ Z7 (I25, SDK27) Root 成功
□ Z7A (I25C, SDK27, smodel=1) Root 成功(注明:可能不稳定)
□ Z7S (I25D, SDK27) Root 成功
□ Z8 (I32, SDK27) Root 成功
□ Z8A (ND07, SDK27) Root 成功
□ Z9 (ND01, SDK27) Root 成功
□ Z10 (ND03, nd03root) Root 成功
□ 不刷 userdata 选项(Z7)Root 成功
□ V3 协议检测(Z7 softversion≥2.5.1)正确
□ Root 失败后重试可用
□ Root 取消后 DCIM 恢复
```

---

## 15. 打包与发布

### 15.1 electron-builder 配置

```yaml
# electron-builder.yml
appId: io.xgj.imoodesktop
productName: iMooDesktop
copyright: Copyright © 2026 iMooDesktop Contributors
directories:
  output: dist
  buildResources: build
files:
  - electron/**/*
  - dist/**/*
  - resources/**/*
  - package.json
  - node_modules/**/*
asar: true
asarUnpack:
  - resources/bin/**        # .exe 不能在 asar 内,需解包
  - resources/edl/**
  - resources/scripts/**
win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  icon: build/icon.ico
  publisherName: iMooDesktop
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: iMooDesktop
portable:
  artifactName: ${productName}-${version}-portable.exe
publish:
  provider: generic
  url: https://releases.xgj.qzz.io/imoodesktop/
  channel: latest
```

### 15.2 资源打包策略

- `resources/bin/` 的 .exe 在 asar 外(`asarUnpack`),确保 subprocess 能找到
- `resources/edl/`、`resources/scripts/` 同上
- `resources/menus/`、`resources/data/` 可在 asar 内(纯数据)
- 首次启动若检测到 `resources/` 不完整,提示用户下载资源包

### 15.3 自动更新

- 用 `electron-updater`
- 检查 `https://releases.xgj.qzz.io/imoodesktop/latest.yml`
- 增量更新(仅替换变化的文件,通过 `electron-builder` 的 blockmap)
- 资源更新独立走 `CloudService`(不跟随应用更新)

### 15.4 发布渠道

| 渠道 | 用途 |
|---|---|
| GitHub Releases | 主渠道 |
| 4 镜像站 | 与原 AllToolBox 一致 |
| 应用内检查更新 | electron-updater |

---

## 16. 后续路线图

### v1.0(M1–M6 完成)

- 100% 功能等价于 AllToolBox 1.3.8fix1
- Windows 安装包 + 便携版

### v1.1

- 国际化(英文)
- 主题切换(亮/暗/跟随系统)
- 命令面板增强(历史记录/书签)

### v1.2

- macOS 支持(仅 ADB/Fastboot,EDL 不可用)
- 模块商店后端自建(Magisk 模块镜像)

### v2.0

- 插件系统(让社区贡献功能,无需改主程序)
- 设备端配套 app(显示状态/一键操作)
- 云端账号(可选,同步设置/资源)

### 长期

- 迁移到 Tauri 2.0(体积优化,若 Rust 学习成本可接受)
- 或迁移到开源 EDL(`bkerler/edl`)实现跨平台

---

## 17. 附录

### 17.1 原项目致谢

iMooDesktop 基于原作者 xgj_236(快乐小公爵236)的 AllToolBox 1.3.8fix1 项目重构。所有原作者声明、免责声明、版权信息在 iMooDesktop 中保留。

- 原作者 QQ:3247039462
- 交流 QQ 群:907491503
- 原项目官网:https://atb.xgj.qzz.io
- Bilibili:https://b23.tv/L54R5ZV
- Bug 反馈:ATBbug@xgj.qzz.io

### 17.2 免责声明(应用内置)

> 在使用 iMooDesktop 对 XTC 电话手表系列进行 ROOT、刷机、解除安装限制、安装非官方应用等操作[统称"刷机"]前,您必须仔细阅读并完全理解本声明。一旦您实施或完成刷机行为,即视为您已充分知悉、同意并自愿承担本声明所述的全部风险及责任。
>
> 1. 本工具仅供学习、交流使用,并非"破解"XTC 电话手表系列产品。严禁用于任何形式非法用途。
> 2. 本工具不能用于解绑手表,如您通过不正当手段获取的手表请联系公安机关归还失主。
> 3. 刷机后设备将脱离官方原厂固件,可能导致无法使用官方服务、系统不稳定、数据丢失或硬件损坏。
> 4. 设备自进入 9008 模式起即刻丧失官方保修资格。
> 5. 刷机属于您个人自愿行为,我们仅提供技术信息与文件资源,因刷机导致的直接或间接损失,我们不承担责任。
> 6. 请在刷机后 48 小时内恢复 XTC 官方系统。
> 7. 严禁代刷、强迫或教唆他人刷入非官方系统。
> 8. 获取 XTC 用户信息属违法行为,请立即卸载非法抓包工具。
>
> 使用本工具即表示您已阅读、理解并同意上述全部内容。

### 17.3 关键技术参考

- Magisk boot 修补流程:https://github.com/topjohnwu/Magisk/blob/master/scripts/boot_patch.sh
- Qualcomm EDL 协议:https://github.com/bkerler/edl
- Electron 安全最佳实践:https://www.electronjs.org/docs/latest/tutorial/security
- shadcn/ui 组件库:https://ui.shadcn.com
- Tauri 2.0(长期迁移目标):https://tauri.app

### 17.4 术语表

| 术语 | 含义 |
|---|---|
| ADB | Android Debug Bridge,Android 调试桥 |
| Fastboot | Android 快速启动模式 |
| EDL | Emergency Download Mode,高通紧急下载模式(9008) |
| 9008 | Qualcomm EDL 的 USB VID/PID(0x05C6/0x9008) |
| firehose | Qualcomm EDL 的协议加载器(.mbn/.elf) |
| misc 分区 | Android 的 misc 分区,存储启动指令(如 `ffbm-02` 进 QMMI) |
| QMMI | Qualcomm 工厂的 MMI 模式 |
| FFBM | Fast Factory Boot Mode |
| innermodel | 设备的内部型号(如 I25 = Z7) |
| V3 | XTC 的新版系统协议(通过 softversion 阈值判断) |
| Magisk | Android Root 框架 |
| Magisk 模块 | Magisk 的扩展模块(.zip 格式) |
| boot.img | Android 的 boot 分区镜像(含 kernel + ramdisk) |
| userdata | Android 的用户数据分区 |
| TWRP | Team Win Recovery Project,第三方 Recovery |
| Xposed | Android 框架 Hook 工具 |
| EdXposed | Xposed 的 Magisk 实现(Android 8.1+) |
| LSPosed | EdXposed 的继任者(Z10 用) |
| switch.db | Z10 桌面的模块开关数据库(SQLite) |
| .atbmod | AllToolBox 的扩展模块包格式 |

### 17.5 文档版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.7 | 2026-06-18 | 菜单 JSON 重新定位:从"数据文件零改造"约束中移除;原 33 个 JSON 降级为参考文档,菜单选项写死在 `src/lib/menus.ts`,UI 自由设计;更新 7.5 节/资产映射表/目录结构 |
| v1.6 | 2026-06-18 | 撤销 APK 文件名改名(z10apk.Apk 保留原样,用户指示);原 2.5.4 节合并入 2.5.4"不修复的项" |
| v1.5 | 2026-06-18 | 新增 2.6 节".bat 脚本处理原则"(澄清 .bat 全废弃,逻辑进 TS);扩展 2.5.2 节设备端 .sh 改名清单(5 个 .sh 改名,含 rec.sh 特殊处理);修正"保留 .bat"表述 |
| v1.4 | 2026-06-18 | 新增 2.5 节"命名/拼写规范":修正 tmp→cache、rooting→work、magiskperinster→magisk_force_install、冗余变量 edlPort 等(v1.6 撤销了 APK 改名) |
| v1.3 | 2026-06-18 | 新增 UI 规范(蓝色主题/禁 emoji/SVG 图标库);清理全文 emoji;确认 GUI 形态 |
| v1.2 | 2026-06-18 | 用户澄清约束边界:业务逻辑不能改,技术实现细节可优化;批准修复已知 bug;批准合并 fh_loader/qfh_loader 为单个 fh_loader.exe(保留错误处理语义分离) |
| v1.1 | 2026-06-18 | 加入"核心约束:逻辑保真度"章节(初版,过于严格) |
| v1.0 | 2026-06-18 | 初始版本,基于 AllToolBox 1.3.8fix1 逆向分析编写 |

---

**文档结束**。

下一步:等待用户确认本计划,确认后进入 M1 阶段实施。
