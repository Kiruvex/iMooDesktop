"""
WatchAPI - 手表 API 客户端

重构自原项目 modules/Apirequests.py，将模块级函数改为类方法，
配置通过构造函数注入，便于测试与多实例。
"""

import requests
import yaml
import json
import uuid
from datetime import datetime
import random
import time
import logging

logger = logging.getLogger(__name__)


# 图片动态发布所需的 appIcon（BMP base64，与 im_client.send_im_message 内的 icon_data 同串，
# 原项目 momentpic.py 也是硬编码同一串；保留为模块级常量避免重复）。
_MOMENT_PIC_APP_ICON_BMP = (
    "Qk3KDAAAAAAAAIoAAAB8AAAAHAAAABwAAAABACAAAwAAAEAMAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAD/AAAAAAAA/wEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAA//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////7+/v/////////////////8+fr//Pn6//////////////////////////////////////////////////////////////////////////////////////////////////////////////////no7v/zyNX/997l//v3+f/vxs3/3n+O/+GTn//79vf////////////////////////////////////////////////////////////////////////////////////////////////////////////0z9X/66Gu//LK1v/ttMP/3X6O/9+Om//bcoL/+e/u//rv5//79O7//Pfz//rs4//8+PT//PXr//rv4f/58uj/+vPt//v29P/67uz/+/T2//jk6P/31+H/+Nvm//38/f//////////////////////+Onr/+eUnf/r0NH/9NHb//C7yf/gjJr/5qmz//rz7v/23c7/9tPB//bSw//449X/99y+//fct//238X/9s2x//bRwf/68vD/87m4//G6wf/vm6//8J+4/+6jwP/45u7////////////////////////////TpqH/q2NV//He3v/1097/6aO0//js7//78er/9tfF//bczv/0wbz/+e3k//bYsP/32bf/++/o//XGs//0vLP/+vPy//TK0P/wqLb/86/E/++Ss//tirT/99Tj///////////////////////w6ub/o21Z/8WHgP/LgHz/48/L//TN2f/43+f//Pf0//jh1f/57OP/+Ofe//ffxv/57Nr/+Ona//v18f/219T/9M3K//PP0v/xsr7/8Juz//O90f/xsMr/8rTP//z1+P//////////////////////yquf/6FoVP++l4r/nVZC/9OEhP/usr3/88PR//78/P////7///////////////7////////////////////////////57O//9tXc//ni6//1z9///v7+//7+/v///////////////////////////8yxpv+WVT7/q3hn/+PUz//23eD/8LvF//XY4P/+/f7////////////////////////////////////////////////////////////////////////////////////////////////////////////6+Pf/7eXi//n29f////////////7////+/v///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////w=="
)

# xtc 好友圈删除/图片动态三段 API 的固定 uuid（原项目硬编码，复用之）
_MOMENT_DELETE_URL = "https://moment.watch.okii.com/moment/delete?uuid=36d3b1c99cae4e2bb42599b3f9327f12"
_MOMENT_PIC_TRANSFER_URL = "https://moment.watch.okii.com/moment/file/pic/transfer?uuid=8006960b657b410dbb8cc4b85c6ac080"
_MOMENT_PUBLIC_URL = "https://moment.watch.okii.com/moment/public?uuid=b16d92fdd3a44ad4a1a8c243d1f02e66"
_QINIU_QUERY_URL = "https://uc.qbox.me/v2/query?ak=IAM-uzPzpo9uYvtmU9hilIip3yCj2Bj6CWYqeovnpgsq&bucket=smartwatch-moment"
_QINIU_UPLOAD_URL = "http://upload.qiniup.com"


