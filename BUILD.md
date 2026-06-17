# iMoo Desktop 打包指南

本文档说明如何使用 Nuitka 将 iMoo Desktop 打包成跨平台桌面应用。

## 为什么用 Nuitka（而不是 PyInstaller）

| 维度 | Nuitka | PyInstaller |
|------|--------|-------------|
| 原理 | Python → C → 二进制 | 字节码打包 + 运行时解压 |
| 性能 | 启动快、运行快（C 编译优化） | 启动慢（解压 + 字节码解释） |
| 反编译 | 难（编译成机器码） | 容易（pycextract 可还原） |
| 体积 | 相近或略大（含 C 编译产物） | 较小 |
| 编译时间 | 慢（10-30 分钟） | 快（1-3 分钟） |
| 依赖 | 需要 C 编译器 | 无 |

**结论**：Nuitka 更适合发布生产级桌面应用，启动速度和代码保护都更好。

## 前置条件

### 1. Python 环境
```bash
python3 --version  # 需要 3.10+
pip install -r requirements.txt
```

### 2. C 编译器（Nuitka 依赖）

| 平台 | 编译器 | 安装方式 |
|------|--------|---------|
| Linux | gcc | `apt install build-essential` / `dnf install gcc` |
| macOS | clang | `xcode-select --install` |
| Windows | MSVC | 安装 Visual Studio Build Tools（含 C++ 桌面开发） |

验证：
```bash
gcc --version    # Linux/macOS
cl               # Windows (Developer Command Prompt)
```

### 3. 前端构建工具
```bash
# 安装 bun（前端包管理器）
curl -fsSL https://bun.sh/install | bash

# 安装前端依赖
cd frontend
bun install
```

## 打包步骤

### 一键打包

```bash
# 默认 standalone 模式（独立目录，启动快）
./build.sh

# onefile 模式（单文件，易分发）
./build.sh onefile
```

### 分步打包

```bash
# 1. 构建前端
./build.sh frontend
# 或
cd frontend && bun run build

# 2. 打包（standalone）
python3 build.py --mode standalone

# 3. 打包（onefile）
python3 build.py --onefile

# 4. 清理
./build.sh clean
```

### 打包参数

```bash
python3 build.py --help
```

常用参数：
- `--mode standalone|onefile`：打包模式
- `--onefile`：onefile 模式快捷参数
- `--output-name NAME`：输出文件名（默认 iMooDesktop）
- `--no-frontend`：跳过前端构建（使用已有 dist）
- `--frontend-only`：只构建前端
- `--clean`：清理构建产物

## 打包模式对比

### standalone（独立目录，推荐）

```
build/
└── iMooDesktop.dist/
    ├── iMooDesktop          # 可执行文件
    ├── config.yaml
    ├── frontend/dist/       # 前端静态资源
    ├── assets/icons/        # 应用图标
    ├── PySide6/             # Qt 库
    ├── PIL/                 # Pillow
    └── ...                  # 其他依赖
```

**优点**：
- 启动快（无需解压）
- 调试方便（可查看文件结构）
- 体积比 onefile 略大但可接受

**缺点**：
- 分发需打包整个目录（zip/tar）

### onefile（单文件）

```
build/
└── iMooDesktop.bin         # 单个可执行文件（Windows: .exe）
```

**优点**：
- 易分发（单文件）
- 用户无感

**缺点**：
- 启动慢（每次启动解压到临时目录）
- 临时目录可能被杀毒软件扫描

## 跨平台打包

### Linux
```bash
./build.sh
# 产物: build/iMooDesktop.dist/iMooDesktop
```

### macOS
```bash
./build.sh
# 产物: build/iMooDesktop.dist/iMooDesktop
# 如需 .app 包，用 --macos-create-app-bundle（需额外配置 Info.plist）
```

### Windows
```powershell
# 在 Developer Command Prompt for VS 中运行
python build.py
# 产物: build\iMooDesktop.dist\iMooDesktop.exe
```

