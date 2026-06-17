#!/usr/bin/env bash
# iMoo Desktop - 打包脚本（shell 包装器）
# 用法:
#   ./build.sh              # standalone 模式
#   ./build.sh onefile      # onefile 单文件模式
#   ./build.sh clean        # 清理构建产物
#   ./build.sh frontend     # 只构建前端

set -euo pipefail
cd "$(dirname "$0")"

# 检查 Python
if ! command -v python3 &>/dev/null; then
    echo "✗ 未找到 python3"
    exit 1
fi

# 检查 nuitka（自动安装）
if ! python3 -m nuitka --version &>/dev/null; then
    echo "⚠ Nuitka 未安装，正在安装..."
    python3 -m pip install nuitka
fi

# 检查前端依赖
if ! command -v bun &>/dev/null; then
    echo "⚠ 未找到 bun，前端构建需要 bun"
    echo "  安装: curl -fsSL https://bun.sh/install | bash"
fi

case "${1:-standalone}" in
    onefile)
        echo "===== onefile 模式打包 ====="
        python3 build.py --onefile
        ;;
    standalone)
        echo "===== standalone 模式打包 ====="
        python3 build.py --mode standalone
        ;;
    clean)
        python3 build.py --clean
        ;;
    frontend)
        python3 build.py --frontend-only
        ;;
    *)
        echo "用法: $0 {standalone|onefile|clean|frontend}"
        echo "  standalone  - 独立目录模式（默认，启动快）"
        echo "  onefile     - 单文件模式（易分发）"
        echo "  clean       - 清理构建产物"
        echo "  frontend    - 只构建前端"
        exit 1
        ;;
esac
