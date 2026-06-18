#!/usr/bin/env python3
"""
iMoo Desktop - 应用入口

使用方式:
  开发模式: python main.py --dev    (加载 http://localhost:5173)
  发布模式: python main.py          (加载本地 frontend/dist/index.html)
"""

import sys
import argparse
import logging
import logging.handlers
from pathlib import Path

# 确保项目根目录在 path 中
# Nuitka 打包后 __file__ 可能指向编译时源码路径（默认 --file-reference-choice=original），
# 用 sys.argv[0] 定位运行时目录更可靠；详见 build.py 的 --file-reference-choice=runtime
if "__compiled__" in dir() or getattr(sys, "frozen", False):
    ROOT = Path(sys.argv[0]).parent.resolve()
else:
    ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))

from PySide6.QtWidgets import QApplication, QMessageBox, QDialog, QVBoxLayout, QPlainTextEdit, QPushButton, QHBoxLayout, QLabel
from PySide6.QtCore import Qt
from PySide6.QtGui import QPalette

from shell.main_window import MainWindow
from core.watch_api import WatchAPI
from storage.config_store import ConfigStore
from storage.cache_store import CacheStore
from storage.log_store import LogStore
from bridge.app_bridge import AppBridge

# Windows 控制台默认 cp1252/gbk，print 中文会 UnicodeEncodeError
# 强制 stdout/stderr 用 utf-8（Python 3.7+ 支持 reconfigure）
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _find_eula_path() -> Path:
    """定位 EULA.txt：Nuitka 打包后用 sys.argv[0] 目录，开发模式用 ROOT"""
    candidates = []
    if "__compiled__" in dir() or getattr(sys, "frozen", False):
        candidates.append(Path(sys.argv[0]).parent / "EULA.txt")
        # PyInstaller onefile 解压目录
        if getattr(sys, "_MEIPASS", None):
            candidates.append(Path(sys._MEIPASS) / "EULA.txt")
    candidates.append(ROOT / "EULA.txt")
    for p in candidates:
        if p.exists():
            return p
    return ROOT / "EULA.txt"  # 回退，即使不存在也返回（调用方处理）


def _is_dark_mode() -> bool:
    """检测系统当前是否为深色模式（QApplication 必须已创建）"""
    try:
        palette = QApplication.palette()
        # Window 背景亮度 < 128 视为深色
        return palette.color(QPalette.Window).value() < 128
    except Exception:
        return False


def show_eula_dialog(config_store: ConfigStore) -> bool:
    """显示 EULA 对话框。返回 True 表示用户同意，False 表示拒绝（应退出）。"""
    eula_path = _find_eula_path()
    try:
        eula_text = eula_path.read_text(encoding="utf-8")
    except Exception as e:
        QMessageBox.critical(
            None,
            "无法加载许可协议",
            f"无法读取最终用户许可协议（EULA.txt）：\n{e}\n\n应用将退出。",
        )
        return False

    dark = _is_dark_mode()
    # 根据系统主题选择颜色方案，避免深色模式下浅底浅字看不见
    if dark:
        # 深色模式
        dlg_bg = "#1e293b"          # slate-800
        text_bg = "#0f172a"         # slate-900（比窗口更深，层次感）
        text_color = "#f1f5f9"      # slate-100
        border_color = "#334155"    # slate-700
        hint_color = "#94a3b8"      # slate-400
        decline_bg = "#334155"
        decline_color = "#e2e8f0"
        decline_hover = "#475569"
    else:
        # 浅色模式
        dlg_bg = "#ffffff"
        text_bg = "#f9fafb"         # gray-50
        text_color = "#111827"      # gray-900
        border_color = "#e5e7eb"    # gray-200
        hint_color = "#6b7280"      # gray-500
        decline_bg = "#ffffff"
        decline_color = "#374151"
        decline_hover = "#f3f4f6"

    dialog = QDialog()
    dialog.setWindowTitle("iMoo Desktop 最终用户许可协议")
    dialog.setModal(True)
    dialog.resize(680, 560)
    dialog.setMinimumSize(560, 420)
    # 对话框背景跟随主题
    dialog.setStyleSheet(f"QDialog {{ background: {dlg_bg}; }}")

    layout = QVBoxLayout(dialog)
    layout.setContentsMargins(16, 16, 16, 16)
    layout.setSpacing(10)

    # 标题
    title = QLabel("请阅读并同意最终用户许可协议（EULA）")
    title.setStyleSheet(
        f"font-size: 15px; font-weight: 600; color: {text_color}; background: transparent;"
    )
    layout.addWidget(title)

    hint = QLabel("同意后方可使用本软件。若不同意，应用将退出。")
    hint.setStyleSheet(f"color: {hint_color}; font-size: 12px; background: transparent;")
    layout.addWidget(hint)

    # EULA 正文（可滚动 + 可复制）— 文字色 + 背景色都显式设置，确保深色模式可读
    text_edit = QPlainTextEdit()
    text_edit.setPlainText(eula_text)
    text_edit.setReadOnly(True)
    text_edit.setLineWrapMode(QPlainTextEdit.WidgetWidth)
    text_edit.setStyleSheet(
        f"QPlainTextEdit {{"
        f"  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;"
        f"  font-size: 12px; line-height: 1.6;"
        f"  background: {text_bg};"
        f"  color: {text_color};"
        f"  border: 1px solid {border_color};"
        f"  border-radius: 8px; padding: 8px;"
        f"}}"
    )
    layout.addWidget(text_edit)

    # 按钮区
    btn_layout = QHBoxLayout()
    btn_layout.addStretch()

    decline_btn = QPushButton("不同意，退出")
    decline_btn.setStyleSheet(
        f"QPushButton {{ padding: 8px 16px; border-radius: 8px;"
        f"  border: 1px solid {border_color}; background: {decline_bg}; color: {decline_color}; }}"
        f"QPushButton:hover {{ background: {decline_hover}; }}"
    )
    accept_btn = QPushButton("我已阅读并同意")
    accept_btn.setStyleSheet(
        "QPushButton { padding: 8px 16px; border-radius: 8px;"
        "  border: none; background: #3b82f6; color: white; font-weight: 500; }"
        "QPushButton:hover { background: #2563eb; }"
    )
    btn_layout.addWidget(decline_btn)
    btn_layout.addWidget(accept_btn)
    layout.addLayout(btn_layout)

    # 默认焦点在"不同意"上，避免误点同意（强迫用户主动选）
    decline_btn.setDefault(True)
    decline_btn.setFocus()

    # 信号
    def on_accept():
        dialog.done(QDialog.Accepted)

    def on_decline():
        dialog.done(QDialog.Rejected)

    accept_btn.clicked.connect(on_accept)
    decline_btn.clicked.connect(on_decline)

    result = dialog.exec()
    if result == QDialog.Accepted:
        config_store.accept_eula()
        return True
    return False