**注意**：跨平台打包需要在对应平台上执行。Nuitka 不支持交叉编译。
如需三端发布，建议用 GitHub Actions 矩阵构建（见下文）。

## 体积优化

build.py 已内置以下优化：
- `--lto=yes`：链接时优化
- `--nofollow-import-to=tkinter,unittest,pydoc,...`：排除不用的标准库
- `--remove-output`：清理编译临时文件

进一步优化：
```bash
# UPX 压缩（减小 30-50% 体积，但启动略慢）
python3 build.py --onefile
# 然后对产物执行
upx --best --lzma build/iMooDesktop.bin
```

## 打包后验证

```bash
# 1. 运行
./build/iMooDesktop.dist/iMooDesktop

# 2. 检查窗口标题应为 "iMoo Desktop"
# 3. 检查应用图标显示
# 4. 检查设备绑定流程（设置页）
# 5. 检查好友圈/微聊/批量点赞等功能
# 6. 检查深色/浅色主题切换
```

## 常见问题

### Q: 打包后启动报 "libGL.so.1 not found"（Linux）

A: 缺少 OpenGL 运行库。安装：
```bash
apt install libgl1-mesa-glx libegl1-mesa
```

### Q: 打包后 QtWebEngine 白屏

A: QtWebEngine 需要额外系统库。安装：
```bash
# Linux
apt install libnss3 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libasound2 libxtst6 libxshmfence1 libfontconfig1 libdbus-1-3

# 或参考 plan.md 9.7 节"跨平台系统库"
```

### Q: 打包后找不到 config.yaml / 前端资源

A: 检查 `shell/main_window.py` 的资源路径逻辑。Nuitka 打包后 `__file__` 指向 `.dist` 目录或 onefile 解压临时目录，`Path(__file__).parent.parent` 应指向项目根。

### Q: Nuitka 编译很慢

A: 正常现象。PySide6 + QtWebEngine 项目首次编译约 10-30 分钟。后续增量编译会快很多（Nuitka 有缓存）。

### Q: 如何减小体积

A:
1. 用 `--onefile` + UPX 压缩
2. 排除更多不用的模块（`--nofollow-import-to=...`）
3. 只包含用到的 Qt 模块（已配置）
4. 用 `--lto=yes`（已启用）

## GitHub Actions 自动构建

在 `.github/workflows/build.yml` 配置三端矩阵构建：

```yaml
name: Build
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - uses: oven-sh/setup-bun@v1
      - run: pip install -r requirements.txt
      - run: cd frontend && bun install && bun run build
      - run: python build.py --onefile --no-frontend
      - uses: actions/upload-artifact@v4
        with:
          name: iMooDesktop-${{ matrix.os }}
          path: build/iMooDesktop*
```

## 发布清单

每次发布前确认：
- [ ] 前端已构建（`frontend/dist/index.html` 存在）
- [ ] config.yaml 存在且配置正确
- [ ] assets/icons/app.png 存在
- [ ] 版本号已更新（`main.py` + `package.json`）
- [ ] 三端打包验证通过
- [ ] 打包后基础功能验证（绑定/好友圈/微聊/点赞）
- [ ] CHANGELOG 已更新

## 打包产物结构（standalone）

```
iMooDesktop.dist/
├── iMooDesktop                  # 主程序
├── config.yaml                  # API 配置
├── frontend/
│   └── dist/                    # Preact 前端构建产物
│       ├── index.html
│       ├── favicon.svg
│       ├── apple-touch-icon.png
│       └── assets/
│           ├── index-*.css
│           └── index-*.js
├── assets/
│   └── icons/                   # 应用图标（多尺寸）
│       ├── app.svg
│       ├── app.png
│       └── app-{16,32,64,128,256}.png
├── PySide6/                     # Qt6 运行库
│   ├── QtWidgets.abi3.so
│   ├── QtWebEngineWidgets.abi3.so
│   ├── QtWebEngineProcess       # WebEngine 进程
│   └── ...
├── PIL/                         # Pillow
├── yaml/                        # PyYAML
├── requests/                    # HTTP 客户端
└── ...                          # 其他依赖
```
