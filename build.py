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

# Windows 控制台默认 cp1252，print 中文会 UnicodeEncodeError；
# 强制 stdout/stderr 用 utf-8（Python 3.7+ 支持 reconfigure）
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).parent.resolve()
FRONTEND_DIR = ROOT / "frontend"
BUILD_DIR = ROOT / "build"
DIST_DIR = ROOT / "dist"


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    """运行命令，实时输出。Windows 不用 shell=True（避免 cmd.exe 解析 40+ 参数出错）。
    用 Popen + stdout/stderr 直接继承父进程，保证实时输出。"""
    print(f"\n$ {' '.join(cmd)}")
    # 不用 shell=True：Windows 上 cmd.exe 解析长参数列表会出错
    # Popen 在 Windows 上会自动找 .exe（如 python.exe），不需要 shell
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        shell=False,
        stdout=None,  # 直接继承父进程 stdout（实时打印，无缓冲）
        stderr=None,  # 直接继承父进程 stderr
    )
    proc.wait()
    if check and proc.returncode != 0:
        raise SystemExit(f"命令失败 (exit {proc.returncode}): {' '.join(cmd)}")
    return proc.returncode


def _heartbeat(msg: str, stop_event):
    """后台线程：每 30 秒打印一次心跳，让用户知道没卡死"""
    import time
    n = 0
    while not stop_event.wait(30):
        n += 1
        print(f"  [{n*30}s] {msg}（仍在运行，Nuitka 编译耗时长属正常）", flush=True)


def find_command(*names: str) -> str | None:
    """在 PATH 中找第一个可用的命令（用于 bun/npm/npx fallback）"""
    from shutil import which
    for name in names:
        path = which(name)
        if path:
            return name
    return None


