import socket
import struct
import time
import json
import uuid
import base64
from typing import Dict, Optional, Any

class IntegerUtils:
    @staticmethod
    def pack_integer(value: int) -> bytes:
        if value < 0:
            raise ValueError("Value must be non-negative")

        if value <= 0xFF:
            return struct.pack('>B', value)
        elif value <= 0xFFFF:
            return struct.pack('>H', value)
        elif value <= 0xFFFFFFFF:
            return struct.pack('>I', value)
        else:
            return struct.pack('>Q', value)

    @staticmethod
    def unpack_integer(data: bytes) -> int:
        length = len(data)
        if length == 1:
            return struct.unpack('>B', data)[0]
        elif length == 2:
            return struct.unpack('>H', data)[0]
        elif length == 4:
            return struct.unpack('>I', data)[0]
        elif length == 8:
            return struct.unpack('>Q', data)[0]
        else:
            raise ValueError(f"Unsupported byte length: {length}")

    @staticmethod
    def convert_to_integer(data: bytes) -> int:
        return IntegerUtils.unpack_integer(data)

class TLVEncoder:
    FRAME_TYPE = 0
    DATA_TYPE = 32
    TAG_TYPE = 64

    @staticmethod
    def encode_tlv(frame_type, data_type, tag, value):
        header = TLVEncoder.encode_header(frame_type, data_type, tag)
        length = TLVEncoder.encode_length(len(value))
        return header + length + value

    @staticmethod
    def encode_header(frame_type_flag, data_type_flag, tag_value):
        if tag_value < 32:
            return bytes([frame_type_flag | data_type_flag | tag_value])

        combined_flags = frame_type_flag | data_type_flag | 0x80
        byte_count = TLVEncoder.calculate_byte_count(tag_value)
        return TLVEncoder.build_header_bytes(combined_flags, byte_count, tag_value)

    @staticmethod
    def calculate_byte_count(value):
        if value < 31:
            return 1
        return (value.bit_length() + 6) // 7

    @staticmethod
    def build_header_bytes(first_byte, byte_count, tag_value):
        result = []
        result.append(first_byte)

        for i in range(byte_count - 1):
            shift_bits = (byte_count - i - 2) * 7
            byte_val = ((tag_value >> shift_bits) & 0x7F) | 0x80
            result.append(byte_val)

        last_byte = tag_value & 0x7F
        result.append(last_byte)

        return bytes(result)

    @staticmethod
    def encode_length(length):
        if length < 129:
            return bytes([length])

        byte_count = TLVEncoder.calculate_length_byte_count(length)
        result = 0
        for i in range(byte_count):
            shift_bits = i * 7
            byte_val = (length >> shift_bits) & 0x7F
            if i < byte_count - 1:
                byte_val |= 0x80
            result = (result << 8) | byte_val

        return result.to_bytes(byte_count, 'big')

    @staticmethod
    def calculate_length_byte_count(value):
        if value == 0:
            return 1
        return (value.bit_length() + 6) // 7

class TLVDecoder:
    @staticmethod
    def decode_tlv(data):
        if not data:
            return None

        try:
            header_length = TLVDecoder.get_header_length(data)
            if header_length > len(data):
                return None
            header_data = data[:header_length]

            length_field_start = header_length
            length_field_length = TLVDecoder.get_length_field_length(data[header_length:], 0)
            if header_length + length_field_length > len(data):
                return None
            length_field_data = data[header_length:header_length + length_field_length]

            value_length = TLVDecoder.decode_length_field(length_field_data)

            if header_length + length_field_length + value_length > len(data):
                value_length = len(data) - header_length - length_field_length

            value_start = header_length + length_field_length
            value_end = value_start + value_length
            value_data = data[value_start:value_end]

            return {
                'frame_type': TLVDecoder.extract_frame_type(header_data),
                'data_type': TLVDecoder.extract_data_type(header_data),
                'tag_value': TLVDecoder.extract_tag_value(header_data),
                'length': value_length,
                'value': value_data
            }

        except Exception as e:
            print(f"[ERROR] TLV解码失败: {e}")
            return None

    @staticmethod
    def decode_length_field(data):
        if data[0] & 0x80 == 0:
            return data[0]

        result = 0
        for byte_val in data:
            result = (result << 7) | (byte_val & 0x7F)
        return result

    @staticmethod
    def get_header_length(data):
        for i in range(len(data)):
            if data[i] & 0x80 == 0:
                return i + 1
        return len(data)

    @staticmethod
    def get_length_field_length(data, start_index):
        for i in range(start_index, len(data)):
            if data[i] & 0x80 == 0:
                return i - start_index + 1
        return len(data) - start_index

    @staticmethod
    def extract_frame_type(header_data):
        return header_data[0] & 0xC0

    @staticmethod
    def extract_data_type(header_data):
        return header_data[0] & 0x20

    @staticmethod
    def extract_tag_value(header_data):
        if header_data[0] & 0x80 == 0:
            return header_data[0] & 0x1F

        result = 0
        for i in range(1, len(header_data)):
            result = (result << 7) | (header_data[i] & 0x7F)
        return result

