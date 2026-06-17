"""
LogStore - 操作日志持久化

替代原项目 MySQL 的操作审计表，记录用户在本应用中执行的关键操作
（绑定/解绑设备、修改资料、发布动态等），用于故障排查与行为审计。

- 按日期滚动文件
- 内存保留最近 500 条供前端查看
- 持久化到 logs/ 目录
"""

import json
import logging
import os
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

logger = logging.getLogger(__name__)


class LogStore:
    """操作日志存储"""

    MAX_IN_MEMORY = 500
    LEVELS = ("INFO", "WARN", "ERROR", "DEBUG")

    def __init__(self, log_dir: Path):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._buffer: Deque[Dict[str, Any]] = deque(maxlen=self.MAX_IN_MEMORY)
        self._current_file: Optional[Path] = None
        self._current_date: Optional[str] = None

    def _get_file(self) -> Path:
        """按日期获取日志文件"""
        today = datetime.now().strftime("%Y-%m-%d")
        if today != self._current_date:
            self._current_date = today
            self._current_file = self.log_dir / f"ops-{today}.jsonl"
        return self._current_file

    def log(
        self,
        action: str,
        level: str = "INFO",
        message: str = "",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """写入一条日志"""
        if level not in self.LEVELS:
            level = "INFO"

        entry = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "level": level,
            "action": action,
            "message": message,
            "details": details or {},
        }

        # 内存缓冲（前端查看）
        self._buffer.append(entry)

        # 落盘
        try:
            f = self._get_file()
            with open(f, "a", encoding="utf-8") as fp:
                fp.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
        except Exception as e:
            logger.error(f"日志落盘失败: {e}")

    def info(self, action: str, message: str = "", **details) -> None:
        self.log(action, "INFO", message, details)

    def warn(self, action: str, message: str = "", **details) -> None:
        self.log(action, "WARN", message, details)

    def error(self, action: str, message: str = "", **details) -> None:
        self.log(action, "ERROR", message, details)

    def debug(self, action: str, message: str = "", **details) -> None:
        self.log(action, "DEBUG", message, details)

    def list_recent(self, limit: int = 100, level: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取最近的日志条目（从内存缓冲）"""
        items = list(self._buffer)
        if level:
            items = [x for x in items if x["level"] == level]
        # 倒序（最新在前）
        items = list(reversed(items))
        return items[:limit]

    def list_by_date(
        self,
        date_str: str,
        level: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """读取指定日期的全部日志，可选按 level 过滤与截取"""
        f = self.log_dir / f"ops-{date_str}.jsonl"
        if not f.exists():
            return []
        result = []
        try:
            with open(f, "r", encoding="utf-8") as fp:
                for line in fp:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if level and entry.get("level") != level:
                        continue
                    result.append(entry)
        except Exception as e:
            logger.error(f"读取日志文件失败 {f}: {e}")
        result = list(reversed(result))
        if limit is not None:
            result = result[:limit]
        return result

    def list_dates(self) -> List[str]:
        """列出所有有日志的日期（倒序）"""
        dates = []
        for f in self.log_dir.glob("ops-*.jsonl"):
            name = f.stem  # ops-2025-01-17
            date_str = name[4:] if name.startswith("ops-") else name
            dates.append(date_str)
        return sorted(dates, reverse=True)

    def clear(self) -> None:
        """清空所有日志（谨慎）"""
        self._buffer.clear()
        for f in self.log_dir.glob("ops-*.jsonl"):
            try:
                f.unlink()
            except OSError:
                pass
