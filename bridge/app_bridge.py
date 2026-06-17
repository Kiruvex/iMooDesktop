"""
AppBridge - Python ↔ JS 通信桥梁

通过 QWebChannel 暴露给前端：
- ``call_api(request_id, payload)`` — 同步入口，异步执行 WatchAPI 任意方法
- ``start_task(task_id, name, payload)`` — 长任务（生成器）+ 进度流
- ``cancel_task(task_id)`` — 取消长任务
- ``ping()`` — 心跳检测

信号回传到 JS：
- ``api_result(request_id, json)`` — 成功
- ``api_error(request_id, msg)`` — 失败
- ``task_progress(task_id, current, total, msg)``
  * msg 可能是纯文本（状态提示），也可能是 JSON 字符串
  * JSON 结构：``{"text": "<友好文本>", "detail": {friend, friend_id, status, response, error, total_friends}}``
  * 前端可 try/catch JSON.parse 区分两种情况，用于展示实时日志流
- ``task_done(task_id, success, msg)``
- ``log_message(level, msg)`` — 通知前端日志面板
- ``device_changed(device_json)`` — 设备绑定状态变化
"""

import json
import logging
import os
import platform
import sys
import time
from datetime import datetime
from typing import Any, Callable, Dict, Optional

from PySide6.QtCore import QObject, Signal, Slot

from core.watch_api import WatchAPI
from core.num_crypto import process_adb_new, process_self_check_new
from core.moment_parser import MomentParser
from storage.config_store import ConfigStore, DeviceConfig
from storage.cache_store import CacheStore
from storage.log_store import LogStore
from workers.base_worker import BaseWorker, BatchWorker

logger = logging.getLogger(__name__)