def setup_logging(log_dir: Path):
    """配置日志系统：控制台 + 滚动文件"""
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.handlers.RotatingFileHandler(
                log_dir / "app.log",
                maxBytes=2 * 1024 * 1024,
                backupCount=5,
                encoding="utf-8",
            ),
        ],
    )


class LogStoreHandler(logging.Handler):
    """将标准 logging 输出转发到 LogStore，供前端查看"""

    _LEVEL_MAP = {
        logging.DEBUG: "DEBUG",
        logging.INFO: "INFO",
        logging.WARNING: "WARN",
        logging.ERROR: "ERROR",
        logging.CRITICAL: "ERROR",
    }

    def __init__(self, log_store):
        super().__init__()
        self._log_store = log_store

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = self._LEVEL_MAP.get(record.levelno, "INFO")
            # DEBUG 在 LogStore 中有定义但默认应用日志级别是 INFO，
            # 这里仍然转发，让前端能查看到调试日志
            action = record.name or "app"
            message = record.getMessage()
            self._log_store.log(action=action, level=level, message=message)
        except Exception:
            # 日志转发失败不能影响主流程
            self.handleError(record)


def main():
    parser = argparse.ArgumentParser(description="iMoo Desktop")
    parser.add_argument("--dev", action="store_true", help="开发模式 (加载 Vite dev server)")
    args = parser.parse_args()

    # 存储目录
    storage_dir = MainWindow.get_storage_path()
    setup_logging(storage_dir / "logs")

    app = QApplication(sys.argv)
    app.setApplicationName("iMoo Desktop")
    app.setApplicationVersion("1.0.0-dev")
    app.setOrganizationName("iMooDesktop")

    # 高 DPI 支持：Qt6 默认启用，且 AA_UseHighDpiPixmaps 在 PySide6 6.x 已移除
    # app.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    # 初始化核心组件
    config_store = ConfigStore(storage_dir / "config.json")
    cache_store = CacheStore(storage_dir / "cache.json")
    log_store = LogStore(storage_dir / "logs")
    # 将标准 logging 输出转发到 LogStore，让前端能看到应用运行日志
    logging.getLogger().addHandler(LogStoreHandler(log_store))
    watch_api = WatchAPI(ROOT / "config.yaml")

    # EULA 检查：未同意当前版本则弹窗，拒绝则退出
    _cfg = config_store.load()
    logging.getLogger(__name__).info(
        f"EULA 状态: accepted={_cfg.eula_accepted}, stored_version={_cfg.eula_version!r}, "
        f"current_version={config_store.CURRENT_EULA_VERSION!r}, "
        f"is_accepted={config_store.is_eula_accepted()}"
    )
    if not config_store.is_eula_accepted():
        logging.getLogger(__name__).info("EULA 未同意，显示许可协议对话框")
        if not show_eula_dialog(config_store):
            logging.getLogger(__name__).info("用户拒绝 EULA，应用退出")
            sys.exit(0)
        logging.getLogger(__name__).info("用户已同意 EULA")

    # 启动时清理过期缓存
    removed = cache_store.cleanup_expired()
    if removed:
        logging.getLogger(__name__).info(f"启动清理过期缓存: {removed} 项")

    # 创建桥接器
    bridge = AppBridge(
        api=watch_api,
        config=config_store,
        cache=cache_store,
        log_store=log_store,
    )

    # 创建主窗口
    window = MainWindow(bridge=bridge, dev_mode=args.dev)
    window.show()

    exit_code = 1
    try:
        exit_code = app.exec()
    finally:
        try:
            bridge.cleanup_workers()
        except Exception:
            pass
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