def build_frontend() -> None:
    """构建前端静态资源"""
    print("\n===== 构建前端 =====")

    # 探测可用的前端工具：bun > npm
    pkg_mgr = find_command("bun", "npm")
    if not pkg_mgr:
        raise SystemExit(
            "未找到 bun 或 npm，请先安装：\n"
            "  bun:  https://bun.sh/  (推荐，更快)\n"
            "  npm:  https://nodejs.org/"
        )
    print(f"使用前端工具: {pkg_mgr}")

    if not (FRONTEND_DIR / "node_modules").exists():
        print("安装前端依赖...")
        if pkg_mgr == "bun":
            run(["bun", "install"], cwd=FRONTEND_DIR)
        else:
            run(["npm", "install"], cwd=FRONTEND_DIR)

    if pkg_mgr == "bun":
        run(["bun", "run", "build"], cwd=FRONTEND_DIR)
    else:
        run(["npm", "run", "build"], cwd=FRONTEND_DIR)

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
    # macOS 上 QtWebEngine 要求必须打包成 .app bundle（"unless in an application bundle"），
    # 所以 macOS 一律用 --mode=app（生成 .app 目录），忽略用户传的 standalone/onefile。
    # 非 macOS 上显式传 --mode app 也走 .app bundle（理论上 Linux 也支持，但未测试）。
    is_macos = platform.system() == "Darwin"
    if is_macos or mode == "app":
        # --mode=app 等价于 standalone + 生成 .app bundle，QtWebEngine 才能正常加载
        args.append("--mode=app")
    elif mode == "onefile":
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
    for pkg in ["PIL", "yaml", "requests", "imageio"]:
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

    # 检查 nuitka（加 timeout + 心跳，首次运行可能要下载 scons 依赖）
    print("检查 Nuitka 版本（首次可能要下载依赖，请稍候）...")
    import threading
    stop_hb = threading.Event()
    hb = threading.Thread(target=_heartbeat, args=("Nuitka 版本检查", stop_hb), daemon=True)
    hb.start()
    try:
        nuitka_ver = subprocess.check_output(
            [sys.executable, "-m", "nuitka", "--version"],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=120,
        ).strip().split("\n")[0]
        print(f"Nuitka: {nuitka_ver}")
    except subprocess.TimeoutExpired:
        print("Nuitka: 版本检查超时（首次运行可能要下载依赖），继续尝试打包...")
    except (subprocess.CalledProcessError, FileNotFoundError):
        raise SystemExit("Nuitka 未安装，请运行: pip install nuitka")
    finally:
        stop_hb.set()

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

    # 执行（加心跳线程，让用户知道没卡死）
    print(f"\n开始编译（可能需要 10-30 分钟，取决于项目大小和 CPU）...")
    print("提示：首次编译会下载 Nuitka 依赖（ccache 等），较慢；后续增量编译会快很多。")
    print("      如果长时间无输出，Nuitka 正在做静态分析/C 编译，属正常现象。")
    print("      下面每 30 秒会打印心跳，确认进程仍在运行。")

    import threading
    stop_event = threading.Event()
    hb = threading.Thread(target=_heartbeat, args=("Nuitka 编译中", stop_event), daemon=True)
    hb.start()

    try:
        run(args, cwd=ROOT)
    finally:
        stop_event.set()

    # 查找产物（Nuitka 用源文件名 main 命名 .dist/.app，不是 --output-filename 的值）
    is_macos = platform.system() == "Darwin"
    is_app_mode = is_macos or mode == "app"
    if is_app_mode:
        # macOS --mode=app 产物是 .app 目录；Nuitka 用源文件名命名，可能是 main.app 或 iMooDesktop.app
        product = None
        for app in BUILD_DIR.glob("*.app"):
            product = app
            break
        if product is None:
            product = BUILD_DIR / f"{output_name}.app"  # fallback
        dist_dir = product  # 整个 .app 就是产物目录
    elif mode == "onefile":
        ext = ".exe" if platform.system() == "Windows" else ".bin"
        product = BUILD_DIR / f"{output_name}{ext}"
        if not product.exists():
            # Nuitka 可能用 main.bin / main.exe
            for f in BUILD_DIR.glob(f"main{ext}"):
                product = f
                break
            if not product.exists():
                product = BUILD_DIR / output_name
    else:
        # standalone: Nuitka 产出 main.dist/
        dist_dir = None
        for d in BUILD_DIR.glob("*.dist"):
            dist_dir = d
            break
        if dist_dir is None:
            dist_dir = BUILD_DIR / f"{output_name}.dist"  # fallback
        # 可执行文件在 .dist 目录内
        if platform.system() == "Windows":
            product = dist_dir / f"{output_name}.exe"
            if not product.exists():
                product = dist_dir / "main.exe"
        else:
            product = dist_dir / output_name
            if not product.exists():
                product = dist_dir / "main"

    if product.exists():
        if is_app_mode:
            total = sum(f.stat().st_size for f in product.rglob("*") if f.is_file())
            print(f"\n✓ 打包成功！")
            print(f"  产物: {product}")
            print(f"  大小: {total / 1024 / 1024:.1f} MB (.app 目录)")
            # macOS 清理 .app/Contents/MacOS 目录
            cleanup_dir = product / "Contents" / "MacOS"
            if cleanup_dir.exists():
                print(f"\n===== 清理产物（省体积）=====")
                before = sum(f.stat().st_size for f in product.rglob("*") if f.is_file())
                cleanup_build_artifacts(cleanup_dir)
                after = sum(f.stat().st_size for f in product.rglob("*") if f.is_file())
                print(f"  清理前: {before / 1024 / 1024:.1f} MB → 清理后: {after / 1024 / 1024:.1f} MB")
                print(f"  节省: {(before - after) / 1024 / 1024:.1f} MB")
        else:
            size_mb = product.stat().st_size / 1024 / 1024
            print(f"\n✓ 打包成功！")
            print(f"  产物: {product}")
            print(f"  大小: {size_mb:.1f} MB")

            # standalone 模式整个 .dist 目录的大小 + 清理
            if mode != "onefile":
                dist_dir = product.parent
                before = sum(f.stat().st_size for f in dist_dir.rglob("*") if f.is_file())
                print(f"\n===== 清理产物（省体积）=====")
                cleanup_build_artifacts(dist_dir)
                after = sum(f.stat().st_size for f in dist_dir.rglob("*") if f.is_file())
                print(f"  清理前: {before / 1024 / 1024:.1f} MB → 清理后: {after / 1024 / 1024:.1f} MB")
                print(f"  节省: {(before - after) / 1024 / 1024:.1f} MB")
                print(f"  最终 .dist 目录大小: {after / 1024 / 1024:.1f} MB")
    else:
        print(f"\n⚠ 未找到打包产物: {product}")
        print(f"  请检查 {BUILD_DIR} 目录")