class WatchAPI:
    """手表 API 客户端（线程安全：每个 worker 线程持有一个实例）"""

    def __init__(self, config_path: str = "config.yaml"):
        with open(config_path, "r", encoding="utf-8") as f:
            self.config = yaml.load(f, Loader=yaml.FullLoader)
        self.api_config = self.config.get("api_config", {})

    def make_request(self, url, headers, data=None, method='post'):
        """统一 HTTP 请求封装。

        失败时返回 ``{"code": "ERR", "desc": ...}`` 而非 None，
        以便前端 ``_on_worker_ok`` 能区分缓存命中 (``_noop`` 返回 None) 与 API 失败
        (返回 ``{code: ERR}`` 可被 JSON.parse 并走错误展示路径)。
        所有调用者应使用 ``response.get('code') == '000001'`` 判断成功，
        不能再依赖 ``if not response`` 的 truthy 检查。
        """
        try:
            if isinstance(data, dict):
                response = requests.post(url, headers=headers, json=data, timeout=30)
            elif data is not None:
                response = requests.post(url, headers=headers, data=data, timeout=30)
            else:
                response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"请求失败: {e}")
            return {"code": "ERR", "desc": f"网络请求失败: {e}"}

    def timestamp_to_date(self, timestamp):
        if timestamp:
            # 时间戳是毫秒级，需要除以 1000 转换为秒级
            return datetime.fromtimestamp(timestamp / 1000).strftime('%Y-%m-%d')
        return None


    # 获取设备信息
    def get_info(self, bind_number, chipid):
        data = {
            "bindNumber": bind_number,
            "effect": 0,
            "sign": "null",
            "softVersion": "1.0.0"
        }
        headers = {
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025 - 01 - 17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "CN_BJ",
            "Version": "W_9.9.9",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset\u003dUTF-8",
            "Content-Length": "105",
            "Host": "watch.okii.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
            "User-Agent": "okhttp/3.12.0"
        }
        response = self.make_request(self.config['api_config']['CHANGE_URL'], headers, data)
        return response

    # 获取好友列表
    def friendslist(self, watchid, bind_number, chipid, model):
        data = {"watchId": watchid}
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "54",
            "Host": "watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        response =  self.make_request(self.config['api_config']['WATCH_FRIEND_INFO_URL'], headers, data)
        return response

    # 改名
    def name(self, watchid, bind_number, chipid, model, new_name):
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        data = {
            "id": watchid,
            "name": new_name
        }

        response = requests.post(self.config['api_config']['UPDATE_NAME_URL'], headers=headers, json=data, timeout=30)
        return response.json()

    def sign(self, watchid, bind_number, chipid, model, new_signature):
        headers = {
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "10310",
            "packageName": "com.xtc.personalcenter",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
            "dataCenterCode": "CN_BJ",
            "Version": "W_5.0.2",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset=UTF-8",
            "Host": "api.watch.okii.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
            "User-Agent": "okhttp/3.12.0"
        }
        data = {
            "content": new_signature,
            "watchId": watchid
        }

        response = self.make_request(self.config['api_config']['PERSONSIGN_URL'], headers, data)
        return response
    def realname(self, watchid, bind_number, chipid, model, new_realname):
        headers = {
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "10310",
            "packageName": "com.xtc.personalcenter",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
            "dataCenterCode": "CN_BJ",
            "Version": "W_5.0.2",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset=UTF-8",
            "Host": "watch.okii.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
            "User-Agent": "okhttp/3.12.0"
        }
        data = {
            "id": watchid,
            "realName": new_realname
        }

        response = self.make_request(self.config['api_config']['UPDATE_REALNAME_URL'], headers, data)
        return response

    def appsearch(self, watchid, bind_number, chipid, model, app_name):
        # get_info 失败时返回 {code: ERR}（见 make_request），需先校验再取 firmware
        info_resp = self.get_info(bind_number, chipid)
        if not info_resp or info_resp.get('code') != '000001' or not info_resp.get('data'):
            return info_resp or {"code": "ERR", "desc": "获取设备信息失败"}
        soft_version = info_resp['data'].get('firmware')
        if soft_version is None:
            return {"code": "ERR", "desc": "设备信息缺少 firmware 字段"}
        headers2 = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "api.watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        data2 = {
            "watchId": watchid,
            "model": model, 
            "firmware": soft_version,
            "searchName": app_name,
            "page": {
                "pageNum": 1,
                "pageSize": 20
            }
        }

        response = requests.post(self.config['api_config']['APP_SEARCH_URL'], headers=headers2, json=data2, timeout=30)
        return response.json()

    # 文字动态
    def moment(self, watchid, bind_number, chipid, model, momentid, bgid):
        content = f'{{"appIcon":"","appName":"{momentid}","packageName":"com.xtc.sport","transaction":"1737510576982f9fd79de-a9ae-44b2-8ce8-6061bece5f5c"}}'
        data = {
            "content": content,
            "emotionId": 0,
            "packageName": "com.xtc.sport",
            "resourceId": 0,
            "type": 7,
            "emotionId": bgid,
            "watchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025 - 01 - 17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "moment.watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }

        response = requests.post(self.config['api_config']['SPORT_LINK_URL'], headers=headers, json=data, timeout=30)
        return response.json()

    # 地名动态
    def momentblue(self, watchid, bind_number, chipid, model, momentid):
        data = {
            "content": momentid,
            "resourceId": 0,
            "type": 2,
            "watchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025 - 01 - 17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "moment.watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        response = requests.post(self.config['api_config']['SPORT_LINK_URL'], headers=headers, json=data, timeout=30)
        return response.json()

    # 删除单条好友圈动态
    # 对齐原项目 src/plugins/delmoment.py：POST /moment/delete
    # headers 与 momentblue 不同：packageVersion=53200, Eebbk-Sign=6E10..., Version=W_2.6.5,
    # Base-Request-Param 的 mac 用 "unkown"（原项目拼写），program="watch"
    def delmoment(self, watchid, bind_number, chipid, model, momentid):
        """删除单条好友圈动态

        :param momentid: 动态 ID（来自 momentview 返回的 momentId）
        :return: 服务端 JSON 响应（``{"code":"000001","desc":"..."}``）

        说明：
        - 调用方应先调 ``momentview`` 拿动态列表，再逐条调本方法删除（原项目 delmoment.py 流程）
        - 本方法只删单条；批量删除由调用方循环实现，原项目每条间隔 1-3s 随机抖动
        - URL/headers 严格对齐原项目 delmoment.py:170-205，避免服务端拒绝
        """
        url = _MOMENT_DELETE_URL
        headers = {
            'User-Agent': "okhttp/3.12.0",
            'Connection': "Keep-Alive",
            'Accept-Encoding': "gzip",
            'Content-Type': "application/json; charset=UTF-8",
            'model': model,
            'imSdkVersion': "102",
            'packageVersion': "53200",
            'Eebbk-Sign': "6E102731E6ECE21377EBBDE86EFCBC1D",
            "packageName": "com.xtc.moment",
            'Base-Request-Param': json.dumps({
                "accountId": watchid,
                "appId": "2",
                "mac": "unkown",
                "deviceId": bind_number,
                "token": chipid,
                "timestamp": "",
                "imFlag": "1",
                "registId": 0,
                "program": "watch"
            }),
            'dataCenterCode': "CN_BJ",
            'Version': "W_2.6.5",
            'Grey': "0",
            "Host": "moment.watch.okii.com",
            'Accept-Language': "zh-CN",
            'Watch-Time-Zone': "GMT+08:00"
        }
        data = {"momentId": momentid, "watchId": watchid}
        response = requests.post(url, headers=headers, json=data, timeout=30)
        return response.json()

    # 赞所有好友
    def likeall(self, watchid, bind_number, chipid, model):
        data = f'{{"watchId":"{watchid}"}}'
        headers1 = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
    "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "54",
            "Host": "watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        x = requests.post(self.config['api_config']['WATCH_FRIEND_INFO_URL'], headers=headers1, data=data, timeout=30)
        try:
            friends_data = x.json().get('data', [])
            total_friends = len(friends_data)
            for friend in friends_data:
                friend_id = friend.get("friendId")
                friend_name = friend.get("name", "未知名字")
                single_result = {
                    "friend_id": friend_id or "",
                    "friend_name": friend_name,
                    "success": False,
                    "response": "",
                    "reason": "",
                    "total_friends": total_friends
                }
                if not friend_id:
                    single_result["reason"] = "缺少friendId"
                    yield single_result
                    continue

                success_count = 0
                fail_count = 0
                total_count = 20

                for i in range(total_count):
                    data = f'{{"count":1,"level":21,"likeWatchId":"{friend_id}","watchId":"{watchid}"}}'
                    headers2 = {
                        "model": model,
                        "imSdkVersion": "102",
                        "packageVersion": "11910",
                        "packageName": "com.xtc.personalcenter",
                        "Eebbk-Sign": "0",
                        "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
                        "dataCenterCode": "CN_BJ",
                        "Version": "W_9.9.9",
                        "Grey": "0",
                        "Accept-Language": "zh-CN",
                        "Watch-Time-Zone": "GMT+08:00",
                        "Content-Type": "application/json; charset=UTF-8",
                        "Content-Length": "131",
                        "Host": "api.watch.okii.com",
                        "Connection": "Keep-Alive",
                        "Accept-Encoding": "gzip",
                        "User-Agent": "okhttp/3.12.0"
                    }
                    y = requests.post(self.config['api_config']['LIKE_URL'], headers=headers2, data=data, timeout=30)

                    # 优先用 JSON 判断成功，避免脆弱的字符串切片
                    # 原项目用 '000001' in y.text[9:15]，位置 9-15 是 JSON 开头 code 字段位置
                    # 但 HTTP 响应长度/编码变化时切片会误判
                    try:
                        resp_json = y.json()
                        if resp_json.get('code') == '000001':
                            success_count += 1
                        else:
                            fail_count += 1
                    except (ValueError, AttributeError):
                        # JSON 解析失败，回退到字符串判断（保留原行为）
                        if '000001' in y.text[9:15]:
                            success_count += 1
                        else:
                            fail_count += 1

                    time.sleep(random.uniform(0.6, 0.9))

                single_result["response"] = f"成功点赞 {success_count}/{total_count} 次"
                if success_count == total_count:
                    single_result["success"] = True
                else:
                    single_result["reason"] = f"部分点赞失败 ({success_count}/{total_count})"

                yield single_result
        except (KeyError, ValueError) as e:
            error_result = {
                "friend_id": "",
                "friend_name": "未知名字",
                "success": False,
                "response": "",
                "reason": f"处理响应数据时出现错误：{str(e)}",
                "total_friends": 0
            }
            yield error_result
        except Exception as e:
            error_result = {
                "friend_id": "",
                "friend_name": "未知名字",
                "success": False,
                "response": "",
                "reason": f"点赞过程中出现未知错误：{str(e)}",
                "total_friends": 0
            }
            yield error_result

    # 步数
    def step(self, watchid, bind_number, chipid, model, stepid):
        # 获取当前时间
        current_time = datetime.now()
        # 将当前时间转换为时间戳（毫秒）
        current_timestamp_ms = int(current_time.timestamp() * 1000)
        data = {
            "addEnergyFlag": 1,
            "recordTime": current_timestamp_ms,
            "sportLogs": [{"s": 0, "t": current_timestamp_ms}],
            "totalSteps": int(stepid),
            "watchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025 - 01 - 17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "sport.watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        response = self.make_request(self.config['api_config']['STEP_URL'], headers, data)
        return response
    def getyk(self, watchid, bind_number, chipid, model):
        data = {"level": 8, "pageNum": 1, "pageSize": 10, "watchId": watchid}
        headers = {
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "11910",
            "packageName": "com.xtc.personalcenter",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
            "dataCenterCode": "CN_BJ",
            "Version": "W_9.9.9",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "90",
            "Host": "api.watch.okii.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
            "User-Agent": "okhttp/3.12.0"
        }
        like_detail = self.make_request(self.config['api_config']['LIKE_DETAIL_URL'], headers, data)
        return like_detail
    #点赞状态
    def getlike(self, watchid, bind_number, chipid, model):
        friend_info = self.friendslist(watchid, bind_number, chipid, model)
        if not friend_info:
            logger.warning("未获取到好友信息")
            return
        if friend_info['code'] == '000001':
            friend_dict = {item['friendId']: item['name'] for item in friend_info['data']}
            friend_ids = list(friend_dict.keys())

            # 获取等级
            headers = {
                "model": model,
                "imSdkVersion": "102",
                "packageVersion": "48150",
                "packageName": "com.xtc.grade",
                "Eebbk-Sign": "0",
                "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
                "dataCenterCode": "CN_BJ",
                "Version": "W_9.9.9",
                "Grey": "0",
                "Accept-Language": "zh-CN",
                "Watch-Time-Zone": "GMT+08:00",
                "Content-Type": "application/json; charset=UTF-8",
                "Host": "points.tiancaixing.com",
                "Connection": "Keep-Alive",
                "Accept-Encoding": "gzip",
                "User-Agent": "okhttp/3.12.0"
            }
            url = self.config['api_config']['GET_WATCH_INIT_INFO_URL'].format(watchid=watchid, model=model)
            init_info = self.make_request(url, headers, method='get')
            # make_request 失败返回 {code: ERR}，不能再用 if not init_info 判断
            if not init_info or init_info.get('code') != '000001' or not init_info.get('data'):
                logger.warning("未获取到等级信息")
                return

            levels = {item['watchId']: item['level'] for item in init_info['data']['levelRankInfo']}
            for friend_id in friend_ids:
                if friend_id not in levels:
                    levels[friend_id] = -1

            can_like_dict = {}
            for friend_id, level in levels.items():
                if 0 < level < 11:
                    can_like_dict[friend_id] = 5
                elif 10 < level < 21:
                    can_like_dict[friend_id] = 10
                elif 20 < level < 61:
                    can_like_dict[friend_id] = 20
                else:
                    can_like_dict[friend_id] = -1

            # 获取已点赞数
            # 原项目用 range(99999) 无上限，服务端永远返回满页会导致死循环
            # 加 max_pages 安全上限：每页 10 条 = 2000 条点赞已远超实际可能
            max_pages = 200
            likes_number_dict = {}
            for i in range(max_pages):
                data = {"level": 8, "pageNum": i + 1, "pageSize": 10, "watchId": watchid}
                headers = {
                    "model": model,
                    "imSdkVersion": "102",
                    "packageVersion": "11910",
                    "packageName": "com.xtc.personalcenter",
                    "Eebbk-Sign": "0",
                    "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
                    "dataCenterCode": "CN_BJ",
                    "Version": "W_9.9.9",
                    "Grey": "0",
                    "Accept-Language": "zh-CN",
                    "Watch-Time-Zone": "GMT+08:00",
                    "Content-Type": "application/json; charset=UTF-8",
                    "Content-Length": "90",
                    "Host": "api.watch.okii.com",
                    "Connection": "Keep-Alive",
                    "Accept-Encoding": "gzip",
                    "User-Agent": "okhttp/3.12.0"
                }
                like_detail = self.make_request(self.config['api_config']['LIKE_DETAIL_URL'], headers, data)
                # make_request 失败返回 {code: ERR}，需显式判断 code
                if not like_detail or like_detail.get('code') != '000001' or not like_detail.get('data'):
                    break
                for record in like_detail['data']['records']:
                    likes_number_dict[record['watchId']] = record['likes']
                if len(like_detail['data']['records']) < 10:
                    break
            else:
                # for-else：未 break，达到 max_pages 上限
                logger.warning(f"getlike 达到 max_pages={max_pages} 上限，可能未拉取完全部点赞记录")

            for friend_id in friend_ids:
                if friend_id not in likes_number_dict:
                    likes_number_dict[friend_id] = 0

            # 整理结果
            results = []
            for friend_id in friend_ids:
                if likes_number_dict[friend_id] != can_like_dict[friend_id]:
                    results.append(f"{friend_dict[friend_id]} : {likes_number_dict[friend_id]}/{can_like_dict[friend_id]}")

            if results:
                return [False, results]
            else:
                return True
        else:
            return friend_info

    def getlike_hasid(self, watchid, bind_number, chipid, model):
        friend_info = self.friendslist(watchid, bind_number, chipid, model)
        if not friend_info:
            logger.warning("未获取到好友信息")
            return
        if friend_info['code'] == '000001':
            friend_dict = {item['friendId']: item['name'] for item in friend_info['data']}
            friend_ids = list(friend_dict.keys())

            # 获取等级
            headers = {
                "model": model,
                "imSdkVersion": "102",
                "packageVersion": "48150",
                "packageName": "com.xtc.grade",
                "Eebbk-Sign": "0",
                "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
                "dataCenterCode": "CN_BJ",
                "Version": "W_9.9.9",
                "Grey": "0",
                "Accept-Language": "zh-CN",
                "Watch-Time-Zone": "GMT+08:00",
                "Content-Type": "application/json; charset=UTF-8",
                "Host": "points.tiancaixing.com",
                "Connection": "Keep-Alive",
                "Accept-Encoding": "gzip",
                "User-Agent": "okhttp/3.12.0"
            }
            url = self.config['api_config']['GET_WATCH_INIT_INFO_URL'].format(watchid=watchid, model=model)
            init_info = self.make_request(url, headers, method='get')
            if not init_info or init_info.get('code') != '000001' or not init_info.get('data'):
                logger.warning("未获取到等级信息")
                return

            levels = {item['watchId']: item['level'] for item in init_info['data']['levelRankInfo']}
            for friend_id in friend_ids:
                if friend_id not in levels:
                    levels[friend_id] = -1

            can_like_dict = {}
            for friend_id, level in levels.items():
                if 0 < level < 11:
                    can_like_dict[friend_id] = 5
                elif 10 < level < 21:
                    can_like_dict[friend_id] = 10
                elif 20 < level < 61:
                    can_like_dict[friend_id] = 20
                else:
                    can_like_dict[friend_id] = -1

            # 获取已点赞数（同 getlike，加 max_pages 安全上限）
            max_pages = 200
            likes_number_dict = {}
            for i in range(max_pages):
                data = {"level": 8, "pageNum": i + 1, "pageSize": 10, "watchId": watchid}
                headers = {
                    "model": model,
                    "imSdkVersion": "102",
                    "packageVersion": "11910",
                    "packageName": "com.xtc.personalcenter",
                    "Eebbk-Sign": "0",
                    "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2024-05-12 14:43:48","token":"{chipid}"}}',
                    "dataCenterCode": "CN_BJ",
                    "Version": "W_9.9.9",
                    "Grey": "0",
                    "Accept-Language": "zh-CN",
                    "Watch-Time-Zone": "GMT+08:00",
                    "Content-Type": "application/json; charset=UTF-8",
                    "Content-Length": "90",
                    "Host": "api.watch.okii.com",
                    "Connection": "Keep-Alive",
                    "Accept-Encoding": "gzip",
                    "User-Agent": "okhttp/3.12.0"
                }
                like_detail = self.make_request(self.config['api_config']['LIKE_DETAIL_URL'], headers, data)
                if not like_detail or like_detail.get('code') != '000001' or not like_detail.get('data'):
                    break
                for record in like_detail['data']['records']:
                    likes_number_dict[record['watchId']] = record['likes']
                if len(like_detail['data']['records']) < 10:
                    break
            else:
                logger.warning(f"getlike_hasid 达到 max_pages={max_pages} 上限，可能未拉取完全部点赞记录")

            for friend_id in friend_ids:
                if friend_id not in likes_number_dict:
                    likes_number_dict[friend_id] = 0

            # 整理结果
            results = []
            for friend_id in friend_ids:
                if likes_number_dict[friend_id] != can_like_dict[friend_id]:
                    results.append(f"{friend_dict[friend_id]}({friend_id}): {likes_number_dict[friend_id]}/{can_like_dict[friend_id]}")

            if results:
                return [False, results]
            else:
                return True
        else:
            return friend_info

    # 强加好友
    def add_friend(self, watchid, bind_number, chipid, model, friendid):
        data = {
            "friendId": friendid,
            "groupName": "ZxeBot XTC公益Bot",
            "imDialogId": 1,
            "type": 0,
            "verification": "官方交流群590196390",
            "watchId": watchid
        }
        headers = {
            "Accept-Encoding": "gzip",
            "Content-Type": "application/json",
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "102",
            "packageName": "com.xtc.personalcenter",
            "Eebbk-Sign": "0",
            "Base-Request-Param": json.dumps({
                "accountId": watchid,
                "appId": "2",
                "deviceId": bind_number,
                "imFlag": "1",
                "mac": "unknow",
                "program": "watch",
                "registId": 0,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "token": chipid
            }),
            "dataCenterCode": "CN_BJ",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset=UTF-8"
        }
        response = self.make_request(self.config['api_config']['ADD_FRIEND_URL'], headers, data)
        return response

    def getfriend2(self, watchid, bind_number, chipid, model):
        data = {
            "watchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "49800",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025-01-17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "CN_BJ",
            "Version": "W_3.7.5",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "895",
            "Host": "watch.okii.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
            "User-Agent": "okhttp/3.12.0"
        }
        response = self.make_request(self.config['api_config']['WATCH_FRIEND_INFO_URL'], headers, data)
        return response

    def personalinfo(self, watchid, bind_number, chipid, model):
        data = {
            "watchId": watchid,
            "exwatchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "49800",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025-01-17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "CN_BJ",
            "Version": "W_3.7.5",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "895",
            "Host": "api.watch.okii.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
            "User-Agent": "okhttp/3.12.0"
        }
        response = self.make_request(self.config['api_config']['GET_PERSONAL_INFO_URL'], headers, data)
        return response


    #获取FriendID信息
    def getfriend(self, watchid, bind_number, chipid, model, friendid1):
        data = {
            "watchId": friendid1
        }
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025-01-17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "CN_BJ",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            # 动态计算 Content-Length
            "Content-Length": str(len(str(data).encode('utf-8'))),
            "Host": "watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        response = self.make_request(self.config['api_config']['GETFRIEND_URL'], headers, data)
        return response

    #好友圈Web链接
    def momentlink(self, watchid, bind_number, chipid, model, desc, link):
        payload = {
            "content": json.dumps({
                "appIcon": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAUwBTADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9LaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfRRRQAUUUUAFFFFABRRRQAyiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0djRR2NADKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAdmjNNooAdmjNNooAdmjNNooAdmjNNooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfR2NFHY0AMooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfR2NFHY0AMooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfR2NFHY0AMooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB9FFFABRRRmgApppd1NoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB26jdTaKAFzSUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUoFACUU7bRtoAbRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFKBmgCnUAAGKKKKACiiigBlFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAD6aepp1NPU0AJRRRQA8dKKB0ooAQ02nGm0AFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+jsaKOxoAZRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+iiigAooooAQ9KbSk0lABRRRQA+iiigAooooAKKKKACiiigBlFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+iiigAooooAKKKKACiiigBlFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAD6aepp1NPU0AJRRRQA8dKKB0ooAQ02nGm0AFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+jsaKOxoAZRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+iiigAozSE02gAooooAKKKKAHZozTaKAHZozTaKAHZozTaKAHZozTaKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAdmjNNooAdmjNNooAdmjNNooAdmjNNooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH009TTqaepoASiiigB46UUDpRQAhptONNoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB9HY0UdjQAyiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBc0ZpKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfTT1NOpp6mgBKKKKAHjpRQOlFACGm0402gAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0djRR2NADKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH009TTqaepoASiiigB46UUDpRQAhptONNoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB9HY0UdjQAyiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0UmRRkUALRSZFGRQA2iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0UUUAFIelLSHpQA2iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH009TTqaepoASiiigB46UUDpRQAhptONNoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBd1GaSigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAopcUlABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+iiigApD0paQ9KAG0UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+mnqadTT1NACUUUUAPHSigdKKAENNpxptABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFADaKKqapqtjoenz3+pXlvp9jAu6W5upViijHqzMQAPrTsIur0or5C+Lv8AwUV8I+EGuLDwhZy+K75cr9oL+TaKef4vvHkf3a+P/iV+2X8VPiN5sM/iSbRtPbj7Ho4+zpj03L+8b/gTV7+GyTEV99Dhq4yFNXWp+qPjP4t+Cfh/EW8ReKtK0qTtDcXKiQ/RPvN+ANeH+J/+CiHwn8Ou8enzap4jlHT7BZ7UP/ApSn8q/LOS5kuZXlld5JZDuaWZyzsfU5/rUVfTUeGqEV+9k2ec8wqPZWPvzxH/AMFRlXeui+AS/wDdkvtTx/44kf8A7NXCah/wU2+Is24WPh/w9Zg9DLDLKR+cgr4+p9epTybBU9oGLxdWXU+pLn/go98XbjPlHQof+uenkf8AoT1V/wCHivxl/wCf3Rv/AAWp/jXzLTcmt/7Lwf8Az7QvrNX+Y+pYP+Cj/wAX48ea2gS/9w3H/s9dBpX/AAU4+IFtgX3h3Qr0dyiSRk/k1fHWTTqTyrBv/l2hfWqq6n3tov8AwVIG4DV/AJA7yWeo8f8AfDJ/7NXoPhz/AIKW/DPUyF1TSta0c93MKTKP++W3fpX5kUyuaeRYOr9mxccbVR+yvhP9rL4P+MkT7B46023mfpb6gxtZPykAr06x1Sz1S3Weyu4LyB+VlgkDqfoRX4OVraF4t1vwxcCfR9XvdLlHR7Odoj/46RXlVuF4NXoysdMMwf2kfuuDmivyP8Ffty/FzwZGkK6+msWq4/dapAszH/tp/rP/AB6vof4ef8FPLC48u38beFprNhgNeaPKJFPv5b8r/wB9NXgV8hxdHVK51Qx1KTsfdNFeS/D79qr4XfEsxRaN4ttFvHIUWN+fsk7H0Af7x/3c16xXiToVKTtUVjtjUjP4WOooorI1CiiigAooooAKKKKgAooooAKKKKACiiigB9FFFABSHpS0h6UANooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB9NPU06mnqaAEooooAeOlFA6UUAIabTjTaACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKo63rdj4d0m71PU7qOysLWMyTXEx2oijuTX5yftRft1aj44N54a8CTSaV4f8AmSfUE+We79dv/PNP/Hv93pXpYHAVsbLlgc1avGirs+jP2iv25vDPwhNzovh8ReJPE4Uo0cL5tbZv+mkg6t/sr/wLbX51/FT45+MfjDqb3fijWZr1M5jsgxSCIekcY+X+v1rh/OyKYDk1+l4HKsPg43SvLuzwK2KnV06EnSkI4NAPFBPFewjiGGkpTSVqAUUUVJQ+iiigkZRRRQAUUUUAFFFFWA+gdaKKggkHSvS/h1+0h8RfhXIn9geJ7u2tFIP2C5b7RbH2Ebbgo/3cV5lTaxq0KdaPLUimi4zlB3iz79+Gf/BTW1k8q28eeHpITwG1LRhuT6tC3I+is1fXHw3+NHgv4rWC3XhbxDZ6spHzQxyBZk9mjb5lP/Aa/Eqp7DULrSryO7sbmazu4jmOe3kKOh9mHIr5rE8PYerrR91no08dUh8Wp+8dFflZ8Jf+CgPxF+H3k2mtyR+NdJTA8m+Oy4Vf9mbG7/voNX218Jv22fhh8UhbWx1hPDerzYU6drDLCwb0WTPlt+DV8fjMoxWF1auu6PUpY2lU0ejPeaKQSI/KHcvY0teIjuuFFGaKkoKKKKACiiigAooooAfRRRQAUh6UtIelADaKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACilpKACiilxQAlFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAPooooAKKKKACiiigAooooAKKKKAGmkpTSUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAPo7GijsaAGUUUUAFFFFABRRRQAUUUUAFUNd1/TfDOlXep6texWGn2sTTTTzNhUQdTV+vzK/bf/alf4m65N4L8N3R/4RTTZMTzxHi9uFJzg941b/vrG75vlz6WAwU8bV5InNXrKjG7OW/az/a31j4263No+kSSaf4LtXIhtVbBvGH/AC1k9f8AZX+H/er5wqWm1+t4XC08JTVOmj5mpUlVlzSGUUUV1mYuaM0lFBI5ehpaRehpaACiiigAooooAZRRRQAUUUUAFFFFABRRRQA+mU+mUAFKvekpV70ASL0oFC9KOxqwPavg1+1z8QPg0Yrax1JtY0VDzpWpuZIlHPCHOU/A198/BP8Abe8AfF1YLG8uR4W8QOApsNQkxG5/6Zzfdb/gWD9a/JgmnV8/jcmwuKvK3LLuv8jrpYqpS0Tuj95s06vyQ+B37aPxB+DrQWRv28SeHkwDpeoSFtq/9M5PvR/Tlf8AZr9B/gh+1p4C+NsUVvZX40nxAQN2kX7BJSe/ln7sn/Afm9VWvgMXk+Jwl5NXj3R7VDFQq9bM9qooFFeMdoUUUUiwooorMAoooqgCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiinZgLikqpc6rZ2gJmuUTHXmsa7+IGi2oIFwZGHZRW9PD1avwRA6QE//qpQD1x+dcDcfFa2jyIbRm9Czis2f4r3b5EVpCnuSSa61luJf2R2Z6jn2pN4ryCb4j6tJ911T6CqUvjbWJut2w+ldMMory+J2Gotntgwexo/CvDf+Es1X/n/AJ/++zR/wluq/wDP/N/32a2/sWf8w+RnuOfY0V4rB461mLpdsfrV6D4k6un3nR/qKwnlFeO2ouVnrYcHoc/SgNXnVt8VZjxcWSY9Y61rX4laTKP30htz/t1ySwGIj9kVjsBzRVSzv4L2ISQSrIh7qatBq4ZRlF2krCFoooqQCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB2aM02igB2aM02igB2aM02igB2aM02igB2aM02igBTSUUUAFFFF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ooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0h6GlpD0NADaKKKACiiigBy9KWkXpS0AMooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD8s/wDgo8+79oph/d0i1H6yn+tfLi9a+oP+Cjn/ACcbL/2CbT/2pXy+vWv2HLf90h6HyuJ/jSJB0paQdKWvUOYZRRRVkhRRRQAUUUUAFFFFABRRRQAUUUUAFFLg0lWAUUUUgH0UUUAFFFFMBlFFFQAUUUUAPpnrT6Z60AFN9adSbaAFooooAKKKKACiiigAooooAKKKKCgpVNJRQZko6V6l8CP2h/FHwH8Qi90e4M+nTsv23TJT+6uFH/oLDsw5FeV07NYVqFPEQdOorpmkJuDvE/Zz4G/H/wAL/Hfw4upaDdoLqMAXenyOvnWzejKP59K9Mr8NfAfjrXfhp4lh1/w1qU2lanFjMsDf6xf7rL0YH3r9Sv2Yf2s9C+OmlRafeiPSfFkSgS2RbCXBH3mh/wDif51+bZnk08JepT1ie/hsWqnuy3PoCiiivlz1AooooAKKKKACiiigAooooAKKKKACisrxJ4o0zwnpsl/qt3HaWycbnPU+gr5M+LH7Q+q+NDNp+jBtN0g5UsflklH+0e3+7Xu5dk2IzGXuq0e5Ldkeu/Fn9pDTPByzadobR6nq4BGd2YYj/tYPNfLHiPxhq3jHUnv9WvZLu4boGPyRj0VegFY4oHFfruWZNh8tV6esu5g5NjqKKK+hWhIUUUUAPpvrS5FJQWJTfWnU31oAdRRRQAUUUUAFFFFABRRRQAUo4pKKALmm6jPpd7Dd277ZYm3D0P1r37w5rcXiDSYbuI8sMMvdW7ivnTJGf896774R6/8AYdTk0+VsRXAymezCvEzKh7SnzrdG9N2dj2AcCloor487AooooAKKKKACiiigAooooAcOlFA6UUAFFFFABRRRUCPcvCd//aHh6ykLbnEYV/8Ae7/4/jWtXE/C+78zRpoieY5QfwOR/Su2r87xMPZ1pQ7M55OzCiiiuYkKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfSHoaWkPQ0ANooooA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ABSUtNNAATmkoooAfRQKKACiiigAooooAKKKKALmm2L31ykKDJY4r2rw7pC6Dp6Wygb8fvD6msPwJ4VXSrZb24TNw4+RSOnvXXV8VmOL9tPkjsjGTvoOooorxCQooooICiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigApQcUlFAC5pKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB9fMX7a37NC/Gjwa2vaLbA+LtHjZ7dUHN5CMs0TerfxL/tfXdX072NRHqa6sLiJ4aqpwZlUgqkXGR+DDo0cjo6NG6MVZWGCDSV9p/t8/sxP4d12b4j+GrP/AIlGpSD+1reFc+Rctn97j+6//oX1r4pr9fwOMp4ykpwZ8vVpOjLlYUUUV6ZiPpOxpaTsazJG0UUUAFFFFABRRRQAUUUUAFFFFABRRRQA+vRPhN8RpPDd0ul6jJu0qWQAEn/UFv4v93+9XndOrWnLldzSE3B3R9f5NLXlPwe+IH22JPD2oSj7So/0WU/xqP8Aln9f7v8A9YZ9Wr14SUldH0VKpGpHmQUUUVobj6KKKsAooooAKVetJXW+APh/qXjnWorCwi3MeZJSPliX+8a5sRiIYaDqVHoA74efDzUfH2sx2dnGRECDNOR8sa19q+CfBmm+CdGj0/ToQigDfJj5pD6k1F4J8C6d4G0ePT9PjAwMyTEfNI3qa6VRgV+LZznE8wm4r4OhcULRRRXyxqFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAVR1fVYdIspLiZsKo4H94+lT3t7FY27zSsFRRkk14x4o8TT+IbwsxKQKcJGOgFengcI8RK72RcVcr65rU2t30lxKx5Pyr2A9KzaKK+1p01CNkbWCiiitRDaKKKssKKKKACiiigAooooAKKKKACiiigAooowaACuy8A+Ev7Wn+23S/wCjRn5VP8RrG8LeHJvEOoLEoKwqcyP6CvarW0isbaO3gUJEgwAK8DMsX7OPs4vUhuxPRTadXxxiFFFFAwooooICiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACilxSUAFFFFABRRRQAUUUuKAEooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooWgFLWdGstf0q80zUraO90+8iaGe3lGVkQrgg1+Qn7VH7P9/8A/iPc6a2+40O9D3GmXhTiSPJzGx/56JkKw/3TwGr9iK88+PHwZ0b46eAbzw9qyCObaZLO9C5e2mAOxx7DoR3UkV7uU494OtrszjxNBVoWPxSp9b3j7wNqnw58Wal4f1mBoL6wlMLgjg/7S/7Lfe/4FWCK/WKVSNWKlF6M+YlFwbix9J2NGRRkYqyRtFFFABRRRQAUUUUAFFFFABRRRQAUUUUAPo6UUVZBLDI8Th0dkdeVZTgg19B/DD4ip4ttBY3zhdXhXkn/luo/iHv6/nXzzVzSNWn0XUYL61cpNCwZSK3pzcHodOHqulK6PrSisHwT4wtvGmkpeQkRTDi4t+8bf8AxPpXQivSjJNXR9JCamuZBRRSr1rQsMGkqUDI6V0fgfwTqHjXWodO06AyzORuYj5I17sx7AVjXxEMPB1Kj0Af4A8D6j441mLTdNiLSynLyEfKijqSf7tfavgHwDp3gDRUsbJAZCB50+Pmmb1NM+HXw7074d6KtpaKJLlwDPckfM5/wrqK/F87zmeYVOSDtBfiXYMUUUV8qaJWCiiigYUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFRXNylrE0kjAKozzT5ZVhjZ2OAO9eYeNvF5u5Gtbdv3Y4JHeu3CYaWJnZbDSuUfF3i2XW5miiJS2U8D+9XLU7zC3JptfdUqMaUFGOx0pWG0UUVsMKKKKACiiirAKKKKACiiigAooooAKKKKACiiigAXrVuxs5L64SCJS7ucACqleseAfC40q2F7Ov+lSDgH+Af41wYzErDU79WS3Y2fDWhR6BpqQKMynmR+5P+FbIFA5or4SdR1JOUjJu4UUUVAgooooAdgUYFLRUECYFGBS0UAMooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0hFLRQAyilNJQAUUUq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ooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooHNeYfHf4qL8O/DoitpV/ti9/d2ynoi/xSH/d6114TDTxlZUYbsDz79pD4vnzn8KaPL+7A238iHqP+eYb/wBC/wD2q+baknuZbyeSeeVppZDvZ2OSSeair91y3LoZdQVKHzMpMbRSZpc5r2YmVxD0ptOPSm1QgooooLCiiigB9FFFIDzr4sfD8eIrF9TsY/8AiawL91RzKg/qv8P/AHz/AHa+fyCM5GD0I9DX2FXjHxh+Hn2OSTXdPi/cSHN1Eo+4f76j3/i/76rhr0r+9E8rE4f7cTySiiivMPHYUUUUgCvXv2cv2dtV+PPi+OwiL2eiW+Jb+/xwibvug+prmPg78Itb+NHjS18O6IgEsnzTXDjKW8fd29hX69/B74Q6H8GfBNl4d0WEBIVDT3GPnuJf4nY18vnGavCx9lS+Jno4TDOq+aWxs+DfBuleAPDGn6BolnHZ6fYxiGJI1xwP4m92+9W/im06vzGcnNtt6n0kUkrIKKKKyLCiiirAKKKKCAooooAKKKKACiiigAoopcZoASiiigBegpoBX6UsbBDg8mqWtavBo1q007gLjj/aPpV06cqjsgG6vrFto1lJPcOFQdB3Y+grxjxF4iudfvWlkYrGD8idgKm8TeILjX7wySMViBwkfZRWJnjHevs8DgVSXNI0jHqxaM0UV7RoFFFFABRRRQWNNC96DQvegB1FFFABRRRQAUUUUAFFFFABRRRQAVDd3cNjbSXFxKsUMYyzscAVKynYzZCqvVmOMV8wfG34tt4lu20fSpyNKhb95Kv/AC2Yd/8AdrvweDli6nLEWxnfGP4o3HjfUmtbV2TR4W+RQeHP95v/AGWvNelOpa/TsPh4YeHJE5ZO7CiiiuggdRRRUgNPU0UHqaKAHUUUVRYUdKKKj+J7gH35+yb8cF8f+Gv7B1WYf29pkYCFzzcQdFb3ZeK+gq/J/wAAeNtQ8A+KbLWdMlMV1aSB154cfxI3+yw+X8a/Tf4ZfEHTviX4Rstd05wUmXEkWctE4+8p+hr8K4oyR5dXdemvcYHV0UUV8KAUUUVABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAGD4w8V2fgvw7d6xeybYYV+VP+ej/AMKgdyTXwj418Xah4516fVNSlMkkh+RM8IvYD2ruvj78VG8eeITY2Mh/sWxYpCAeJW7vXlNfsvDmTrBU1iKq99/gQx44pCaWkPQ19mQR5pQc0Ghe9WSPXvS00HFOzmgBlFFFQAUUUUAFFFFWAUMiyxtHIoeNhgq3Q0opMfL/AJ/vUhtJ6M+evih8P38J6kbm1jLaXcNmMj/li391vb+7XCV9c6ppdtrVhJaXcayRuuMMK+avHHg+48JatJC6mW2Y5gn7Onp9Vrza9FR96J4GKw/s3zLY5ut3wR4J1f4heJrLQNDs5L3Ubx9kUaDIB/vMeyjue1ZulaZc6vf29jZwvc3dxIsMMES7nkc9ABX6n/sgfsyQfBfwqmqavCj+LL+MNcsRk2wb5vJX3/vNXy+Z4+OCpN394woUHWlZHZ/s4/s86N8B/BcWnWqpc6xOA+o6iV+aaT+6p7IOgFeuUzpTq/Jq1adebnN6s+opwUFZBRRRWBqFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAKvNOz2qPkUbvzqAHHim8nPpTl6HdWdrOsQaNaPPOwCgcL3Na06bqOyAXVNVt9HtHuLhtoHRe7H0rx/wASeJbjXrxpJGIjHCRjoopviPxHca5dM7sQg+6g6AVjYNfZYHAqiuae5rGPVj6TFFFe0WNoooqiwooooAKKKKACiiigAooooAKKKKAGUq96SlXvQBIvSihelKvWgAwaOlSAcV4h8cPi7HpUEugaNd+bfyjbcXMR/wBQv91SP4q68Nhp4mfs4biMr47fFwTpL4d0Wb5G+W7uoz1/2Fb+deDYqXjFNr9IwmEp4Sn7On/w5lJ3GUUUV6BgFFFFAgooooAKKKKACiiigAooooWgDa93/ZV+Ng+GPiVbDU5WGhag6xzEniF84WQe3rXhYGakHArgzDB08fQlQq7Ms/XyGVLiPehyp6GnV80fsbfGz/hLNAHhHVLjOq6bH/o0kh5ntxwF99vA/wC+a+lK/m3HYGrl2Ilh6vT8fMAooorzQCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK8B/aY+K/wDZGn/8Ixp0v+l3Hz3r/wASR/3f+Bfy/wB6vUPih8QbT4deFbnUpyr3BHl20JPMkh6D6Dqa+EdX1i61rULm9vJmuLq4cySysclj/hX3PDWUvFVfrFVe4iW7FOiiiv2IgKKKKAE20vSiiggKKKKACiiioAKKKKACiiirAVe9Opq96evWgsTHFY/iHwfbeLdMmsZxt3fMsgHMbdmH9a3VXjNe8/s7fB7+17iLxLq0X/Evj/49rcj/AFzf3voK8rMsbTwOHlVqf0yJRU1yswf2NP2RW+HFy/jbxZEr66+6PT7MjK28R/5bMP8Ano38K/wj/a+79h0UV+E4vF1MZUc5io0Y0Y8sR1FFFcRsFFFFBYUUUVABRRRQAUUUUAFFFFABRRRQAUUUUABOKQY6jrQ3IPrWXrGt2+h2rzXDgNj5U7saqnTdR2QEus61b6LZtPcMBj7q9ya8e8QeIrnX7tpJWIjB+WMdAKbr/iG41+8aWYnA+4g6KKzPujHWvssDgVTXNI1jEXApCOKAeKCeK9ksYaSlNJQAUUUVZYUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA6lHWkrtfA3g7+0J/tV0P8ARR0H99v/AImuavXjh4c7JbseB/HH4jzeA9MGnQQyRapewmSOR1wqpkjdn8K+UJT5khcszM3VmOSfxr9Kf2gPgna/FrwU9nCqQavY5lsJsfdbun+6emK/N7UtNudG1G60+9haC6t5DHJE45VgeRX2nC+OoYqhJR0n1/Qxcytk0lFFfbkBRRRTICiiigAooooAKKKKACiiigAooooAfRRRSLNTwh4pv/BHiSy1rS5m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bNfUt/SvMB1r0n4rt+6sV93/AKV5sPvV93lWuHiawHdjTad2NNr2DYKKKKACiiigAoooqACiiigAooooATHvQBjvS0UAOHSm06m+tABTPWn0z1oAKKKKAH0CiigAfpSR9TSuaah60ASHpTaU00HNAC0UUUAFFFFADKKKKsAooooAKKKKAFzSUUUAPopMiloEFKo5pK6Twr4OvNfckr5Fn1Nwep9lrCrVjSjeQGZpelT6pOIoUz/eY9FHqa9c8NeDbLw7FuAE10R80zDkey+grR0fSLXRbcW1pGFQdWxy31q7XyGMx8q14w2M2wpMUUV4RiFFFFABRRRQAUUUUFmV4m8LaX4w0a40rWLOK+sZhh4pFz+I9D71+fP7QP7O2rfCHUHvrdX1DwvcMfJvAMvB/syf5/75r9G6hvrG21OzmtLy3ju7WZdskEyhlcehBr6PJ87r5TUvHWD3Qj8g6dX0h+0f+ypdeBZLjxF4Uhe78NsS81nGN0tn6nHVl9u3/j1fN4ORX71gcxoZlRVag9PyM2rBRRRXpoQUUUVYBRRRQAUUUUAFFFFACg4ozSUUAFFFFABRRRQAUUUUAFFFFABRRRQAUhWlpQM1QDMUgSpQtLtoAjCgUtLikqQCiiigAooooAeOlFA6UUAFNPU06mnqaAGHqaKD1NFADqKKKoAooooAfXuP7Glx5HxusFzzJa3Cf+Q939K8Or1/9kuTy/jp4bH95pV/8hPXhZ3Fzy+sl/Kykfo9RRRX80WGFFFFIAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDgfiyn+h2DejOP0H+FeZKeTXqnxXTOkWp9Jsf8Ajp/wryvGGr7fKH/s6NYD6KKK9k2G0UUVYBRRRQAUUUVABRRRQAUUUqjNACYNGDTqKACm+tOpvrQAUz1p9M9aACiiigB9FFFADW4FNj70rdDSJ3oAeehpvSlNJQA+iiigAooooAZRRRVgFFFFABRRRQAUUUUCFVecdaliheaQIoLE9AKs6VpFxqk4htozI5PavV/C/ga20aJZpwJbvryOFry8VjI4ZeZmc74V+HbuyXWo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pdtLRQAyiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAop2KMUANop2KMUANop2KMUANop2KMUANooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAVRTqRe9LQAUUUUAMooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfRRRQAUUUUAFFFFABRRRQAyiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfR2NFHY1IDKKKKoBy96WkXvS0AFFFFSA2kpT1NJVAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRUAFFFFAD6KKKACiiigBlFFFWAUUUUAOXoaWkXoaWgAooooAZRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+jsaKOxoAZRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+jsaKOxqUAyiiiqAcvelpF70tABRRRUgNPU0lKaSmgCiiimAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUVABRRRQA+iiigAooooAZRRRVgFFFFADl6GlpF6GloAKKKKAGUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAPo7GijsaAGUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAPo7GijsalAMoooqgFXvTqZTlNAC0UUVICGm049KbTQBRRRTAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKgAooooAfRRRQAUUUUAMoooqwCiiigBy9DS0i9DS0AFFFFADKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfRSZFGRUALRSZFGRQA2iiirAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfR2NFHY1KAZRRRVAFFFFADlNLTKcpqQA9DTaeehplNAFFFFMAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooqACiiigB9FFFABRRRQAyiiirAKKKKAHL0NLSL0NLQAUUUUAMooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooqACiiigB2BRgUtFWAmBRgUtFADKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAf2NMp/Y0ypQBRRRVAFFFFADx0ooHSigAoooqAGmkpTSU0AUUUVQBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRUAFFFFABRRRQAUUUUAFFFFWAUUUUAFFFFABRRRQAUUUUAFFFFADl6GlpF6GloAKKKKAGUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAPooooAKKKKACm+tOpvrQAlFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAD6KKKAGnqaSlPU0lABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAD+xplP7GmVKAKKKKoAooooAeOlFA6UUAFFFFQA00lKaSmgCiiiqAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKgAooooAKKKKACiiigAoooqwCiiigAooooAKKKKACiiigAooooAUHFG6kooAXdRupKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigB9FFFABRRRQAU31p1N9aAEooooAKKKKACiiigAooooAKKKKACiiigAooooAfRRRQA09TSUp6mkoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAf2NMp/Y0ypQBRRRVAFFFFADx0ooHSigAoooqAGmkpTSU0AUUUVQBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRUAFFFFABRRRQAUUUUAFFFFWAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAD6KKKACiiigApvrTqb60AJRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA+iiigBp6mkpT1NJQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA/saZT+xplSgCiiiqAKKKKAHjpRQOlFABRRRUANNJSmkpoAoooqgCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiioAKKKKACiiigAooooAKKKKsAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0UUUAFFFFABTfWnU31oASiiigAooooAKKKKACiiigAooooAKKKKACiiigB9FFFADT1NJSnqaSgAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAfTfWnUygBRTqZT+tABTfWnUygBRTqZT+tACEU2n0hFADaKKKACiiigAooooAKKKKAClXrSUo4NADqKKKkBlFFFIAooooAKKKKAHjpRTQcUu6gBaKTIoyKAFoooqwCjtRSE8UAJSUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAPBpufakooAKKKKACiiigBQcdqdmmUUAPzRmmUUAKaSiigAoooqQH0UDkUUgGUUUVYDx0ptANJQA5e9LTVOKdkUAFFJkUZFAAaRetBNC9agB3Y0ynnoaZTQD6aeppwpvrVAKvSkNKvQ0hppgJRRRSAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAH0UZpCaAEJpKKKACiiigAooooAKdkU2igAooooAKKKKACiiigAooooAKKKKAH0UUUANPU0lKeppKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBxNNpxptABTlNNpy96AAmm0402gApymm05e9AC0UUUAIRTafSEUANooooAKKKKACiiigAoopRzQA4c0h6UtHY1IDKKKKQDgMik204DAooAbikp9NIoASiiigAooooAfRRRVgJn2ptPpuKAEooooAKKKKAFxRinUUANxRinUUANxRinUUANxRinUUANpKfRQAyin4FJgUANop22jbQA2il20YNACUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUVIDl70tIo60tIBNtIRinUh6VYDaKKcvQ0ANopxpueaACiiigApRSUo61NgFPSm049DTaaQDh0ptPHSmUwHL3pD1NKvQ0h60AJRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFLtoxQAlFFFABRRRQAUUUUAFFFFABRRRQAUUUoGaAEop22kxQAlFFFABRRRQA+iiigBp6mkpT1NJQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAOI4ptPpCKAG05RgUKKWgBCOKbT6QigBtOUYFCiloAKKKKACiiigBCKbT6QigBtFFFAC4pKfRigBlOUYpcUUAFFKBRipAYRSU/FNxSAdRRRQAUUUUAJtpNpp1FADaSn0UAFFLto21YCUUYooATFJtp1FADcUYp1FABRRRQAUUUUAFFFFABRRRQAUUYoxQAUUYoxQAUUYoxQAUUYoxQAyiloHNAABmlC0oGKKAE20mKdRigBlFLSUAFFFOC+tACYo204DFFACbRS4xRiipAKKKKQBSHoaWjsasBlPXpTKkQUANPSmY5qVhUeOaACinKOKWgBMcUKOtLRQAU0Cn4pKACmkc0/HFJSuAAYFIRSgZopXAbijFOoqgG4oxTqKAG4pKfSEUANooooAXbRtp1FADdtG2nUUAN20badRQA3bRtp1FABRRRQAmKTbTqKAG4pKfRigBlFO20baAG0UpHFJQAoGaXFCilxQAynKOtGKcooATFFPppGKAEooooAKKKKACiiigBCKbT6QigBtFFFABRRRQAUUUUAPooooAKKKKAEIptPpCKAG0UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/9k=",
                "appName": "ZxeBot 公益XTCBOT",
                "desc": desc,
                "packageName": "com.xtc.moment",
                "transaction": "171496944632458f21984-f2d3-43b0-b153-64a1ae649f45",
                "webLink": link
            }),
            "emotionId": 105,  # 155修改105会变成z10贴纸
            "latitude": 0.0,
            "locationType": 0,
            "longitude": 0.0,
            "packageName": "com.xtc.moment",
            "resource": "moment_pic_ND01_06ad047dff5e4438847301a59f94703eO8rJB41s.webp",
            "resourceId": 0,
            "type": 25,
            "watchId": watchid
        }

        headers = {
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "53200",
            "packageName": "com.xtc.moment",
            "Eebbk-Sign": "0",
            "Base-Request-Param": json.dumps({
                "accountId": watchid,
                "appId": "2",
                "deviceId": bind_number,
                "imFlag": "1",
                "mac": "unknown",
                "program": watchid,
                "registId": 0,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "token": chipid
            }),
            "dataCenterCode": "CN_BJ",
            "Version": "W_9.9.9",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": str(len(json.dumps(payload))),
            "Host": "moment.watch.okii.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
            "User-Agent": "okhttp/3.12.0"
        }
        response = requests.post(self.config['api_config']['SPORT_LINK_URL'], json=payload, headers=headers, timeout=30)
        return response.json()

    def momentpic(self, watchid, bind_number, chipid, model, image_data, content_text="", momentid="0"):
        """发布图片动态（4 步流程，严格对齐原项目 src/plugins/momentpic.py）

        :param watchid: 手表 ID
        :param bind_number: 绑定号
        :param chipid: chip ID（用作 token）
        :param model: 设备型号
        :param image_data: 原始图片 bytes（任意常见格式：PNG/JPG/WebP/BMP；由 ImageUploader 转 WebP）
        :param content_text: 动态文字描述（iMoo 扩展字段；原项目无此字段，仅用于日志/UI 展示，
            发布 payload 中并不发送 — 原项目 content.appName 固定为 "来自ZxeBOT"）
        :param momentid: 动态槽位 ID（保留兼容签名，原项目实际不使用）
        :return: 服务端 JSON 响应

        4 步流程（参考原项目 momentpic.py）：
        1. ImageUploader.convert_to_webp 把原图转 640x480 padded WebP + 算 MD5
        2. POST /moment/file/pic/transfer 取 uploadToken + source.key（七牛上传凭证）
        3. POST upload.qiniup.com 用 token+key+crc32 上传 WebP 到 smartwatch-moment bucket
        4. POST /moment/public 用 type=8 / emotionId=247 / packageName=com.xtc.equitycard 发布动态

        与旧版（Task 3-A 单步匿名上传）的差异：
        - type: 1 → 8（图片动态原项目固定用 8）
        - emotionId: 0 → 247
        - packageName: com.xtc.sport → com.xtc.equitycard
        - mac: "unknown" → "unkown"（取凭证阶段）/ "02:00:00:00:00:00"（发布阶段）
        - program: watchid → "watch"
        - Eebbk-Sign: "0" → "1AA7CF224B9485CE713F0DF3CDB4092C"
        - Version: "W_9.9.9" → "W_1.6.9"
        - URL: SPORT_LINK_URL（uuid=0）→ _MOMENT_PUBLIC_URL（uuid=b16d92f...）
        - 新增 trackMd5Value 字段（绑定 md5 + watchId，服务端校验上传图与动态绑定关系）
        - appIcon: 空串 → 完整 BMP base64（与 im_client icon_data 同串）
        - resource: image_url basename → transfer 返回的 source_key
        """
        import hashlib
        import zlib
        import io as _io
        from core.image_uploader import ImageUploader

        # --- 步骤 1：转 WebP（640x480 padded）+ 计算 MD5 ---
        # 原项目用 FFmpeg scale=640:480:force_original_aspect_ratio=decrease,pad=...
        # ImageUploader.convert_to_webp(pad_to=(640, 480)) 用 Pillow 等价实现
        uploader = ImageUploader()
        webp_data = uploader.convert_to_webp(
            image_data, max_size=(640, 480), pad_to=(640, 480)
        )
        md5_hash = hashlib.md5(webp_data).hexdigest().upper()

        # --- 准备公共 headers（取凭证阶段，mac="unkown"）---
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        headers = {
            "model": model,
            "imSdkVersion": "102",
            "packageVersion": "53200",
            "Eebbk-Sign": "1AA7CF224B9485CE713F0DF3CDB4092C",
            "Base-Request-Param": json.dumps({
                "accountId": watchid,
                "appId": "2",
                "deviceId": bind_number,
                "imFlag": "1",
                "mac": "unkown",
                "program": "watch",
                "registId": 0,
                "timestamp": current_time,
                "token": chipid,
            }),
            "User-Agent": "okhttp/3.12.0",
            "Content-Type": "application/json; charset=UTF-8",
            "dataCenterCode": "CN_BJ",
            "Version": "W_1.6.9",
            "Grey": "0",
            "Accept-Language": "zh-CN",
            "Watch-Time-Zone": "GMT+08:00",
        }

        # --- 步骤 2：获取上传凭证 ---
        transfer_resp = requests.post(
            _MOMENT_PIC_TRANSFER_URL,
            headers=headers,
            json={
                "md5": md5_hash,
                "watchId": watchid,
                "dialogType": 5,
                "format": ".webp",
            },
            timeout=30,
        )
        try:
            transfer_json = transfer_resp.json()
        except ValueError:
            return {"code": "ERR", "desc": f"transfer 响应非 JSON: {transfer_resp.text[:200]}"}

        if transfer_json.get("code") != "000001":
            return transfer_json

        transfer_data = transfer_json.get("data") or {}
        upload_token = transfer_data.get("uploadToken")
        # source.key（原项目兼容 source.key 与 data.key 两种位置）
        source_obj = transfer_data.get("source")
        if isinstance(source_obj, dict):
            source_key = source_obj.get("key")
        else:
            source_key = transfer_data.get("key")

        if not upload_token:
            return {"code": "ERR", "desc": "获取上传 token 失败"}
        if not source_key:
            return {"code": "ERR", "desc": "获取文件 key 失败"}

        # --- 步骤 3：七牛预查询（原项目做，失败不阻断）---
        try:
            requests.get(
                _QINIU_QUERY_URL,
                headers={
                    "User-Agent": "QiniuAndroid/7.3.13",
                    "Accept-Encoding": "gzip",
                },
                timeout=5,
            )
        except Exception as e:
            logger.debug(f"七牛查询异常（忽略，继续上传）: {e}")

        # --- 步骤 4：七牛上传 ---
        crc32_value = str(zlib.crc32(webp_data) & 0xFFFFFFFF)
        try:
            upload_resp = requests.post(
                _QINIU_UPLOAD_URL,
                data={
                    "key": source_key,
                    "token": upload_token,
                    "crc32": crc32_value,
                },
                files=[("file", (source_key, _io.BytesIO(webp_data), "image/webp"))],
                headers={
                    "User-Agent": "QiniuAndroid/7.3.13",
                    "Accept-Encoding": "gzip",
                },
                timeout=30,
            )
        except requests.RequestException as e:
            return {"code": "ERR", "desc": f"七牛上传网络异常: {e}"}

        # 七牛上传成功通常返回 200 + {"key": "...", "hash": "..."}；非 200 视为失败
        if upload_resp.status_code != 200:
            return {
                "code": "ERR",
                "desc": f"七牛上传 HTTP {upload_resp.status_code}: {upload_resp.text[:200]}",
            }

        # --- 步骤 5：发布动态（更新 headers，mac="02:00:00:00:00:00"）---
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        headers["Base-Request-Param"] = json.dumps({
            "accountId": watchid,
            "appId": "2",
            "deviceId": bind_number,
            "imFlag": "1",
            "mac": "02:00:00:00:00:00",
            "program": "watch",
            "registId": 0,
            "timestamp": current_time,
            "token": chipid,
        })

        publish_payload = {
            "content": json.dumps({
                "appIcon": _MOMENT_PIC_APP_ICON_BMP,
                "appName": "来自iMooDesktop",
                "packageName": "com.xtc.equitycard",
                "trackMd5Value": json.dumps({"md5": md5_hash, "watchId": watchid}),
                "transaction": f"{int(datetime.now().timestamp())}c4075-5f17-4561-b57c-6baa9c3a7890",
            }),
            "emotionId": 247,
            "packageName": "com.xtc.equitycard",
            "resource": source_key,
            "resourceId": 0,
            "type": 8,
            "watchId": watchid,
        }

        try:
            publish_resp = requests.post(
                _MOMENT_PUBLIC_URL,
                headers=headers,
                json=publish_payload,
                timeout=30,
            )
        except requests.RequestException as e:
            return {"code": "ERR", "desc": f"发布动态网络异常: {e}"}

        try:
            return publish_resp.json()
        except ValueError:
            return {"code": "ERR", "desc": f"发布动态响应非 JSON: {publish_resp.text[:200]}"}

    def momentview(self, watchid, bind_number, chipid, model, page=1):
        current_timestamp = int(time.time() * 1000)
        base_request_param = {
                "accountId": watchid,
                "appId": "2",
                "deviceId": bind_number,
                "imFlag": "1",
                "mac": "unkown",
                "program": watchid,
                "registId": 0,
                "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "token": chipid
            }
        headers = {
                'User-Agent': '0',
                'Connection': '0',
                'Accept-Encoding': '0',
                'Content-Type': 'application/json',
                'model': model,
                'imSdkVersion': '0',
                'packageVersion': '0',
                'packageName': '0',
                'Eebbk-Sign': '0',
                'Base-Request-Param': json.dumps(base_request_param),
                'dataCenterCode': '0',
                'Version': '0',
                'Grey': '0',
                'Accept-Language': '0',
                'Watch-Time-Zone': '0',
                'Content-Type': 'application/json; charset=UTF-8',
            }

        from_offset = (page - 1) * 10

        data = {
                "watchId": watchid,
                "currentWatchId": watchid,
                "begin": 0,
                "end": current_timestamp - 1,
                "friend": 1,
                "from": from_offset,
                "lastLikeTime": current_timestamp,
                "size": 10,  # 每页10条
                "commentPageSize": 10,
                "searchPermission": 0
            }
        response = self.make_request(self.config['api_config']['MOMENT_SEARCH_URL'], headers, data)
        return response

    # 50 米 0 秒
    def sport_fifty(self, watchid, bind_number, chipid, model, runid):
        current_time = datetime.now()
        current_timestamp_ms = int(current_time.timestamp() * 1000)
        data = {
            "notifyApp": 0,
            "records": [
                {
                    "avgHeartRate": 0,
                    "calorie": 0.0,
                    "endTime": current_timestamp_ms,
                    "gender": 0,
                    "grade": 11,
                    "improvement": 0,
                    "restTime": 0,
                    "result": runid,
                    "sportType": 10,
                    "startTime": current_timestamp_ms,
                    "status": 1
                }
            ],
            "watchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025 - 01 - 17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "sport.watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        response = self.make_request(self.config['api_config']['SPORT_URL'], headers, data)
        return response

    def sport_rope(self, watchid, bind_number, chipid, model, ropeid):
        current_time = datetime.now()
        current_timestamp_ms = int(current_time.timestamp() * 1000)
        data = {
            "notifyApp": 0,
            "records": [
                {
                    "avgHeartRate": 0,
                    "calorie": 0.0,
                    "endTime": current_timestamp_ms,
                    "gender": 0,
                    "grade": 11,
                    "improvement": 0,
                    "restTime": 0,
                    "result": ropeid,
                    "sportType": 220,
                    "startTime": current_timestamp_ms,
                    "status": 1
                }
            ],
            "watchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025 - 01 - 17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "sport.watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        response = self.make_request(self.config['api_config']['SPORT_URL'], headers, data)
        return response

    def sport_bm(self, watchid, bind_number, chipid, model, bmid):
        current_time = datetime.now()
        current_timestamp_ms = int(current_time.timestamp() * 1000)
        data = {
            "notifyApp": 0,
            "records": [
                {
                    "avgHeartRate": 0,
                    "calorie": 0.0,
                    "endTime": current_timestamp_ms,
                    "gender": 0,
                    "grade": 11,
                    "improvement": 0,
                    "restTime": 0,
                    "result": bmid,
                    "sportType": 90,
                    "startTime": current_timestamp_ms,
                    "status": 1
                }
            ],
            "watchId": watchid
        }
        headers = {
            "model": model,
            "imSdkVersion": "0",
            "packageVersion": "0",
            "packageName": "0",
            "Eebbk-Sign": "0",
            "Base-Request-Param": f'{{"accountId":"{watchid}","appId":"2","deviceId":"{bind_number}","imFlag":"1","mac":"unkown","program":"watch","registId":0,"timestamp":"2025 - 01 - 17 20:31:57","token":"{chipid}"}}',
            "dataCenterCode": "0",
            "Version": "0",
            "Grey": "0",
            "Accept-Language": "0",
            "Watch-Time-Zone": "0",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Length": "65",
            "Host": "sport.watch.okii.com",
            "Connection": "0",
            "Accept-Encoding": "0",
            "User-Agent": "0"
        }
        response = self.make_request(self.config['api_config']['SPORT_URL'], headers, data)
        return response