class MessageDataBuilder:
    def __init__(self, bind_number, watchid, chipid, imfriendid, imaccountid, content, icon_data):
        self.bind_number = bind_number
        self.watchid = watchid
        self.chipid = chipid
        self.imfriendid = imfriendid
        self.imaccountid = imaccountid
        self.content = content
        self.icon_data = icon_data
        self.request_id_counter = 1000

    def build_register_request(self):
        request_data = {
            'commandValue': 1,
            'RID': 1002,
            'platform': 8,
            'appKey': "3b0ff2264f2240b4a4e866c7cb277ec9",
            'pkgName': "0",
            'deviceId': self.bind_number,
            'sdkVersion': 0,
            'sysName': "0",
            'sysVersion': "0",
            'imei': "",
            'imsi': "0",
            'mac': "0",
            'modelNumber': "",
            'basebandVersion': "0",
            'buildNumber': "0",
            'resolution': ""
        }
        return request_data

    def build_login_request(self, register_id, register_token):
        request_data = {
            'commandValue': 3,
            'RID': 1003,
            'registId': register_id,
            'registToken': register_token,
            'sdkVersion': 0,
            'imSdkVersionName': "0",
            'platform': 8,
            'baseRequestParam': json.dumps({
                "accountId": self.watchid,
                "appId": "2",
                "deviceId": self.bind_number,
                "imFlag": "1",
                "program": "watch",
                "registId": register_id,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
                "token": self.chipid
            }),
            'eebbkKey': "0",
            'timestamp': int(time.time() * 1000)
        }
        return request_data

    def build_message_request(self, register_id):
        message_data = {
            'content': f"{self.content}\nBy ZxeBot&难安❤️",
            'text': self.content,
            'msgNewContent': '',
            'textMsgType': 0,
            'msgNewType': 0,
            'watchId': self.watchid,
            'timestamp': int(time.time() * 1000)
        }

        message_bytes = self.encode_message(message_data)

        return {
            'commandValue': 40,
            'RID': self.get_next_request_id(),
            'needResponse': 1,
            'receiverId': self.imfriendid,
            'accountId': self.imaccountid,
            'registId': register_id,
            'msgType': 1,
            'message': message_bytes,
            'msgId': str(uuid.uuid4()).replace('-', ''),
            'contentType': 3
        }

    def get_next_request_id(self):
        self.request_id_counter += 1
        return self.request_id_counter

    def encode_message(self, message_data):
        return json.dumps(message_data, ensure_ascii=False).encode('utf-8')

class MessageFieldMapper:
    def __init__(self, message_type="regist"):
        self.message_type = message_type
        self.register_fields = {
            'RID': 1,
            'platform': 10,
            'appKey': 11,
            'pkgName': 12,
            'deviceId': 13,
            'sdkVersion': 14,
            'sysName': 15,
            'sysVersion': 16,
            'imei': 17,
            'imsi': 18,
            'mac': 19,
            'modelNumber': 20,
            'basebandVersion': 21,
            'buildNumber': 22,
            'resolution': 23
        }
        self.login_fields = {
            'RID': 1,
            'platform': 20,
            'registId': 10,
            'registToken': 11,
            'sdkVersion': 12,
            'imSdkVersionName': 18,
            'apnsToken': 16,
            'apnsType': 15,
            'deviceToken': 17,
            'pushType': 19,
            'timestamp': 21,
            'baseRequestParam': 24,
            'eebbkKey': 25
        }

        self.message_fields = {
            'RID': 1,
            'needResponse': 2,
            'receiverId': 10,
            'accountId': 11,
            'registId': 12,
            'msgType': 13,
            'message': 14,
            'msgId': 15,
            'contentType': 16
        }

    def build_request_data(self, request_params):
        command_value = request_params['commandValue']
        result_data = b''

        if self.message_type == "regist":
            field_map = self.register_fields
        elif self.message_type == "login":
            field_map = self.login_fields
        else:
            field_map = self.message_fields

        for key, value in request_params.items():
            if key == 'commandValue':
                continue

            field_id = field_map.get(key)
            if field_id is None:
                continue

            encoded_value = self.encode_field_value(value)
            result_data += TLVEncoder.encode_tlv(TLVEncoder.TAG_TYPE, TLVEncoder.FRAME_TYPE, field_id, encoded_value)

        return TLVEncoder.encode_tlv(TLVEncoder.TAG_TYPE, TLVEncoder.DATA_TYPE, command_value, result_data)

    def decode_response(self, response_data):
        return TLVDecoder.decode_tlv(response_data)

    def encode_field_value(self, value):
        if isinstance(value, int):
            return IntegerUtils.pack_integer(value)
        elif isinstance(value, str):
            return value.encode('utf-8')
        elif isinstance(value, bytes):
            return value
        else:
            return str(value).encode('utf-8')

