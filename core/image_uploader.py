"""
ImageUploader - 图片上传工具

将本地图片转为 WebP 后上传到七牛云公开 bucket，返回可访问的 URL。

设计要点：
- Pillow 处理图片：EXIF 旋转自动校正 → 保持比例缩放到 max_size 内 → 转 WebP（quality=80）
- 透明 PNG 保留 alpha 通道（用 RGBA 模式保存 WebP）
- 七牛上传走 multipart/form-data，字段名 ``file``，无需 token（公开 bucket）
- CDN 域名可配置：优先用响应里的 ``url`` 字段；否则用 ``{cdn_domain}/{key}`` 拼接

依赖：Pillow >= 10.0，requests >= 2.28
"""

import io
import logging
from typing import Optional, Tuple

import requests
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


class ImageUploadError(Exception):
    """图片上传过程中的错误（Pillow 解码失败、七牛响应异常等）"""


class ImageUploader:
    """图片 → WebP → 七牛 的完整上传流程

    :param upload_url: 七牛上传接口，默认 http://upload.qiniup.com
    :param cdn_domain: 七牛 CDN 域名（不含尾斜杠），用于拼接图片可访问 URL。
        若七牛响应已包含 ``url`` 字段，则优先使用响应 URL。
    :param timeout: 上传请求超时（秒）
    """

    def __init__(
        self,
        upload_url: str = "http://upload.qiniup.com",
        cdn_domain: str = "https://qpic.cn",
        timeout: float = 30.0,
    ):
        self.upload_url = upload_url
        self.cdn_domain = cdn_domain.rstrip("/")
        self.timeout = timeout

    # ------------------------------------------------------------------
    # 步骤 1：图片 → WebP bytes
    # ------------------------------------------------------------------
    def convert_to_webp(
        self,
        image_data: bytes,
        quality: int = 80,
        max_size: Optional[Tuple[int, int]] = (1280, 1280),
        pad_to: Optional[Tuple[int, int]] = None,
    ) -> bytes:
        """将原始图片字节流转为 WebP 字节流。

        - 自动应用 EXIF 旋转（``ImageOps.exif_transpose``）
        - ``pad_to=None``（默认）：保持比例缩放到 ``max_size`` 框内（``Image.thumbnail`` in-place）
        - ``pad_to=(W, H)``：先缩放到 ``pad_to`` 框内（保比例），再白色 padding 补齐到精确
          ``W x H``。用于 xtc 好友圈图片动态（原项目用 FFmpeg
          ``scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white``
          实现，本方法用 Pillow 等价实现，避免 FFmpeg 依赖）
        - 透明 PNG 在非 pad 模式保留 alpha 通道（RGBA）；pad 模式统一白底 RGB
        - quality 80 是 WebP 在体积/质量间的常用平衡点

        :raises ImageUploadError: Pillow 无法识别/解码图片
        """
        if not image_data:
            raise ImageUploadError("图片数据为空")

        try:
            img = Image.open(io.BytesIO(image_data))
            img.load()  # 提前触发解码异常，避免 lazy decode 拖到 save 才崩
        except Exception as e:
            raise ImageUploadError(f"Pillow 打开图片失败: {e}") from e

        # 1) EXIF 旋转校正
        try:
            img = ImageOps.exif_transpose(img)
        except Exception as e:
            # exif_transpose 失败不应阻断流程，记录后继续
            logger.debug(f"exif_transpose 跳过: {e}")

        # 取 LANCZOS 重采样器（Pillow >= 10 用 Resampling.LANCZOS）
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:  # pragma: no cover - 兼容旧版 Pillow
            resample = Image.LANCZOS

        # 2) 模式归一化
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            has_alpha = True
        else:
            has_alpha = False

        # ------------------------------------------------------------------
        # 3a) pad_to 模式：640x480 padded（xtc 图片动态专用）
        # ------------------------------------------------------------------
        if pad_to:
            target_w, target_h = pad_to
            # 缩放到 pad_to 内（保比例；thumbnail 是 in-place，不会放大）
            img.thumbnail(pad_to, resample)
            # 统一转 RGB（白底）；RGBA 居中 paste 时用 mask 保留半透明边缘
            if has_alpha:
                img = img.convert("RGBA")
                bg = Image.new("RGB", pad_to, (255, 255, 255))
                offset = ((target_w - img.width) // 2, (target_h - img.height) // 2)
                bg.paste(img, offset, img)  # 第 3 个参数是 alpha mask
                img = bg
            else:
                img = img.convert("RGB")
                bg = Image.new("RGB", pad_to, (255, 255, 255))
                offset = ((target_w - img.width) // 2, (target_h - img.height) // 2)
                bg.paste(img, offset)
                img = bg
        # ------------------------------------------------------------------
        # 3b) 普通 max_size 模式：保持比例缩放，保留透明
        # ------------------------------------------------------------------
        elif max_size and (img.size[0] > max_size[0] or img.size[1] > max_size[1]):
            img.thumbnail(max_size, resample)
            if has_alpha:
                target_mode = "RGBA"
            else:
                target_mode = "RGB"
            if img.mode != target_mode:
                img = img.convert(target_mode)
        else:
            # 不需要缩放，仅归一化模式
            target_mode = "RGBA" if has_alpha else "RGB"
            if img.mode != target_mode:
                img = img.convert(target_mode)

        # 4) 保存为 WebP
        buf = io.BytesIO()
        try:
            img.save(buf, format="WEBP", quality=quality, method=4)
        except Exception as e:
            raise ImageUploadError(f"WebP 编码失败: {e}") from e

        return buf.getvalue()

    # ------------------------------------------------------------------
    # 步骤 2：上传到七牛
    # ------------------------------------------------------------------
    def upload_to_qiniu(
        self,
        file_data: bytes,
        filename: str = "image.webp",
    ) -> dict:
        """上传 WebP 字节流到七牛公开 bucket。

        :return: ``{"key": str, "url": str, "raw": dict}``，raw 为七牛原始响应
        :raises ImageUploadError: 网络异常 / 非 200 / 响应缺少 key
        """
        if not file_data:
            raise ImageUploadError("待上传文件为空")

        files = {"file": (filename, file_data, "image/webp")}
        try:
            resp = requests.post(
                self.upload_url,
                files=files,
                timeout=self.timeout,
            )
        except requests.RequestException as e:
            raise ImageUploadError(f"七牛上传网络异常: {e}") from e

        if resp.status_code != 200:
            raise ImageUploadError(
                f"七牛上传 HTTP {resp.status_code}: {resp.text[:200]}"
            )

        try:
            data = resp.json()
        except ValueError as e:
            raise ImageUploadError(f"七牛响应非 JSON: {resp.text[:200]}") from e

        key = data.get("key")
        if not key:
            raise ImageUploadError(f"七牛响应缺少 key 字段: {data}")

        # URL 优先级：响应自带 url > 响应自带 full_url > 自建 CDN 拼接
        url = data.get("url") or data.get("full_url") or f"{self.cdn_domain}/{key}"

        return {"key": key, "url": url, "raw": data}

    # ------------------------------------------------------------------
    # 完整流程：转 WebP + 上传
    # ------------------------------------------------------------------
    def upload_image(
        self,
        image_data: bytes,
        quality: int = 80,
        max_size: Optional[Tuple[int, int]] = (1280, 1280),
    ) -> dict:
        """完整上传流程：图片 → WebP → 七牛 → URL

        :return: ``{"key": str, "url": str, "size": int, "raw": dict}``
            - key: 七牛返回的资源 key
            - url: 图片可访问 URL
            - size: 上传的 WebP 字节数（用于日志/限流判断）
            - raw: 七牛原始响应
        :raises ImageUploadError: 任一步骤失败
        """
        webp_data = self.convert_to_webp(image_data, quality=quality, max_size=max_size)
        result = self.upload_to_qiniu(webp_data, filename="moment_pic.webp")
        result["size"] = len(webp_data)
        logger.info(
            f"图片上传成功: key={result['key']} size={result['size']} url={result['url']}"
        )
        return result


__all__ = ["ImageUploader", "ImageUploadError"]
