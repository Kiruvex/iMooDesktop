"""
Worker 基类与批量任务 Worker

所有耗时操作（HTTP API、长任务）必须通过 Worker 在 QThread 中执行，
避免阻塞 Qt 主线程（即 UI 线程）。

设计要点：
- BaseWorker 包装任意 callable，run() 在子线程执行
- BatchWorker 支持生成器（yield dict）+ 进度回调 + 取消
- 信号通过 Qt 自动 Queued 连接回主线程，安全更新 UI
- QThread.finished → deleteLater，避免 C++ 对象泄漏
"""

import json
import logging
from typing import Any, Callable, Iterable, Optional
from PySide6.QtCore import QThread, Signal

logger = logging.getLogger(__name__)


class BaseWorker(QThread):
    """通用 Worker：包装任意可调用对象在子线程执行"""

    finished_ok = Signal(object)  # 成功结果
    finished_err = Signal(str)    # 错误信息
    progress = Signal(str)        # 进度消息（可选）

    def __init__(self, func: Callable, *args, **kwargs):
        super().__init__()
        self._func = func
        self._args = args
        self._kwargs = kwargs
        # 标记函数名用于日志
        self._name = getattr(func, "__name__", repr(func))
        # 线程结束时自动清理 C++ 资源
        self.finished.connect(self.deleteLater)

    def run(self):
        try:
            logger.debug(f"Worker 开始执行: {self._name}")
            result = self._func(*self._args, **self._kwargs)
            self.finished_ok.emit(result)
        except Exception as e:
            logger.exception(f"Worker 执行失败: {self._name}")
            self.finished_err.emit(str(e))


class BatchWorker(QThread):
    """
    批量任务 Worker：支持进度回调与取消。

    :param iterator_factory: 返回迭代器的可调用对象。
        每次迭代应返回 dict，至少含 ``success: bool`` 字段，可选 ``message: str``。
        若 dict 含 ``friend_name`` / ``friend_id`` 等字段，progress.emit 的 msg 会被
        编码为 JSON 字符串 ``{"text": str, "detail": {...}}`` 供前端展示实时日志流。
        否则降级为纯文本 ``message`` 或默认 "处理 X/Y"。
    :param total_hint: 可选的总数预估（用于初始化进度条）
    :param cancel_check: 可选的外部取消检查回调，返回 True 表示请求取消。
        主要用于让生成器内部能感知取消（例如通过 threading.Event 透传）。
    """

    progress = Signal(int, int, str)      # current, total, message
    finished_ok = Signal(object)          # {"success": int, "total": int, "errors": int}
    finished_err = Signal(str)

    def __init__(
        self,
        iterator_factory: Callable[..., Iterable[dict]],
        *args,
        total_hint: int = 0,
        cancel_check: Optional[Callable[[], bool]] = None,
        **kwargs,
    ):
        super().__init__()
        self._factory = iterator_factory
        self._args = args
        self._kwargs = kwargs
        self._total_hint = total_hint
        self._cancelled = False
        self._cancel_check = cancel_check
        self._name = getattr(iterator_factory, "__name__", "batch")
        # 线程结束时自动清理 C++ 资源
        self.finished.connect(self.deleteLater)

    def cancel(self):
        """请求取消（协作式，需 iterator 内自行检查）"""
        self._cancelled = True
        self.requestInterruption()

    @property
    def is_cancelled(self) -> bool:
        if self._cancelled or self.isInterruptionRequested():
            return True
        if self._cancel_check is not None:
            try:
                return bool(self._cancel_check())
            except Exception:
                return False
        return False

    def run(self):
        try:
            total = 0
            success = 0
            errors = 0
            skipped = 0

            self.progress.emit(0, self._total_hint, "任务启动...")

            for result in self._factory(*self._args, **self._kwargs):
                # 每次生成器 yield 后检查取消（粒度：单个好友完成时）
                if self.is_cancelled:
                    self.progress.emit(success, total, "已取消（当前任务完成后停止）")
                    self.finished_ok.emit(
                        {
                            "success": success,
                            "total": total,
                            "errors": errors,
                            "skipped": skipped,
                            "cancelled": True,
                        }
                    )
                    return

                total += 1
                if isinstance(result, dict):
                    if result.get("success"):
                        success += 1
                    else:
                        errors += 1
                    msg = self._build_progress_msg(result, success, total)
                else:
                    # 非 dict 迭代值视为失败/跳过，避免无声计 success
                    skipped += 1
                    msg = f"处理 {success}/{total}"

                self.progress.emit(success, total, msg)

            self.progress.emit(success, total, f"完成: {success}/{total} 成功")
            self.finished_ok.emit(
                {
                    "success": success,
                    "total": total,
                    "errors": errors,
                    "skipped": skipped,
                    "cancelled": False,
                }
            )
        except Exception as e:
            logger.exception(f"BatchWorker 执行失败: {self._name}")
            self.finished_err.emit(str(e))

    @staticmethod
    def _build_progress_msg(result: dict, success: int, total: int) -> str:
        """根据生成器 yield 的 dict 构造 progress.emit 的 msg。

        - 含 ``friend_name`` 或 ``friend_id`` 字段时：返回 JSON 字符串
          ``{"text": "<友好文本>", "detail": {friend, friend_id, status, response, error, total_friends}}``
          前端可 JSON.parse 后展示结构化实时日志。
        - 否则降级为纯文本（优先 result['message']，默认 "处理 X/Y"）。
        """
        friend_name = result.get("friend_name")
        has_friend_id = "friend_id" in result
        # 判断是否为结构化日志（likeall 风格）
        if friend_name is not None or has_friend_id:
            is_success = bool(result.get("success"))
            detail = {
                "friend": friend_name or "",
                "friend_id": result.get("friend_id", ""),
                "status": "success" if is_success else "failed",
                "response": result.get("response", ""),
                "error": result.get("reason", ""),
                "total_friends": result.get("total_friends", 0),
            }
            text = f"{detail['friend'] or '好友'}: {'✓' if is_success else '✗'}"
            return json.dumps({"text": text, "detail": detail}, ensure_ascii=False)
        # 降级路径：优先 message 字段
        return result.get("message", f"处理 {success}/{total}")


__all__ = ["BaseWorker", "BatchWorker"]
