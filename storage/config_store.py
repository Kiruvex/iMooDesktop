"""
配置存储 - 使用 JSON 文件持久化设备绑定与应用设置
"""

import json
import logging
import os
from pathlib import Path
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


def _filter_dataclass(cls, data: dict) -> dict:
    """过滤字典中不属于 dataclass 的键，避免 TypeError。"""
    if not isinstance(data, dict):
        return {}
    allowed = getattr(cls, "__dataclass_fields__", {})
    return {k: v for k, v in data.items() if k in allowed}


@dataclass
class DeviceConfig:
    """设备绑定配置"""
    chipid: str = ""
    bindnumber: str = ""
    watchid: str = ""
    model: str = ""
    imaccountid: str = ""
    name: str = ""
    bound_at: str = ""

    @property
    def is_bound(self) -> bool:
        return bool(self.chipid and self.bindnumber)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AppConfig:
    """应用配置"""
    device: Optional[DeviceConfig] = None
    theme: str = "light"
    last_page: str = "home"
    cache_ttl_hours: int = 24
    version: str = "1.0.0-dev"
    # EULA 同意状态：eula_accepted=True 且 eula_version 匹配当前 EULA 版本才视为已同意
    eula_accepted: bool = False
    eula_version: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


class ConfigStore:
    """配置存储管理器"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._cache: Optional[AppConfig] = None
        self._cache_mtime: Optional[float] = None

    def load(self) -> AppConfig:
        """加载配置，带内存缓存；检测文件 mtime 变化则重读"""
        # 检查文件是否在外部被修改
        try:
            mtime = self.path.stat().st_mtime if self.path.exists() else None
        except OSError:
            mtime = None
        if self._cache is not None and mtime == self._cache_mtime:
            return self._cache

        if not self.path.exists():
            self._cache = AppConfig()
            self._cache_mtime = None
            return self._cache

        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
            device_data = data.get("device")
            device = None
            if device_data:
                # 容错：过滤未知字段
                try:
                    device = DeviceConfig(**_filter_dataclass(DeviceConfig, device_data))
                except Exception as e:
                    logger.warning(f"设备配置字段非法，忽略 device: {e}")
                    device = None
            # 容错：过滤 AppConfig 未知字段
            app_fields = _filter_dataclass(AppConfig, data)
            app_fields["device"] = device
            self._cache = AppConfig(**app_fields)
            self._cache_mtime = mtime
        except Exception as e:
            logger.warning(f"加载配置失败，使用默认值: {e}")
            self._cache = AppConfig()
            self._cache_mtime = mtime
        return self._cache

    def save(self, config: AppConfig) -> None:
        """保存配置（原子写）"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._cache = config
        data = config.to_dict()
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        try:
            tmp.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(tmp, self.path)
            # 保护设备凭据（chipid/bindnumber/imaccountid）：限制文件权限为 owner-only
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                # Windows/非 POSIX 文件系统不支持 chmod 完整语义，忽略即可
                pass
            try:
                self._cache_mtime = self.path.stat().st_mtime
            except OSError:
                self._cache_mtime = None
        except Exception as e:
            logger.error(f"保存配置失败: {e}")
            try:
                if tmp.exists():
                    tmp.unlink()
            except OSError:
                pass
            return
        logger.debug(f"配置已保存到 {self.path}")

    def get_device(self) -> Optional[DeviceConfig]:
        return self.load().device

    def set_device(self, device: DeviceConfig) -> None:
        config = self.load()
        config.device = device
        self.save(config)

    def clear_device(self) -> None:
        config = self.load()
        config.device = None
        self.save(config)

    def update_device(self, **kwargs) -> Optional[DeviceConfig]:
        """部分更新设备信息"""
        config = self.load()
        if not config.device:
            return None
        for k, v in kwargs.items():
            if hasattr(config.device, k) and v is not None:
                setattr(config.device, k, v)
        self.save(config)
        return config.device

    # ===== EULA 同意状态 =====
    # 当前 EULA 版本（与 EULA.txt 的"协议版本"绑定；升级 EULA 时改这里，用户需重新同意）
    CURRENT_EULA_VERSION = "v1.0"

    def is_eula_accepted(self) -> bool:
        """是否已同意当前版本的 EULA"""
        config = self.load()
        return bool(config.eula_accepted) and config.eula_version == self.CURRENT_EULA_VERSION

    def accept_eula(self) -> None:
        """记录用户同意当前版本 EULA"""
        config = self.load()
        config.eula_accepted = True
        config.eula_version = self.CURRENT_EULA_VERSION
        self.save(config)

    def revoke_eula(self) -> None:
        """撤销 EULA 同意（用于"撤销同意"场景，如下次启动重新弹窗）"""
        config = self.load()
        config.eula_accepted = False
        config.eula_version = ""
        self.save(config)
