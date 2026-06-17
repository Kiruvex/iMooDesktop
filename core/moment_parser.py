"""
MomentParser - 好友圈动态数据解析器

抽取自原项目 src/plugins/moment_web.py 的 parse_moment_data，
去除 NoneBot/FastAPI/MySQL 依赖，纯函数式实现，便于在 Worker 中调用。
"""

import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class MomentParser:
    """好友圈动态解析器"""

    @staticmethod
    def parse(moment_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        解析单条动态原始数据为前端友好结构。

        输入示例（节选）::
            {
              "id": "...",
              "watchName": "小天才",
              "content": "{\"content\":\"今天很开心\",\"source\":{...}}",
              "comments": [{"watchName":"小明","comment":"赞","createTime":"..."}],
              "likeTotal": 12,
              "createTime": 1700000000000
            }

        输出结构::
            {
              "id": str,
              "nickname": str,
              "content": str,
              "images": List[str],
              "videos": List[str],
              "time": int|str,
              "like_count": int,
              "comment_count": int,
              "comments": List[{watchName, comment, createTime}],
              "type": Optional[str],
              "moment_id": Optional[str]
            }
        """
        if not isinstance(moment_data, dict):
            return None

        try:
            # === 昵称 ===
            watch_name = moment_data.get("watchName")
            if not watch_name and moment_data.get("comments"):
                for comment in moment_data["comments"]:
                    if isinstance(comment, dict) and comment.get("watchName"):
                        watch_name = comment["watchName"]
                        break
            if not watch_name:
                watch_name = "未知用户"

            # === 正文 + 媒体 ===
            content_raw = moment_data.get("content", "") or ""
            moment_content = ""
            image_urls: List[str] = []
            video_urls: List[str] = []

            stripped = content_raw.strip()
            if stripped.startswith("{") and stripped.endswith("}"):
                content_data = MomentParser._safe_json(stripped)
                if content_data is None:
                    moment_content = content_raw
                else:
                    moment_content = content_data.get("content", "") or ""
                    source = content_data.get("source")
                    if isinstance(source, dict):
                        # 视频：source.downloadUrl 是视频直链
                        video_urls.extend(
                            MomentParser._collect_urls(
                                source,
                                ["downloadUrl", "videoUrl", "video"],
                                ["videos", "videoList"],
                            )
                        )
                        # 图片：优先从 source 的图片字段
                        image_urls.extend(
                            MomentParser._collect_urls(
                                source,
                                ["picUrl", "imageUrl", "thumbUrl", "coverUrl"],
                                ["images", "pics", "imageList", "picList"],
                            )
                        )
                    # 顶层 content_data 上的图片/视频字段
                    image_urls.extend(
                        MomentParser._collect_urls(
                            content_data,
                            ["picUrl", "imageUrl"],
                            ["images", "pics"],
                        )
                    )
                    video_urls.extend(
                        MomentParser._collect_urls(
                            content_data,
                            ["downloadUrl", "videoUrl"],
                            ["videos"],
                        )
                    )
            else:
                moment_content = content_raw

            # resource 字段：JSON 字符串或 dict，里面可能携带图片/视频清单
            resource = moment_data.get("resource")
            if resource:
                if isinstance(resource, str):
                    resource_data = MomentParser._safe_json(resource)
                elif isinstance(resource, dict):
                    resource_data = resource
                else:
                    resource_data = None
                if isinstance(resource_data, dict):
                    image_urls.extend(
                        MomentParser._collect_urls(
                            resource_data,
                            ["picUrl", "imageUrl", "coverUrl"],
                            ["images", "pics", "imageList"],
                        )
                    )
                    video_urls.extend(
                        MomentParser._collect_urls(
                            resource_data,
                            ["downloadUrl", "videoUrl"],
                            ["videos", "videoList"],
                        )
                    )

            # 去重保序
            seen = set()
            image_urls = [u for u in image_urls if not (u in seen or seen.add(u))]
            seen = set()
            video_urls = [u for u in video_urls if not (u in seen or seen.add(u))]

            if not moment_content:
                moment_content = "无内容"

            # === 评论（逐条容错，坏评论跳过而非整条丢弃）===
            comments: List[Dict[str, Any]] = []
            for comment in moment_data.get("comments") or []:
                try:
                    if not isinstance(comment, dict):
                        continue
                    comments.append(
                        {
                            "watchName": comment.get("watchName", "未知用户"),
                            "comment": comment.get("comment", ""),
                            "createTime": comment.get("createTime", ""),
                        }
                    )
                except Exception:
                    logger.debug(f"跳过坏评论项: {comment!r}")
                    continue

            # === 元数据 ===
            try:
                like_count = moment_data.get("likeTotal", moment_data.get("likeCount", 0)) or 0
                like_count = int(like_count)
            except (TypeError, ValueError):
                like_count = 0
            # 评论数优先用服务端字段
            try:
                comment_count = (
                    moment_data.get("commentTotal")
                    or moment_data.get("commentCount")
                    or len(comments)
                )
                comment_count = int(comment_count)
            except (TypeError, ValueError):
                comment_count = len(comments)
            # time: 保留服务端原始类型，但兜底为字符串
            publish_time = moment_data.get("createTime", moment_data.get("gmtCreate", ""))
            if publish_time is None:
                publish_time = ""

            result: Dict[str, Any] = {
                "id": moment_data.get("id", moment_data.get("momentId", "")),
                "nickname": watch_name,
                "content": moment_content,
                "images": image_urls,
                "videos": video_urls,
                "time": publish_time,
                "like_count": like_count,
                "comment_count": comment_count,
                "comments": comments,
            }

            if moment_data.get("momentId"):
                result["moment_id"] = moment_data["momentId"]
            if moment_data.get("type"):
                result["type"] = moment_data["type"]

            return result
        except Exception as e:
            logger.exception(f"解析动态数据错误: {e}")
            return None

    @staticmethod
    def parse_list(raw_response: Any) -> Dict[str, Any]:
        """
        解析 momentview 接口返回的完整响应。

        返回结构::
            {
              "code": "000001",
              "has_more": bool,
              "page": int,
              "moments": List[parsed_moment],
              "raw": original  # 保留原始数据用于调试
            }
        """
        if not isinstance(raw_response, dict):
            return {"code": "ERR", "has_more": False, "page": 1, "moments": [], "raw": raw_response}

        try:
            code = raw_response.get("code", "ERR")
            if code != "000001":
                return {
                    "code": code,
                    "has_more": False,
                    "page": 1,
                    "moments": [],
                    "desc": raw_response.get("desc", ""),
                    "raw": raw_response,
                }

            data = raw_response.get("data") or {}
            if not isinstance(data, dict):
                data = {}
            # 不同版本字段名兼容
            # 注意：xtc 真实 API（momentview/delmoment 列表）返回的字段是 ``data.watchMoments``
            # （原项目 delmoment.py:154 + moment_web.py:326 双重佐证），必须作为首选候选。
            # momentList / moments / list 是历史/mock 兼容字段，仅作为兜底。
            moment_list = (
                data.get("watchMoments")
                or data.get("momentList")
                or data.get("moments")
                or data.get("list")
                or []
            )
            if not isinstance(moment_list, list):
                moment_list = []

            parsed = []
            for m in moment_list:
                item = MomentParser.parse(m)
                if item:
                    parsed.append(item)

            # 是否还有更多：依据 hasNext / total / size
            try:
                total = int(data.get("total", 0) or 0)
            except (TypeError, ValueError):
                total = 0
            try:
                size = int(data.get("size", 0) or 0)
            except (TypeError, ValueError):
                size = 0
            try:
                page = int(data.get("page", 1) or 1)
            except (TypeError, ValueError):
                page = 1
            has_more = bool(
                data.get("hasNext")
                or data.get("hasMore")
                or (total > (size + len(parsed)))
            )

            return {
                "code": "000001",
                "has_more": has_more,
                "page": page,
                "moments": parsed,
                "raw": raw_response,
            }
        except Exception as e:
            logger.exception(f"parse_list 错误: {e}")
            return {
                "code": "ERR",
                "desc": str(e),
                "moments": [],
                "has_more": False,
                "page": 1,
                "raw": raw_response,
            }

    @staticmethod
    def _safe_json(s: str) -> Optional[dict]:
        try:
            return json.loads(s)
        except (json.JSONDecodeError, TypeError):
            return None

    @staticmethod
    def _collect_urls(
        container: Any,
        candidate_scalar: List[str],
        candidate_list: List[str],
    ) -> List[str]:
        """从 container 中抽取 URL 列表。

        - candidate_scalar: 可能是单个 URL 字符串的字段名（取第一个非空）
        - candidate_list:   可能是 URL 列表的字段名（逐个展开）
        """
        urls: List[str] = []
        if not isinstance(container, dict):
            return urls
        for key in candidate_scalar:
            val = container.get(key)
            if isinstance(val, str) and val.strip():
                urls.append(val.strip())
                break
        for key in candidate_list:
            val = container.get(key)
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, str) and item.strip():
                        urls.append(item.strip())
                    elif isinstance(item, dict):
                        # 列表项可能是 {url: ...} / {picUrl: ...} / {downloadUrl: ...}
                        for sub_key in ("url", "picUrl", "imageUrl", "downloadUrl", "src"):
                            sub_val = item.get(sub_key)
                            if isinstance(sub_val, str) and sub_val.strip():
                                urls.append(sub_val.strip())
                                break
        return urls
