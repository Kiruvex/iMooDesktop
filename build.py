#!/usr/bin/env python3
"""
iMoo Desktop - Nuitka 打包脚本

用法:
  python build.py                  # 默认 standalone 模式
  python build.py --onefile        # onefile 单文件模式
  python build.py --clean          # 清理构建产物
  python build.py --frontend-only  # 只构建前端
  python build.py --help           # 查看所有选项

前置条件:
  1. 已安装 nuitka: pip install nuitka
  2. 已安装 C 编译器: gcc (Linux/Mac) 或 MSVC (Windows)
  3. 已安装项目依赖: pip install -r requirements.txt
  4. 已安装前端依赖: cd frontend && bun install
  5. 前端已构建: cd frontend && bun run build

打包产物:
  - standalone: build/iMooDesktop.dist/iMooDesktop (可执行文件 + 依赖目录)
  - onefile:    build/iMooDesktop.exe / iMooDesktop.bin (单文件)
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
FRONTEND_DIR = ROOT / "frontend"
BUILD_DIR = ROOT / "build"
DIST_DIR = ROOT / "dist"


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    """运行命令，实时输出"""
    print(f"\n$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, shell=False)
    if check and result.returncode != 0:
        raise SystemExit(f"命令失败 (exit {result.returncode}): {' '.join(cmd)}")
    return result.returncode


def build_frontend() -> None:
    """构建前端静态资源"""
    print("\n===== 构建前端 =====")
    if not (FRONTEND_DIR / "node_modules").exists():
        print("安装前端依赖...")
        run(["bun", "install"], cwd=FRONTEND_DIR)
    run(["bun", "run", "build"], cwd=FRONTEND_DIR)

    dist = FRONTEND_DIR / "dist"
    if not (dist / "index.html").exists():
        raise SystemExit(f"前端构建失败: {dist / 'index.html'} 不存在")
    print(f"✓ 前端构建完成: {dist}")


def clean_build() -> None:
    """清理构建产物"""
    print("\n===== 清理构建产物 =====")
    for d in [BUILD_DIR, DIST_DIR]:
        if d.exists():
            print(f"删除 {d}")
            shutil.rmtree(d)
    # Nuitka 会生成 main.build 目录
    main_build = ROOT / "main.build"
    if main_build.exists():
        print(f"删除 {main_build}")
        shutil.rmtree(main_build)
    onefile_tmp = ROOT / "onefile_*.dist"
    for p in ROOT.glob("onefile_*.dist"):
        print(f"删除 {p}")
        shutil.rmtree(p)
    print("✓ 清理完成")


def get_icon_arg() -> list[str]:
    """根据平台返回图标参数"""
    icon_path = ROOT / "assets" / "icons" / "app.png"
    if not icon_path.exists():
        print(f"⚠ 图标不存在: {icon_path}，跳过图标设置")
        return []

    system = platform.system()
    if system == "Windows":
        # Windows 优先用 .ico，但 .png 也可以
        ico_path = ROOT / "assets" / "icons" / "app.ico"
        if ico_path.exists():
            return [f"--windows-icon-from-ico={ico_path}"]
        return [f"--windows-icon-from-ico={icon_path}"]
    elif system == "Darwin":
        # macOS 用 .icns（如果有），否则 .png
        icns_path = ROOT / "assets" / "icons" / "app.icns"
        if icns_path.exists():
            return [f"--macos-app-icon={icns_path}"]
        return [f"--macos-app-icon={icon_path}"]
    else:
        # Linux
        return [f"--linux-icon={icon_path}"]


def get_nuitka_args(mode: str, output_name: str) -> list[str]:
    """构造 Nuitka 命令行参数"""
    main_py = str(ROOT / "main.py")

    # 参数顺序：python -m nuitka [options] main.py
    # main.py 必须在最后
    args = [sys.executable, "-m", "nuitka"]

    # ===== 模式 =====
    if mode == "onefile":
        args.append("--onefile")
    else:
        args.append("--standalone")

    # ===== PySide6 插件 =====
    args.append("--enable-plugin=pyside6")

    # ===== 数据文件 =====
    # config.yaml（必需，WatchAPI 依赖）
    args.append("--include-data-files=config.yaml=config.yaml")
    # EULA 许可协议文本（启动时强制同意弹窗用）
    args.append("--include-data-files=EULA.txt=EULA.txt")
    # 前端构建产物
    args.append("--include-data-dir=frontend/dist=frontend/dist")
    # 应用图标资源
    args.append("--include-data-dir=assets/icons=assets/icons")

    # ===== 显式包含的包（确保 QtWebEngine 等不被裁剪）=====
    qt_packages = [
        "PySide6.QtCore",
        "PySide6.QtGui",
        "PySide6.QtWidgets",
        "PySide6.QtNetwork",
        "PySide6.QtWebEngineWidgets",
        "PySide6.QtWebEngineCore",
        "PySide6.QtWebChannel",
        "PySide6.QtPrintSupport",  # QtWebEngine 依赖
    ]
    for pkg in qt_packages:
        args.append(f"--include-package={pkg}")

    # 第三方依赖
    for pkg in ["PIL", "yaml", "requests"]:
        args.append(f"--include-package={pkg}")

    # 项目模块（显式包含，避免 Nuitka 静态分析漏掉）
    project_modules = [
        "core.im_client",
        "core.image_uploader",
        "core.moment_parser",
        "core.num_crypto",
        "core.watch_api",
        "storage.cache_store",
        "storage.config_store",
        "storage.log_store",
        "workers.base_worker",
        "bridge.app_bridge",
        "shell.main_window",
    ]
    for mod in project_modules:
        args.append(f"--include-module={mod}")

    # ===== 图标 =====
    args.extend(get_icon_arg())

    # ===== 输出 =====
    args.append(f"--output-dir={BUILD_DIR}")
    args.append(f"--output-filename={output_name}")
    args.append("--remove-output")  # 编译后清理 .build 临时

    # ===== 路径解析 =====
    # 默认 original 会让 __file__ 指向编译时源码路径，打包后无法定位 config.yaml /
    # frontend/dist 等资源；runtime 让 __file__ 指向运行时实际路径，配合 sys.argv[0]
    # 的运行时检测（main.py / main_window.py）双保险。
    args.append("--file-reference-choice=runtime")

    # ===== 优化 =====
    args.append("--lto=yes")  # 链接时优化，减小体积
    args.append("--assume-yes-for-downloads")  # 自动下载 Nuitka 依赖

    # ===== 跨平台 =====
    if platform.system() == "Windows":
        args.append("--windows-console-mode=disable")  # 无控制台窗口
        args.append("--windows-company-name=iMooDesktop")
        args.append("--windows-product-name=iMoo Desktop")
        args.append("--windows-file-version=1.0.0.0")
        args.append("--windows-product-version=1.0.0.0")

    # 排除不用的模块减小体积
    for exclude in ["tkinter", "unittest", "pydoc", "doctest", "test"]:
        args.append(f"--nofollow-import-to={exclude}")

    # main.py 必须在最后
    args.append(main_py)

    return args


def package(mode: str, output_name: str) -> None:
    """执行打包"""
    print(f"\n===== 开始 Nuitka 打包（{mode} 模式）=====")
    print(f"平台: {platform.system()} {platform.machine()}")
    print(f"Python: {sys.version.split()[0]}")
    print(f"项目根: {ROOT}")

    # 检查 nuitka
    try:
        nuitka_ver = subprocess.check_output(
            [sys.executable, "-m", "nuitka", "--version"],
            stderr=subprocess.STDOUT,
            text=True,
        ).strip().split("\n")[0]
        print(f"Nuitka: {nuitka_ver}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        raise SystemExit("Nuitka 未安装，请运行: pip install nuitka")

    # 检查前端
    if not (FRONTEND_DIR / "dist" / "index.html").exists():
        print("\n前端未构建，自动构建...")
        build_frontend()

    # 检查 config.yaml
    if not (ROOT / "config.yaml").exists():
        raise SystemExit(f"config.yaml 不存在: {ROOT / 'config.yaml'}")

    # 检查图标
    if not (ROOT / "assets" / "icons" / "app.png").exists():
        print("⚠ 应用图标不存在，打包将无图标")

    # 构造命令
    args = get_nuitka_args(mode, output_name)
    print(f"\nNuitka 命令 ({len(args)} 个参数):")
    # 分行打印便于阅读
    for i in range(0, len(args), 4):
        print("  " + " ".join(args[i : i + 4]))

    # 执行
    print(f"\n开始编译（可能需要 10-30 分钟，取决于项目大小和 CPU）...")
    run(args, cwd=ROOT)

    # 查找产物
    if mode == "onefile":
        ext = ".exe" if platform.system() == "Windows" else ".bin"
        product = BUILD_DIR / f"{output_name}{ext}"
        if not product.exists():
            # onefile 可能没有扩展名
            product = BUILD_DIR / output_name
    else:
        product = BUILD_DIR / f"{output_name}.dist" / output_name
        if platform.system() == "Windows":
            product = product.with_suffix(".exe")

    if product.exists():
        size_mb = product.stat().st_size / 1024 / 1024
        print(f"\n✓ 打包成功！")
        print(f"  产物: {product}")
        print(f"  大小: {size_mb:.1f} MB")

        # standalone 模式整个 .dist 目录的大小
        if mode != "onefile":
            dist_dir = product.parent
            total = sum(f.stat().st_size for f in dist_dir.rglob("*") if f.is_file())
            print(f"  .dist 目录总大小: {total / 1024 / 1024:.1f} MB")
    else:
        print(f"\n⚠ 未找到打包产物: {product}")
        print(f"  请检查 {BUILD_DIR} 目录")


def main():
    parser = argparse.ArgumentParser(
        description="iMoo Desktop Nuitka 打包脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--mode",
        choices=["standalone", "onefile"],
        default="standalone",
        help="打包模式: standalone=独立目录(启动快), onefile=单文件(易分发)",
    )
    parser.add_argument(
        "--onefile",
        action="store_true",
        help="onefile 模式快捷参数（等价 --mode onefile）",
    )
    parser.add_argument(
        "--output-name",
        default="iMooDesktop",
        help="输出文件名（默认 iMooDesktop）",
    )
    parser.add_argument(
        "--frontend-only",
        action="store_true",
        help="只构建前端，不打包",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="清理构建产物",
    )
    parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="跳过前端构建（使用已有 dist）",
    )
    args = parser.parse_args()

    if args.clean:
        clean_build()
        return

    if args.frontend_only:
        build_frontend()
        return

    mode = "onefile" if args.onefile else args.mode

    if not args.no_frontend:
        build_frontend()

    package(mode, args.output_name)


if __name__ == "__main__":
    main()
