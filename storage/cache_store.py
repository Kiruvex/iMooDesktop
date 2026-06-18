"""
CacheStore - 本地缓存存储

替代原项目的 MySQL 缓存表，用于保存好友列表、动态列表等
请求结果，避免重复调用远端 API。带 TTL 过期机制。
"""

import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    """单条缓存"""
    key: str
    value: Any
    created_at: float  # epoch seconds
    ttl: int  # seconds, 0 = never expire

    def is_expired(self) -> bool:
        if self.ttl <= 0:
            return False
        return (time.time() - self.created_at) > self.ttl

    @classmethod
    def from_dict(cls, entry_dict: Dict[str, Any]) -> Optional["CacheEntry"]:
        """从容错地构造 CacheEntry：忽略未知字段，坏条目返回 None。"""
        if not isinstance(entry_dict, dict):
            return None
        allowed = cls.__dataclass_fields__
        filtered = {k: v for k, v in entry_dict.items() if k in allowed}
        try:
            return cls(**filtered)
        except TypeError:
            return None


class CacheStore:
    """
    缓存管理器。

    - 持久化到 cache.json（原子写：临时文件 + os.replace）
    - 内存优先，写入时同步落盘
    - 多线程安全：内部 RLock 保护
    - 默认 TTL 1 小时，可在 set 时覆盖
    """

    DEFAULT_TTL = 3600  # 1h

    def __init__(self, path: Path):
        self.path = Path(path)
        self._cache: Dict[str, dict] = {}
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        with self._lock:
            if not self.path.exists():
                return
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    # 过滤掉无法解析为 CacheEntry 的坏条目
                    cleaned: Dict[str, dict] = {}
                    for k, v in data.items():
                        if CacheEntry.from_dict(v) is not None:
                            cleaned[k] = v
                        else:
                            logger.debug(f"跳过坏缓存条目: {k}")
                    self._cache = cleaned
            except Exception as e:
                logger.warning(f"加载缓存失败，将使用空缓存: {e}")
                self._cache = {}

    def _persist(self) -> None:
        """原子写：写到临时文件，再 os.replace 覆盖目标。"""
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp.write_text(
                json.dumps(self._cache, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
            os.replace(tmp, self.path)
            # 缓存中可能含设备凭据相关数据（如好友列表带 imaccountid），限制权限为 owner-only
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                # Windows/非 POSIX 文件系统不支持 chmod 完整语义，忽略即可
                pass
        except Exception as e:
            logger.error(f"缓存落盘失败: {e}")

    def get(self, key: str, default: Any = None) -> Any:
        expired_keys: list = []
        result = default
        with self._lock:
            entry_dict = self._cache.get(key)
            if not entry_dict:
                return default
            entry = CacheEntry.from_dict(entry_dict)
            if entry is None:
                # 坏条目，标记删除
                expired_keys.append(key)
                return default
            if entry.is_expired():
                expired_keys.append(key)
                result = default
            else:
                result = entry.value
            # 统一清理过期项，避免每次命中都落盘
            if expired_keys:
                for k in expired_keys:
                    self._cache.pop(k, None)
                self._persist()
        return result

    def set(self, key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
        entry = CacheEntry(
            key=key,
            value=value,
            created_at=time.time(),
            ttl=ttl,
        )
        with self._lock:
            self._cache[key] = asdict(entry)
            self._persist()

    def delete(self, key: str) -> None:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                self._persist()

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._persist()

    def cleanup_expired(self) -> int:
        """清理所有过期项，返回清理数量"""
        removed = 0
        with self._lock:
            for key in list(self._cache.keys()):
                entry = CacheEntry.from_dict(self._cache[key])
                if entry is None or entry.is_expired():
                    del self._cache[key]
                    removed += 1
            if removed:
                self._persist()
        return removed

    # ===== 业务快捷方法 =====
    def get_friends(self, watchid: str) -> Optional[list]:
        return self.get(f"friends:{watchid}")

    def set_friends(self, watchid: str, friends: list) -> None:
        # 好友列表 24 小时缓存
        self.set(f"friends:{watchid}", friends, ttl=86400)

    def get_moments(self, watchid: str, page: int) -> Optional[dict]:
        return self.get(f"moments:{watchid}:{page}")

    def set_moments(self, watchid: str, page: int, data: dict) -> None:
        # 动态 10 分钟缓存（变化频繁）
        self.set(f"moments:{watchid}:{page}", data, ttl=600)
