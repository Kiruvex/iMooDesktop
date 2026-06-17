"""
MainWindow - Qt 主窗口壳

职责:
  1. 承载 QWebEngineView 作为渲染容器
  2. 注册 QWebChannel 桥接 AppBridge
  3. 根据模式加载 dev server 或本地静态文件
"""

import sys
import logging
from pathlib import Path

from PySide6.QtCore import QUrl, QObject
from PySide6.QtGui import QIcon, QCloseEvent
from PySide6.QtWidgets import QMainWindow, QMessageBox
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings, QWebEngineProfile, QWebEnginePage
from PySide6.QtWebChannel import QWebChannel

logger = logging.getLogger(__name__)


class DebugWebEnginePage(QWebEnginePage):
    """重写 javaScriptConsoleMessage 以捕获 JS 控制台输出。

    PySide6 中虚函数无法通过属性赋值（``page().javaScriptConsoleMessage = fn``
    是 silent no-op，绑定不生效），必须继承重写并 ``setPage()`` 装载。
    """

    def __init__(self, parent=None, on_console=None):
        super().__init__(parent)
        self._on_console = on_console

    def javaScriptConsoleMessage(self, level, message, line_number, source_id):
        if self._on_console:
            try:
                self._on_console(level, message, line_number, source_id)
            except Exception:
                # 日志回调失败不能影响 WebEngine 渲染
                logger.exception("JS 控制台回调异常")


class MainWindow(QMainWindow):
    """主窗口 - QWebEngineView 容器"""

    def __init__(self, bridge: QObject, dev_mode: bool = False):
        super().__init__()
        self.bridge = bridge
        self.dev_mode = dev_mode

        self.setWindowTitle("iMoo Desktop")
        self.resize(980, 660)
        self.setMinimumSize(720, 520)

        # 设置窗口图标（如果存在）
        # Nuitka 打包后 __file__ 可能指向编译时源码路径，用 sys.argv[0] 定位运行时目录更可靠
        if "__compiled__" in dir() or getattr(sys, "frozen", False):
            icon_path = Path(sys.argv[0]).parent / "assets" / "icons" / "app.png"
        else:
            icon_path = Path(__file__).parent.parent / "assets" / "icons" / "app.png"
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))

        # 创建 WebEngineView
        self.view = QWebEngineView()
        self._setup_webengine()

        # 创建自定义 Page（重写 javaScriptConsoleMessage 捕获 JS 控制台输出）
        # 必须在 setCentralWidget / _load_content 之前 setPage，
        # 否则默认 Page 已被 view 使用，替换时机晚导致 JS 控制台日志丢失。
        self.debug_page = DebugWebEnginePage(
            parent=self.view, on_console=self._on_console_message
        )
        self.view.setPage(self.debug_page)

        # 创建 WebChannel（装载到 debug_page，不再用默认 page）
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.debug_page.setWebChannel(self.channel)

        # 允许本地内容访问远程资源（dev 模式下 dev server）
        self.debug_page.settings().setAttribute(
            QWebEngineSettings.LocalContentCanAccessRemoteUrls, True
        )
        self.debug_page.settings().setAttribute(
            QWebEngineSettings.LocalContentCanAccessFileUrls, True
        )

        self.setCentralWidget(self.view)
        self._load_content()

    def _setup_webengine(self):
        """配置 WebEngine Profile"""
        profile = QWebEngineProfile.defaultProfile()
        profile.setPersistentStoragePath(str(self._get_storage_path() / "webengine"))

    @staticmethod
    def get_storage_path() -> Path:
        """获取应用存储路径（静态方法，供 main.py 启动时使用）"""
        if sys.platform == "win32":
            base = Path.home() / "AppData" / "Roaming" / "iMooDesktop"
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support" / "iMooDesktop"
        else:
            base = Path.home() / ".local" / "share" / "iMooDesktop"
        base.mkdir(parents=True, exist_ok=True)
        return base

    def _get_storage_path(self) -> Path:
        """实例方法包装静态方法"""
        return MainWindow.get_storage_path()

    def _load_content(self):
        """加载前端内容"""
        if self.dev_mode:
            url = "http://localhost:5173/"
            logger.info(f"开发模式: 加载 {url}")
            self.view.setUrl(QUrl(url))
        else:
            # 发布模式: 加载本地构建产物
            if getattr(sys, "frozen", False):
                # PyInstaller 打包后
                base = Path(sys._MEIPASS) / "frontend" / "dist"
            elif "__compiled__" in dir():
                # Nuitka 打包后 __file__ 可能指向编译时源码路径；
                # 用 sys.argv[0] 定位运行时目录更可靠
                # （standalone: sys.argv[0] 是 .dist/iMooDesktop，parent 即 .dist 目录）
                base = Path(sys.argv[0]).parent / "frontend" / "dist"
            else:
                # 开发模式下 __file__ 指向源码目录，parent.parent 是项目根
                base = Path(__file__).parent.parent / "frontend" / "dist"

            index_html = base / "index.html"
            if not index_html.exists():
                logger.error(f"前端构建产物不存在: {index_html}")
                QMessageBox.critical(
                    self,
                    "错误",
                    f"前端构建产物不存在:\n{index_html}\n\n请先运行: cd frontend && bun run build",
                )
                return

            logger.info(f"发布模式: 加载 {index_html}")
            self.view.setUrl(QUrl.fromLocalFile(str(index_html)))

    def _on_console_message(self, level, message, line_number, source_id):
        """转发 JS 控制台消息到 Python 日志。

        签名与 ``QWebEnginePage.javaScriptConsoleMessage`` 一致：
        ``(level, message, line_number, source_id)``
        """
        level_map = {0: "INFO", 1: "WARNING", 2: "ERROR"}
        py_level_name = level_map.get(level, "INFO")
        # logging.getLevelName 传入字符串返回对应 int；传入 int 返回字符串，这里需要 int
        py_level = logging.getLevelName(py_level_name)
        if not isinstance(py_level, int):
            py_level = logging.INFO
        logger.log(
            py_level,
            f"[JS:{source_id}:{line_number}] {message}",
        )

    def closeEvent(self, event: QCloseEvent):
        """关闭窗口时清理"""
        logger.info("应用关闭")
        # 终止所有运行中的 worker（双保险；main.py 的 finally 也会再清理一次）
        if hasattr(self.bridge, "cleanup_workers"):
            try:
                self.bridge.cleanup_workers()
            except Exception:
                pass
        event.accept()