def cleanup_build_artifacts(dist_dir: Path) -> None:
    """清理 Nuitka 产物中未使用的模块/翻译文件/调试符号，省 30-50% 体积"""
    import shutil
    import subprocess

    if not dist_dir.is_dir():
        return

    system = platform.system()
    print(f"  清理目录: {dist_dir}")

    # 1. 删除未使用的 PySide6 模块（只保留 8 个必需模块）
    #    Qt3D/QtCharts/QtMultimedia/QtQml/QtQuick/QtSql/QtSvg/QtTest 等 30+ 个
    KEEP_QT = {
        "QtCore", "QtGui", "QtWidgets", "QtNetwork",
        "QtWebEngineWidgets", "QtWebEngineCore", "QtWebChannel", "QtPrintSupport",
    }
    pyside_dir = dist_dir / "PySide6"
    if pyside_dir.is_dir():
        # 删除 .so / .pyd / .dll
        for f in pyside_dir.iterdir():
            if not f.is_file():
                continue
            name = f.name
            # 匹配 Qt 开头的模块文件
            for ext in (".so", ".pyd", ".dll"):
                if name.startswith("Qt") and name.endswith(ext):
                    mod = name[:-len(ext)]
                    # 处理 QtXxx.abi3.so 这种带 abi3 的
                    mod = mod.split(".")[0]
                    if mod not in KEEP_QT:
                        print(f"    删除 {f.relative_to(dist_dir)}")
                        f.unlink()
                    break
        # 删除子模块目录
        UNUSED_QT_DIRS = [
            "Qt3DAnimation", "Qt3DCore", "Qt3DExtras", "Qt3DInput", "Qt3DLogic",
            "Qt3DRender", "QtBluetooth", "QtCharts", "QtDataVisualization",
            "QtDataVisualizationQml", "QtDesigner", "QtHelp", "QtLocation",
            "QtMultimedia", "QtMultimediaWidgets", "QtNetworkAuth", "QtNfc",
            "QtPositioning", "QtQml", "QtQuick", "QtQuick3D", "QtQuickControls2",
            "QtQuickWidgets", "QtRemoteObjects", "QtScxml", "QtSensors",
            "QtSerialBus", "QtSerialPort", "QtSpatialAudio", "QtSql",
            "QtStateMachine", "QtSvg", "QtSvgWidgets", "QtTest", "QtTextToSpeech",
            "QtUiTools", "QtVirtualKeyboard", "QtWebSockets", "QtXml",
            "examples", "docs",
        ]
        for d_name in UNUSED_QT_DIRS:
            d = pyside_dir / d_name
            if d.exists():
                print(f"    删除 {d.relative_to(dist_dir)}/")
                shutil.rmtree(d, ignore_errors=True)

    # 2. strip 调试符号（Linux/macOS，省 20-40MB）
    if system in ("Linux", "Darwin"):
        print("  strip 调试符号...")
        so_files = list(dist_dir.rglob("*.so")) + list(dist_dir.rglob("*.dylib"))
        for so in so_files:
            try:
                if system == "Linux":
                    subprocess.run(["strip", "--strip-unneeded", str(so)],
                                 capture_output=True, timeout=10)
                else:  # Darwin
                    subprocess.run(["strip", "-x", str(so)],
                                 capture_output=True, timeout=10)
            except Exception:
                pass

    # 3. 清理翻译文件（只保留中英文）
    print("  清理翻译文件...")
    for qm in dist_dir.glob("*.qm"):
        if "zh" not in qm.name and "en" not in qm.name:
            qm.unlink()
    # 常见 Qt 工具翻译直接删
    for pat in ("assistant_*.qm", "designer_*.qm", "linguist_*.qm"):
        for f in dist_dir.glob(pat):
            f.unlink()
    trans_dir = pyside_dir / "translations"
    if trans_dir.is_dir():
        for qm in trans_dir.glob("*.qm"):
            if "zh" not in qm.name and "en" not in qm.name:
                qm.unlink()
    locales_dir = dist_dir / "qtwebengine_locales"
    if locales_dir.is_dir():
        for pak in locales_dir.glob("*.pak"):
            if "zh" not in pak.name and "en" not in pak.name:
                pak.unlink()

    # 4. 删除 imageio 运行时（仅打包时用于图标转换，运行时不需要）
    for p in dist_dir.iterdir():
        if p.name.startswith("imageio"):
            print(f"    删除 {p.relative_to(dist_dir)}")
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            else:
                p.unlink()

    # 5. 清理 Pillow 未用插件（Linux/macOS，保留常用格式）
    if system in ("Linux", "Darwin"):
        pil_dir = dist_dir / "PIL"
        if pil_dir.is_dir():
            KEEP_PIL = {
                "_webp", "_png", "_jpeg", "_gif", "_bmp", "_tiff", "_imaging",
                "Image", "ImageFile", "ImageMode", "ImagePalette", "ImageSequence",
                "ImageColor", "ImageFilter", "ImageFont", "ImageDraw", "ImageChops",
                "ImageOps", "ImageStat", "ImageTransform", "ImageCms", "ImageMath",
                "ImageWin", "BmpImagePlugin", "JpegImagePlugin", "PngImagePlugin",
                "GifImagePlugin", "TiffImagePlugin", "WebPImagePlugin",
                "IcoImagePlugin", "PpmImagePlugin",
            }
            for f in pil_dir.iterdir():
                if f.is_file() and f.suffix == ".py":
                    mod = f.stem
                    if mod not in KEEP_PIL:
                        f.unlink()
                        # 删 .pyc
                        pyc = f.with_suffix(".pyc")
                        if pyc.exists():
                            pyc.unlink()

    # 6. 清理 Python 标准库残余
    for name in ("lib2to3", "ensurepip", "venv", "idlelib", "distutils", "pydoc_data"):
        for p in dist_dir.iterdir():
            if p.name == name or p.name.startswith(name + "-") or p.name.startswith(name + "_"):
                if p.is_dir():
                    shutil.rmtree(p, ignore_errors=True)

    # 7. 删除 __pycache__ / .pyc
    for cache in dist_dir.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    for pyc in dist_dir.rglob("*.pyc"):
        pyc.unlink()


def main():
    parser = argparse.ArgumentParser(
        description="iMoo Desktop Nuitka 打包脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--mode",
        choices=["standalone", "onefile", "app"],
        default="standalone",
        help="打包模式: standalone=独立目录(启动快), onefile=单文件(易分发), "
             "app=macOS .app bundle（QtWebEngine 在 macOS 必须用此模式；"
             "macOS 上传 standalone/onefile 也会被自动改写为 app）",
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