class IMClient:
    def __init__(self, host="gw.im.okii.com", port=8000):
        self.host = host
        self.port = port
        self.socket = None
        self.register_id = None
        self.register_token = None
        self.register_mapper = MessageFieldMapper("regist")
        self.login_mapper = MessageFieldMapper("login")
        self.message_mapper = MessageFieldMapper("message")

    def connect(self):
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.settimeout(10)
            self.socket.connect((self.host, self.port))
            return True
        except Exception as e:
            print(f"[IMClient] Connection failed: {str(e)}")
            return False

    def disconnect(self):
        if self.socket:
            self.socket.close()
            self.socket = None

    def register(self, bind_number, watchid, chipid):
        if not self.socket:
            print("[IMClient] Not connected to server")
            return False

        data_builder = MessageDataBuilder(bind_number, watchid, chipid, None, None, None, None)
        register_request = data_builder.build_register_request()
        register_data = self.register_mapper.build_request_data(register_request)
        try:
            self.socket.sendall(register_data)
        except Exception as e:
            return False
        try:
            response_data = self.receive_response()
            if not response_data:
                print("[IMClient] No response received")
                return False
        except Exception as e:
            return False

        decoded_response = self.register_mapper.decode_response(response_data)

        if decoded_response['tag_value'] != 2:
            return False

        try:
            response_value = decoded_response['value']
            field_map = self.parse_field_map(response_value)

            if 10 in field_map:
                self.register_id = IntegerUtils.unpack_integer(field_map[10])

            if 11 in field_map:
                try:
                    self.register_token = field_map[11].decode('utf-8')
                except UnicodeDecodeError:
                    self.register_token = field_map[11].hex()

            if 2 in field_map and IntegerUtils.unpack_integer(field_map[2]) == 200:
                return True
            else:
                return False

        except Exception as e:
            return False

    def login(self, bind_number, watchid, chipid):
        if not self.socket:
            return False

        if not self.register_id or not self.register_token:
            return False

        data_builder = MessageDataBuilder(bind_number, watchid, chipid, None, None, None, None)
        login_request = data_builder.build_login_request(self.register_id, self.register_token)
        login_data = self.login_mapper.build_request_data(login_request)

        try:
            self.socket.sendall(login_data)
        except Exception as e:
            return False

        try:
            response_data = self.receive_response()
            if not response_data:
                print("[IMClient] No response received")
                return False
        except Exception as e:
            return False

        decoded_response = self.login_mapper.decode_response(response_data)

        if decoded_response['tag_value'] != 4:
            return False

        try:
            response_value = decoded_response['value']
            field_map = self.parse_field_map(response_value)

            if 2 in field_map and IntegerUtils.unpack_integer(field_map[2]) == 200:
                return True
            else:
                return False

        except Exception as e:
            return False

    def send_message(self, imfriendid, imaccountid, watchid, content, icon_data):
        if not self.socket:
            print("[IMClient] 未连接到服务器")
            return False

        if not self.register_id:
            return False

        data_builder = MessageDataBuilder(None, watchid, None, imfriendid, imaccountid, content, icon_data)
        message_request = data_builder.build_message_request(self.register_id)
        message_data = self.message_mapper.build_request_data(message_request)
        try:
            self.socket.sendall(message_data)
            return True
        except Exception as e:
            return False

    def parse_field_map(self, data):
        field_map = {}
        offset = 0

        while offset < len(data):
            header_length = TLVDecoder.get_header_length(data[offset:])
            header_data = data[offset:offset + header_length]
            tag_value = TLVDecoder.extract_tag_value(header_data)

            length_field_start = offset + header_length
            length_field_length = TLVDecoder.get_length_field_length(data[length_field_start:], 0)
            length_field_data = data[length_field_start:length_field_start + length_field_length]
            value_length = TLVDecoder.decode_length_field(length_field_data)

            value_start = length_field_start + length_field_length
            value_end = value_start + value_length
            value_data = data[value_start:value_end]

            field_map[tag_value] = value_data
            offset = value_end

        return field_map

    def receive_response(self):
        if not self.socket:
            return None

        first_byte = self.receive_data(1)
        if not first_byte:
            return None

        header_length = TLVDecoder.get_header_length(first_byte)
        if header_length > 1:
            remaining_header = self.receive_data(header_length - 1)
            if not remaining_header or len(remaining_header) != header_length - 1:
                return None
            first_byte += remaining_header

        length_byte = self.receive_data(1)
        if not length_byte:
            return None

        length_field_length = TLVDecoder.get_length_field_length(length_byte, 0)
        if length_field_length > 1:
            remaining_length = self.receive_data(length_field_length - 1)
            if not remaining_length or len(remaining_length) != length_field_length - 1:
                return None
            length_byte += remaining_length

        value_length = TLVDecoder.decode_length_field(length_byte)
        value_data = self.receive_data(value_length)
        if not value_data or len(value_data) != value_length:
            return None

        return first_byte + length_byte + value_data

    def receive_data(self, expected_length):
        if not self.socket or expected_length <= 0:
            return None

        result_data = bytearray()
        start_time = time.time()

        while len(result_data) < expected_length:
            if time.time() - start_time > 10:
                return None

            try:
                remaining_bytes = expected_length - len(result_data)
                received_data = self.socket.recv(remaining_bytes)
                if not received_data:
                    return None

                result_data.extend(received_data)
            except socket.timeout:
                return None
            except Exception as e:
                return None

        return bytes(result_data)