class AppBridge(QObject):
    """暴露给前端的桥接对象"""

    # ===== 信号（发送给 JS） =====
    api_result = Signal(str, str)                # (request_id, result_json)
    api_error = Signal(str, str)                 # (request_id, error_msg)
    task_progress = Signal(str, int, int, str)   # (task_id, current, total, msg)
    task_done = Signal(str, bool, str)           # (task_id, success, msg)
    log_message = Signal(str, str)               # (level, msg)
    device_changed = Signal(str)                 # (device_json_or_empty)

    # ===== 需要设备四元组自动注入的方法白名单 =====
    # momentpic 不在此列表：因参数签名特殊（接收 image_base64 + content，而非 url），
    # 在 call_api 中特判走 _start_momentpic_worker。
    _DEVICE_REQUIRED_METHODS = frozenset(
        {
            "friendslist",
            "name",
            "sign",
            "realname",
            "appsearch",
            "moment",
            "momentblue",
            "delmoment",
            "likeall",
            "step",
            "getyk",
            "getlike",
            "getlike_hasid",
            "add_friend",
            "getfriend2",
            "personalinfo",
            "getfriend",
            "momentlink",
            "momentview",
            "sport_fifty",
            "sport_rope",
            "sport_bm",
        }
    )

    # ===== 允许作为长任务启动的方法白名单（生成器型）=====
    _TASK_ALLOWED = frozenset({"likeall"})

    # ===== 不需要走 Worker 的本地方法 =====
    # 注意：bind_device 虽然也需走 Worker（内部做 HTTP），
    # 但其处理函数仍是本地实现，在 call_api 中特判后用 BaseWorker 包装。
    # refresh_device 内部调 get_info（网络请求），一般 <1s；同步实现简净，
    # 若 UI 卡顿可后续改为 Worker。
    _LOCAL_METHODS = frozenset(
        {
            "get_version",
            "get_config",
            "set_config",
            "unbind_device",
            "refresh_device",
            "calc_adb",
            "calc_zj",
            "get_logs",
            "get_log_dates",
            "clear_logs",
            "cache_clear",
            "get_eula",
            "get_eula_status",
            "ping",
        }
    )

    def __init__(
        self,
        api: WatchAPI,
        config: ConfigStore,
        cache: Optional[CacheStore] = None,
        log_store: Optional[LogStore] = None,
    ):
        super().__init__()
        self.api = api
        self.config = config
        self.cache = cache
        self.log_store = log_store
        self._workers: Dict[str, BaseWorker] = {}
        # 本地方法 handler 表只构建一次
        self._LOCAL_HANDLERS: Dict[str, Callable[..., dict]] = {
            "get_version": self._handle_get_version,
            "get_config": self._handle_get_config,
            "set_config": self._handle_set_config,
            "unbind_device": self._handle_unbind_device,
            "refresh_device": self._handle_refresh_device,
            "calc_adb": self._handle_calc_adb,
            "calc_zj": self._handle_calc_zj,
            "get_logs": self._handle_get_logs,
            "get_log_dates": self._handle_get_log_dates,
            "clear_logs": self._handle_clear_logs,
            "cache_clear": self._handle_cache_clear,
            "get_eula": self._handle_get_eula,
            "get_eula_status": self._handle_get_eula_status,
            "ping": self._handle_ping,
        }

    # ===== Slot: 心跳 =====
    @Slot(result=str)
    def ping(self) -> str:
        """心跳检测，返回时间戳"""
        return json.dumps({"ts": time.time(), "ok": True})

    # ===== Slot: 前端调用 API 入口 =====
    @Slot(str, str)
    def call_api(self, request_id: str, payload: str):
        """前端调用 API 的统一入口"""
        try:
            data = json.loads(payload)
            method = data.get("method", "")
            args = data.get("args", {}) or {}
        except json.JSONDecodeError as e:
            self.api_error.emit(request_id, f"参数解析失败: {e}")
            return

        if not method:
            self.api_error.emit(request_id, "method 不能为空")
            return

        logger.info(f"[API] {request_id} -> {method}({list(args.keys())})")

        # bind_device：内部要做 HTTP 验证，必须走 Worker 避免阻塞 UI
        if method == "bind_device":
            self._start_bind_device_worker(request_id, args)
            return

        # upload_image：图片上传（Pillow 转 WebP + 七牛上传），需特殊参数处理
        # 前端传 {"image_base64": "..."}，base64 解码后送入 ImageUploader
        # 不在 _DEVICE_REQUIRED_METHODS（不需要设备）也不在 _LOCAL_METHODS（网络请求需 Worker）
        if method == "upload_image":
            self._start_upload_image_worker(request_id, args)
            return

        # send_im：发送真实 IM 消息（TLV 协议，gw.im.okii.com:8000）
        # 前端传 {friend_id, friend_im_id, content}，需设备四元组 + imaccountid
        # 涉及 socket 连接（connect+register+login+send+disconnect，2-5 秒），必须走 Worker
        # 不在 _LOCAL_METHODS（同步会阻塞 UI）也不在 _DEVICE_REQUIRED_METHODS（参数注入规则不同）
        if method == "send_im":
            self._start_send_im_worker(request_id, args)
            return

        # momentpic：发布图片动态（4 步流程：转 WebP + 取凭证 + 七牛上传 + 发布）
        # 前端传 {image_base64, content}，参数签名与其他 DEVICE_REQUIRED 方法不同，
        # 不走自动注入；设备四元组在 _start_momentpic_worker 内部从 device 注入
        if method == "momentpic":
            self._start_momentpic_worker(request_id, args)
            return

        # 本地方法（同步执行，速度快不需要 Worker）
        if method in self._LOCAL_METHODS:
            self._dispatch_local(request_id, method, args)
            return

        # 设备必要方法：未绑定时直接报错，不启动 Worker
        if method in self._DEVICE_REQUIRED_METHODS:
            device = self.config.get_device()
            if not device or not device.is_bound:
                msg = "设备未绑定"
                self.api_error.emit(request_id, msg)
                if self.log_store:
                    self.log_store.error(action=method, message=msg)
                return

        # WatchAPI 远程方法（走 Worker 避免阻塞 UI）
        api_func = getattr(self.api, method, None)
        if api_func is None or not callable(api_func):
            self.api_error.emit(request_id, f"未知 API 方法: {method}")
            return

        # 设备四元组自动注入
        args = self._inject_device(method, args)

        # momentview 走解析器（含缓存逻辑）
        if method == "momentview":
            original_args = dict(args)
            api_func = self._wrap_momentview(api_func, original_args, request_id)
        elif method == "friendslist":
            original_args = dict(args)
            api_func = self._wrap_friendslist(api_func, original_args, request_id)

        worker = BaseWorker(api_func, **args)
        worker.finished_ok.connect(
            lambda r, rid=request_id: self._on_worker_ok(rid, r, method)
        )
        worker.finished_err.connect(
            lambda e, rid=request_id, m=method: self._on_worker_err(rid, e, m)
        )
        # 防止 worker 被 GC，并在结束后自动清理与 deleteLater
        self._workers[request_id] = worker
        worker.finished.connect(worker.deleteLater)
        worker.finished.connect(lambda _=None, rid=request_id: self._workers.pop(rid, None))
        worker.start()

    def _start_bind_device_worker(self, request_id: str, args: Dict[str, Any]) -> None:
        """在 Worker 中执行 _handle_bind_device，避免阻塞 UI 线程。"""
        # 参数校验在 worker 内部完成，这里只负责启动
        worker = BaseWorker(self._handle_bind_device, **args)
        worker.finished_ok.connect(
            lambda r, rid=request_id: self._on_worker_ok(rid, r, "bind_device")
        )
        worker.finished_err.connect(
            lambda e, rid=request_id, m="bind_device": self._on_worker_err(rid, e, m)
        )
        self._workers[request_id] = worker
        worker.finished.connect(worker.deleteLater)
        worker.finished.connect(lambda _=None, rid=request_id: self._workers.pop(rid, None))
        worker.start()

    def _start_upload_image_worker(self, request_id: str, args: Dict[str, Any]) -> None:
        """在 Worker 中执行图片上传（Pillow 转 WebP + 七牛上传），避免阻塞 UI 线程。

        前端 payload: ``{"image_base64": "<base64-encoded image bytes>"}``
        可选参数: ``quality`` (int, default 80), ``max_size`` ([w, h], default [1280, 1280])
        返回: ``{"key": str, "url": str, "size": int, "raw": dict}``

        ImageUploader 不需要设备四元组，可在未绑定状态下使用。
        """
        import base64

        from core.image_uploader import ImageUploader

        image_b64 = args.get("image_base64", "")
        if not image_b64:
            self.api_error.emit(request_id, "image_base64 不能为空")
            return

        # base64 解码（允许前端传带 data:image/png;base64, 前缀的 data URL）
        if "," in image_b64 and image_b64.startswith("data:"):
            image_b64 = image_b64.split(",", 1)[1]

        try:
            image_data = base64.b64decode(image_b64)
        except Exception as e:
            self.api_error.emit(request_id, f"base64 解码失败: {e}")
            return

        # 从 config 读取七牛上传地址与 CDN 域名
        api_config = {}
        try:
            api_config = self.api.config.get("api_config", {}) or {}
        except Exception:
            pass
        upload_url = api_config.get("UPLOAD_DOMAIN", "http://upload.qiniup.com")
        cdn_domain = api_config.get("QINIU_CDN_DOMAIN", "https://qpic.cn")

        uploader = ImageUploader(upload_url=upload_url, cdn_domain=cdn_domain)

        # 可选参数：quality, max_size（前端可传 [w, h] 数组）
        quality = args.get("quality", 80)
        try:
            quality = int(quality)
        except (TypeError, ValueError):
            quality = 80
        max_size = args.get("max_size", (1280, 1280))
        if isinstance(max_size, (list, tuple)) and len(max_size) == 2:
            try:
                max_size = (int(max_size[0]), int(max_size[1]))
            except (TypeError, ValueError):
                max_size = (1280, 1280)
        else:
            max_size = (1280, 1280)

        # 闭包捕获 uploader 与参数，BaseWorker 只接受无参 callable
        def upload_task():
            return uploader.upload_image(image_data, quality=quality, max_size=max_size)

        upload_task.__name__ = "upload_image"

        worker = BaseWorker(upload_task)
        worker.finished_ok.connect(
            lambda r, rid=request_id: self._on_worker_ok(rid, r, "upload_image")
        )
        worker.finished_err.connect(
            lambda e, rid=request_id, m="upload_image": self._on_worker_err(rid, e, m)
        )
        self._workers[request_id] = worker
        worker.finished.connect(worker.deleteLater)
        worker.finished.connect(lambda _=None, rid=request_id: self._workers.pop(rid, None))
        worker.start()

        if self.log_store:
            self.log_store.info(
                action="upload_image",
                message=f"开始上传图片: {len(image_data)} bytes 原始数据",
            )

    def _start_send_im_worker(self, request_id: str, args: Dict[str, Any]) -> None:
        """在 Worker 中发送真实 IM 消息（TLV 协议），避免阻塞 UI 线程。

        前端 payload: ``{"friend_id": str, "friend_im_id": str|int, "content": str}``
        - ``friend_id``：好友的 watchid / friendId，仅用于日志展示
        - ``friend_im_id``：好友的 imFriendId（IM 好友 ID），IM 协议 receiverId。
          friendslist/getfriend2 API 实际返回字段为 ``imFriendId``（不是 ``imAccountId``，
          后者是设备自身的 IM 账号 ID，原项目审计 9-C Top 4 修复点）。
        - ``content``：消息文本

        设备需已绑定且 ``device.imaccountid`` 不为空（绑定时从 ``imAccountInfo.imAccountId`` 保存，
        imaccountid 是设备自身的 IM 账号 ID，与好友的 imFriendId 是不同概念）。
        ``imfriendid`` 与 ``imaccountid`` 会被强转为 int（TLV 协议要求整数编码）。
        """
        friend_id = args.get("friend_id", "")
        friend_im_id = args.get("friend_im_id", "")
        content = args.get("content", "")

        # 同步参数校验（在启动 Worker 前快速失败，避免无谓线程开销）
        device = self.config.get_device()
        if not device or not device.is_bound:
            self.api_error.emit(request_id, "设备未绑定")
            return
        if not device.imaccountid:
            self.api_error.emit(request_id, "设备缺少 imAccountId，请重新绑定")
            return
        if not friend_im_id:
            self.api_error.emit(request_id, "好友缺少 imFriendId")
            return
        if not content:
            self.api_error.emit(request_id, "消息内容不能为空")
            return

        # TLV 协议要求 imfriendid / imaccountid 为整数
        try:
            imfriendid_int = int(friend_im_id)
        except (TypeError, ValueError):
            self.api_error.emit(request_id, f"好友 imFriendId 非法: {friend_im_id!r}")
            return
        try:
            imaccountid_int = int(device.imaccountid)
        except (TypeError, ValueError):
            self.api_error.emit(request_id, f"设备 imAccountId 非法: {device.imaccountid!r}")
            return

        # 闭包捕获所有参数，BaseWorker 只接受无参 callable
        def im_task():
            from core.im_client import send_im_message

            return send_im_message(
                bind_number=device.bindnumber,
                watchid=device.watchid,
                chipid=device.chipid,
                imfriendid=imfriendid_int,
                imaccountid=imaccountid_int,
                content=content,
            )

        im_task.__name__ = "send_im"

        worker = BaseWorker(im_task)
        worker.finished_ok.connect(
            lambda r, rid=request_id: self._on_send_im_ok(rid, r, friend_id)
        )
        worker.finished_err.connect(
            lambda e, rid=request_id: self._on_worker_err(rid, e, "send_im")
        )
        self._workers[request_id] = worker
        worker.finished.connect(worker.deleteLater)
        worker.finished.connect(lambda _=None, rid=request_id: self._workers.pop(rid, None))
        worker.start()

        if self.log_store:
            self.log_store.info(
                action="send_im",
                message=f"发送 IM 给 {friend_id}: {content[:40]}{'...' if len(content) > 40 else ''}",
                watchid=device.watchid,
            )

    def _on_send_im_ok(self, request_id: str, success: Any, friend_id: str) -> None:
        """send_im worker 成功回调：success 是 send_im_message 返回的 bool。"""
        # _workers 的清理统一由 worker.finished 信号回调处理
        if success:
            result = {"code": "000001", "desc": "发送成功", "friend_id": friend_id}
            self.api_result.emit(
                request_id, json.dumps(result, ensure_ascii=False, default=str)
            )
            if self.log_store:
                self.log_store.info(
                    action="send_im",
                    message=f"IM 消息已发送给 {friend_id}",
                )
            self.log_message.emit("INFO", f"✓ send_im → {friend_id}")
        else:
            err_msg = "IM 发送失败（连接/登录/发送失败）"
            self.api_error.emit(request_id, err_msg)
            if self.log_store:
                self.log_store.error(
                    action="send_im",
                    message=f"IM 发送失败: {friend_id}",
                )
            self.log_message.emit("ERROR", f"✗ send_im → {friend_id}: {err_msg}")

    def _start_momentpic_worker(self, request_id: str, args: Dict[str, Any]) -> None:
        """在 Worker 中发布图片动态（4 步流程：转 WebP + 取凭证 + 七牛上传 + 发布）。

        前端 payload: ``{"image_base64": str, "content": str}``
        - ``image_base64``：原始图片的 base64 编码（可带 ``data:image/png;base64,`` 前缀），
          Python 端 decode 后传给 ``watch_api.momentpic(image_data=...)``
        - ``content``：动态文字描述（iMoo 扩展字段，仅用于日志/UI 展示，
          不进入发布 payload；原项目 content.appName 固定 "来自ZxeBOT"）

        设备需已绑定。设备四元组（watchid/bind_number/chipid/model）由本方法从
        ``config.get_device()`` 注入到 ``watch_api.momentpic`` 调用，不走自动注入白名单。
        """
        import base64

        image_b64 = args.get("image_base64", "")
        content = args.get("content", "") or ""

        if not image_b64:
            self.api_error.emit(request_id, "image_base64 不能为空")
            return

        # base64 解码（允许前端传带 data:image/png;base64, 前缀的 data URL）
        b64_payload = image_b64
        if "," in b64_payload and b64_payload.startswith("data:"):
            b64_payload = b64_payload.split(",", 1)[1]
        try:
            image_data = base64.b64decode(b64_payload)
        except Exception as e:
            self.api_error.emit(request_id, f"base64 解码失败: {e}")
            return

        device = self.config.get_device()
        if not device or not device.is_bound:
            self.api_error.emit(request_id, "设备未绑定")
            return

        # 闭包捕获所有参数，BaseWorker 只接受无参 callable
        def pic_task():
            return self.api.momentpic(
                watchid=device.watchid,
                bind_number=device.bindnumber,
                chipid=device.chipid,
                model=device.model,
                image_data=image_data,
                content_text=content,
            )

        pic_task.__name__ = "momentpic"

        worker = BaseWorker(pic_task)
        worker.finished_ok.connect(
            lambda r, rid=request_id: self._on_worker_ok(rid, r, "momentpic")
        )
        worker.finished_err.connect(
            lambda e, rid=request_id: self._on_worker_err(rid, e, "momentpic")
        )
        self._workers[request_id] = worker
        worker.finished.connect(worker.deleteLater)
        worker.finished.connect(lambda _=None, rid=request_id: self._workers.pop(rid, None))
        worker.start()

        if self.log_store:
            self.log_store.info(
                action="momentpic",
                message=f"开始发布图片动态: {len(image_data)} bytes 原始数据, content={content[:40]}",
                watchid=device.watchid,
            )

    def _wrap_momentview(
        self,
        original_func: Callable,
        args: Dict[str, Any],
        request_id: str,
    ) -> Callable:
        """包装 momentview，优先查缓存、未命中时调用并写回缓存。"""
        watchid = args.get("watchid")
        page = args.get("page", 1)

        # 缓存命中：直接 emit api_result，返回 no-op 函数避免启动 worker
        if self.cache and watchid:
            try:
                cached = self.cache.get_moments(watchid, page)
                if cached is not None:
                    self.api_result.emit(
                        request_id,
                        json.dumps(cached, ensure_ascii=False, default=str),
                    )
                    if self.log_store:
                        self.log_store.info(
                            action="momentview",
                            message=f"缓存命中: watchid={watchid} page={page}",
                        )
                    def _noop(**kwargs):
                        return None
                    _noop.__name__ = "momentview_cached"
                    return _noop
            except Exception as e:
                logger.warning(f"momentview 缓存读取失败: {e}")

        def wrapped(**kwargs):
            raw = original_func(**kwargs)
            if isinstance(raw, dict):
                parsed = MomentParser.parse_list(raw)
                # 写入缓存
                if self.cache and watchid is not None:
                    try:
                        self.cache.set_moments(watchid, page, parsed)
                    except Exception as e:
                        logger.warning(f"momentview 缓存写入失败: {e}")
                return parsed
            return raw

        wrapped.__name__ = "momentview_wrapped"
        return wrapped

    def _wrap_friendslist(
        self,
        original_func: Callable,
        args: Dict[str, Any],
        request_id: str,
    ) -> Callable:
        """包装 friendslist，优先查缓存、未命中时调用并写回缓存。"""
        watchid = args.get("watchid")

        if self.cache and watchid:
            try:
                cached = self.cache.get_friends(watchid)
                if cached is not None:
                    self.api_result.emit(
                        request_id,
                        json.dumps(cached, ensure_ascii=False, default=str),
                    )
                    if self.log_store:
                        self.log_store.info(
                            action="friendslist",
                            message=f"缓存命中: watchid={watchid}",
                        )
                    def _noop(**kwargs):
                        return None
                    _noop.__name__ = "friendslist_cached"
                    return _noop
            except Exception as e:
                logger.warning(f"friendslist 缓存读取失败: {e}")

        def wrapped(**kwargs):
            raw = original_func(**kwargs)
            if self.cache and watchid is not None and isinstance(raw, dict):
                try:
                    self.cache.set_friends(watchid, raw)
                except Exception as e:
                    logger.warning(f"friendslist 缓存写入失败: {e}")
            return raw

        wrapped.__name__ = "friendslist_wrapped"
        return wrapped

    def _inject_device(self, method: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """对需要设备的方法自动注入四元组"""
        if method not in self._DEVICE_REQUIRED_METHODS:
            return args

        device = self.config.get_device()
        if not device or not device.is_bound:
            return args

        # WatchAPI 期望的参数名是 bind_number（带下划线），device 字段是 bindnumber
        mapping = {
            "watchid": device.watchid,
            "bind_number": device.bindnumber,
            "chipid": device.chipid,
            "model": device.model,
        }
        for key, val in mapping.items():
            if val and key not in args:
                args[key] = val
        return args

    def _dispatch_local(self, request_id: str, method: str, args: Dict[str, Any]) -> None:
        """分发本地方法"""
        handler = self._LOCAL_HANDLERS.get(method)

        if not handler:
            self.api_error.emit(request_id, f"未知本地方法: {method}")
            return

        try:
            result = handler(**args)
            self.api_result.emit(
                request_id, json.dumps(result, ensure_ascii=False, default=str)
            )
        except Exception as e:
            logger.exception(f"本地方法 {method} 失败")
            self.api_error.emit(request_id, str(e))

    # ===== Worker 回调 =====
    def _on_worker_ok(self, request_id: str, result: Any, method: str):
        # 注意：缓存命中的 _noop 会返回 None，这里跳过 None 结果的 emit
        # （缓存路径已在 _wrap_* 中直接 emit 过 api_result）
        if result is not None:
            self.api_result.emit(
                request_id, json.dumps(result, ensure_ascii=False, default=str)
            )
        # _workers 的清理统一由 worker.finished 信号回调处理
        if self.log_store:
            self.log_store.info(
                action=method,
                message=f"API 调用成功: {method}",
            )
        self.log_message.emit("INFO", f"✓ {method}")

    def _on_worker_err(self, request_id: str, err: str, method: str):
        self.api_error.emit(request_id, err)
        # _workers 的清理统一由 worker.finished 信号回调处理
        if self.log_store:
            self.log_store.error(
                action=method,
                message=f"API 调用失败: {err}",
            )
        self.log_message.emit("ERROR", f"✗ {method}: {err}")

    # ===== Slot: 启动长任务 =====
    @Slot(str, str, str)
    def start_task(self, task_id: str, name: str, payload: str):
        """启动长任务（批量点赞/群发等）"""
        # 方法白名单校验
        if name not in self._TASK_ALLOWED:
            self.task_done.emit(task_id, False, f"不允许的任务: {name}")
            return

        try:
            args = json.loads(payload) if payload else {}
        except json.JSONDecodeError:
            args = {}

        # 设备必要检查
        device = self.config.get_device()
        if not device or not device.is_bound:
            self.task_done.emit(task_id, False, "设备未绑定")
            return

        args = self._inject_device(name, args)

        api_func = getattr(self.api, name, None)
        if not api_func or not callable(api_func):
            self.task_done.emit(task_id, False, f"未知任务: {name}")
            return

        worker = BatchWorker(api_func, **args)
        worker.progress.connect(
            lambda c, t, m, tid=task_id: self.task_progress.emit(tid, c, t, m)
        )
        worker.finished_ok.connect(
            lambda r, tid=task_id: self.task_done.emit(
                tid,
                not (isinstance(r, dict) and r.get("cancelled", False)),
                json.dumps(r, ensure_ascii=False, default=str),
            )
        )
        worker.finished_err.connect(
            lambda e, tid=task_id: self.task_done.emit(tid, False, e)
        )
        self._workers[task_id] = worker
        worker.finished.connect(worker.deleteLater)
        worker.finished.connect(lambda _=None, tid=task_id: self._workers.pop(tid, None))
        worker.start()

        if self.log_store:
            self.log_store.info(action=name, message=f"启动任务: {name}")

    @Slot(str)
    def cancel_task(self, task_id: str):
        """取消长任务"""
        worker = self._workers.get(task_id)
        if worker and hasattr(worker, "cancel"):
            worker.cancel()
            logger.info(f"任务 {task_id} 已请求取消")
            self.log_message.emit("WARN", f"已请求取消任务 {task_id}")

    # ===== 本地方法实现 =====
    def _handle_ping(self) -> dict:
        return {"ts": time.time(), "ok": True}

    def _handle_get_version(self) -> dict:
        return {
            "python": sys.version.split()[0],
            "pyside": self._get_pyside_version(),
            "app": os.environ.get("IMOO_VERSION", "1.0.0-dev"),
            "platform": platform.system(),
            "machine": platform.machine(),
        }

    def _get_pyside_version(self) -> str:
        try:
            import PySide6
            return PySide6.__version__
        except Exception:
            return "unknown"

    def _handle_get_config(self) -> dict:
        cfg = self.config.load()
        return {
            "device": cfg.device.to_dict() if cfg.device else None,
            "theme": cfg.theme,
            "last_page": cfg.last_page,
            "cache_ttl_hours": cfg.cache_ttl_hours,
            "version": cfg.version,
        }

    def _handle_set_config(
        self,
        theme: Optional[str] = None,
        last_page: Optional[str] = None,
        cache_ttl_hours: Optional[int] = None,
    ) -> dict:
        cfg = self.config.load()
        if theme is not None:
            cfg.theme = theme
        if last_page is not None:
            cfg.last_page = last_page
        if cache_ttl_hours is not None:
            try:
                cfg.cache_ttl_hours = int(cache_ttl_hours)
            except (TypeError, ValueError):
                pass
        self.config.save(cfg)
        return {"ok": True}

    def _handle_bind_device(self, chipid: str, bindnumber: str) -> dict:
        """绑定设备：调用 get_info 验证并保存"""
        if not chipid or not bindnumber:
            return {"code": "ERR", "desc": "chipid 和 bindnumber 不能为空"}

        # 注意 get_info 参数名是 bind_number（带下划线）
        response = self.api.get_info(bindnumber, chipid)
        if not response:
            return {"code": "ERR", "desc": "网络请求失败"}

        if response.get("code") == "000001" and response.get("data"):
            data = response["data"]
            im_info = data.get("imAccountInfo") or {}
            device = DeviceConfig(
                chipid=chipid,
                bindnumber=bindnumber,
                watchid=str(data.get("id", "")),
                model=data.get("innerModel") or data.get("model") or "",
                imaccountid=str(im_info.get("imAccountId", "")),
                name=data.get("name", ""),
                bound_at=datetime.now().isoformat(timespec="seconds"),
            )
            self.config.set_device(device)

            # 通知前端设备已变化
            self.device_changed.emit(json.dumps(device.to_dict(), ensure_ascii=False))

            if self.log_store:
                self.log_store.info(
                    action="bind_device",
                    message=f"绑定成功: {device.name} ({device.model})",
                    watchid=device.watchid,
                )
            return response
        else:
            return response or {"code": "ERR", "desc": "设备验证失败"}

    def _handle_unbind_device(self) -> dict:
        self.config.clear_device()
        # 清理缓存
        if self.cache:
            self.cache.clear()
        self.device_changed.emit("")
        if self.log_store:
            self.log_store.warn(action="unbind_device", message="设备已解绑")
        return {"code": "000001", "desc": "已解绑"}

    def _handle_refresh_device(self) -> dict:
        """刷新设备信息：用现有 chipid/bindnumber 重跑 get_info，更新本地存储的
        watchid/model/imaccountid。

        使用场景：手表固件升级/换绑/IM 账号重建后，本地缓存的 watchid/model/
        imaccountid 可能与服务端不一致，导致后续 API 失败；调本方法强制拉取最新
        信息并覆盖本地存储。

        走 _LOCAL_METHODS（同步执行）；get_info 一般 <1s，若 UI 卡顿可后续改为
        Worker。设备未绑定时返回 {code: ERR}。
        """
        device = self.config.get_device()
        if not device or not device.is_bound:
            return {"code": "ERR", "desc": "设备未绑定"}

        # get_info 失败时返回 {code: ERR}（见 make_request）
        response = self.api.get_info(device.bindnumber, device.chipid)
        if not response or response.get("code") != "000001" or not response.get("data"):
            desc = response.get("desc", "刷新失败") if response else "网络请求失败"
            return {"code": "ERR", "desc": desc}

        data = response["data"]
        im_info = data.get("imAccountInfo") or {}
        updated = DeviceConfig(
            chipid=device.chipid,
            bindnumber=device.bindnumber,
            watchid=str(data.get("id", device.watchid)),
            model=data.get("innerModel") or data.get("model") or device.model,
            imaccountid=str(im_info.get("imAccountId", device.imaccountid)),
            name=data.get("name", device.name),
            bound_at=device.bound_at,  # 保留原绑定时间
        )
        self.config.set_device(updated)
        self.device_changed.emit(json.dumps(updated.to_dict(), ensure_ascii=False))
        if self.log_store:
            self.log_store.info(
                action="refresh_device",
                message=f"设备信息已刷新: {updated.name} ({updated.model})",
                watchid=updated.watchid,
            )
        return {"code": "000001", "desc": "刷新成功", "data": updated.to_dict()}

    def _handle_calc_adb(self, code: str) -> dict:
        code = str(code) if code is not None else ""
        if not code or not code.isdigit():
            return {"result": "", "error": "输入必须为纯数字"}
        if len(code) != 8:
            return {"result": "", "error": "ADB 校验码必须为 8 位数字（手表 ADB 界面显示的 8 位数字串）"}
        try:
            result = process_adb_new(code)
        except IndexError:
            return {"result": "", "error": "该数字串无法算码（末位校验异常），请确认输入的是手表当前显示的完整 8 位数字"}
        if not result:
            return {"result": "", "error": "算码失败，请确认输入的是手表当前显示的 8 位数字"}
        return {"result": result}

    def _handle_calc_zj(self, code: str) -> dict:
        code = str(code) if code is not None else ""
        if not code or not code.isdigit():
            return {"result": "", "error": "输入必须为纯数字"}
        if len(code) != 8:
            return {"result": "", "error": "自检校验码必须为 8 位数字（手表自检界面显示的 8 位数字串）"}
        try:
            result = process_self_check_new(code)
        except IndexError:
            return {"result": "", "error": "该数字串无法算码（末位校验异常），请确认输入的是手表当前显示的完整 8 位数字"}
        if not result:
            return {"result": "", "error": "算码失败，请确认输入的是手表当前显示的 8 位数字"}
        return {"result": result}

    def _handle_get_logs(
        self,
        limit: int = 100,
        level: Optional[str] = None,
        date: Optional[str] = None,
    ) -> dict:
        if not self.log_store:
            return {"logs": []}
        try:
            limit_int = int(limit) if limit is not None else 100
        except (TypeError, ValueError):
            limit_int = 100
        if date:
            logs = self.log_store.list_by_date(date, level=level, limit=limit_int)
        else:
            logs = self.log_store.list_recent(limit=limit_int, level=level)
        return {"logs": logs}

    def _handle_get_log_dates(self) -> dict:
        if not self.log_store:
            return {"dates": []}
        return {"dates": self.log_store.list_dates()}

    def _handle_clear_logs(self) -> dict:
        if self.log_store:
            self.log_store.clear()
        return {"ok": True}

    def _handle_cache_clear(self) -> dict:
        if self.cache:
            removed = self.cache.cleanup_expired()
            self.cache.clear()
            return {"ok": True, "removed": removed}
        return {"ok": False, "error": "cache unavailable"}

    def _handle_get_eula(self) -> dict:
        """返回 EULA 全文 + 当前版本号，供前端展示"""
        import sys as _sys
        from pathlib import Path as _Path
        # 定位 EULA.txt（与 main.py 的 _find_eula_path 同逻辑）
        candidates = []
        if "__compiled__" in dir() or getattr(_sys, "frozen", False):
            candidates.append(_Path(_sys.argv[0]).parent / "EULA.txt")
            if getattr(_sys, "_MEIPASS", None):
                candidates.append(_Path(_sys._MEIPASS) / "EULA.txt")
        # ROOT 在 main.py 顶层定义；bridge 也可用 __file__ 推算项目根
        candidates.append(_Path(__file__).parent.parent / "EULA.txt")
        eula_text = ""
        for p in candidates:
            if p.exists():
                try:
                    eula_text = p.read_text(encoding="utf-8")
                    break
                except Exception:
                    continue
        return {
            "text": eula_text,
            "version": self.config.CURRENT_EULA_VERSION,
            "found": bool(eula_text),
        }

    def _handle_get_eula_status(self) -> dict:
        """返回当前 EULA 同意状态"""
        return {
            "accepted": self.config.is_eula_accepted(),
            "version": self.config.CURRENT_EULA_VERSION,
            "stored_version": self.config.load().eula_version,
        }

    # ===== 工具方法 =====
    def cleanup_workers(self):
        """关闭所有运行中的 worker（窗口关闭时调用）。

        quit() 对未进入事件循环的 QThread 无效，故改用：
        cancel → wait(5000) → terminate → clear。
        """
        for wid, worker in list(self._workers.items()):
            try:
                if hasattr(worker, "cancel"):
                    worker.cancel()
                if worker.isRunning():
                    worker.wait(5000)
                    if worker.isRunning():
                        worker.terminate()
                        worker.wait(1000)
            except Exception:
                pass
        self._workers.clear()


__all__ = ["AppBridge"]