def send_im_message(bind_number, watchid, chipid, imfriendid, imaccountid, content):
    icon_data = 'Qk3KDAAAAAAAAIoAAAB8AAAAHAAAABwAAAABACAAAwAAAEAMAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAD/AAAAAAAA/wEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAA//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////7+/v/////////////////8+fr//Pn6//////////////////////////////////////////////////////////////////////////////////////////////////////////////////no7v/zyNX/997l//v3+f/vxs3/3n+O/+GTn//79vf////////////////////////////////////////////////////////////////////////////////////////////////////////////0z9X/66Gu//LK1v/ttMP/3X6O/9+Om//bcoL/+e/u//rv5//79O7//Pfz//rs4//8+PT//PXr//rv4f/58uj/+vPt//v29P/67uz/+/T2//jk6P/31+H/+Nvm//38/f//////////////////////+Onr/+eUnf/r0NH/9NHb//C7yf/gjJr/5qmz//rz7v/23c7/9tPB//bSw//449X/99y+//fct//238X/9s2x//bRwf/68vD/87m4//G6wf/vm6//8J+4/+6jwP/45u7////////////////////////////TpqH/q2NV//He3v/1097/6aO0//js7//78er/9tfF//bczv/0wbz/+e3k//bYsP/32bf/++/o//XGs//0vLP/+vPy//TK0P/wqLb/86/E/++Ss//tirT/99Tj///////////////////////w6ub/o21Z/8WHgP/LgHz/48/L//TN2f/43+f//Pf0//jh1f/57OP/+Ofe//ffxv/57Nr/+Ona//v18f/219T/9M3K//PP0v/xsr7/8Juz//O90f/xsMr/8rTP//z1+P//////////////////////yquf/6FoVP++l4r/nVZC/9OEhP/usr3/88PR//78/P////7///////////////7////////////////////////////57O//9tXc//ni6//1z9///v7+//7+/v///////////////////////////8yxpv+WVT7/q3hn/+PUz//23eD/8LvF//XY4P/+/f7////////////////////////////////////////////////////////////////////////////////////////////////////////////6+Pf/7eXi//n29f////////////7////+/v///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////w=='

    client = IMClient()
    
    if not client.connect():
        return False

    if not client.register(bind_number, watchid, chipid):
        client.disconnect()
        return False

    if not client.login(bind_number, watchid, chipid):
        client.disconnect()
        return False

    result = client.send_message(imfriendid, imaccountid, watchid, content, icon_data)
    
    client.disconnect()
    return result

# 使用示例:
# from im_patch import send_im_message
# send_im_message("akprrlzltxpbmdog", 
#                "e6e3b18f22cf488a9ab88b3d1202dad70781601a", 
#                "00000070000001002ac5652e00000005",
#                168655047,
#                293468949,
#                "测试消息内容")