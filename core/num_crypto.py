import os
import random
import ctypes

def pad_start(s: str, num: int, ch: str) -> str:
    return s.zfill(num)

def encrypt_adb_old(s: str) -> str:
    i = int(s[0:2])
    i2 = int(s[2:4])
    i3 = int(s[4:6])
    i4 = int(s[6:8])
    i5 = int(s[8:])

    i6 = i4 ^ i3
    i7 = i5 ^ i3
    i8 = i3 ^ (i6 + i7)
    i9 = i ^ i7
    i10 = i2 ^ i7
    
    return (
        pad_start(str(i9), 2, '0') +
        pad_start(str(i10), 2, '0') +
        pad_start(str(i6), 2, '0') +
        pad_start(str(i7), 2, '0') +
        pad_start(str(i8), 2, '0')
    )

def decrypt_adb_old(s: str) -> str:
    i = int(s[0:2])
    i2 = int(s[2:4])
    i3 = int(s[4:6])
    i4 = int(s[6:8])
    i5 = int(s[8:])

    i6 = i5 ^ (i3 + i4)
    i7 = i4 ^ i6
    i8 = i3 ^ i6
    i9 = i ^ i6
    i10 = i2 ^ i6
    
    return (
        pad_start(str(i9), 2, '0') +
        pad_start(str(i10), 2, '0') +
        pad_start(str(i8), 2, '0') +
        pad_start(str(i7), 2, '0') +
        pad_start(str(i6), 2, '0')
    )

def encrypt_self_check_old(s: str) -> str:
    i = int(s[0:2])
    i2 = int(s[2:4])
    i3 = int(s[4:])

    i5 = i3 ^ (i + i2)
    i6 = i ^ i5
    i4 = i2 ^ i5
    
    return (
        pad_start(str(i6), 2, '0') +
        pad_start(str(i4), 2, '0') +
        pad_start(str(i5), 2, '0')
    )

def decrypt_self_check_old(s: str) -> str:
    i = int(s[0:2])
    i2 = int(s[2:4])
    i3 = int(s[4:])

    i5 = i2 ^ i
    i6 = i3 ^ i
    i4 = i ^ (i5 + i6)
    
    return (
        pad_start(str(i5), 2, '0') +
        pad_start(str(i6), 2, '0') +
        pad_start(str(i4), 2, '0')
    )

class NewCode:
    @staticmethod
    def is_numeric(s: str) -> bool:
        return s.isdigit()

    @staticmethod
    def encode(s: str, type_: int) -> str:
        if not s or not NewCode.is_numeric(s) or len(s) != 7 or type_ not in (1, 2):
            return ""
        
        key_id = random.randint(0, 6)
        int_arr = [int(c) for c in s]
        key = int_arr[key_id]
        
        result = []
        for i in range(7):
            cur_key = key_id if i == key_id else key
            cur_int = int_arr[i]
            result.append(str((cur_int + cur_key) % 10))
            
        result.append(str(type_ ^ key_id))
        return "".join(result)

    @staticmethod
    def decode(s: str, type_: int) -> str:
        if not s or not NewCode.is_numeric(s) or len(s) != 8 or type_ not in (1, 2):
            return ""
            
        int_arr = [int(c) for c in s]
        key = int_arr[7] ^ type_
        v7 = (int_arr[key] - key + 10) % 10
        
        result = []
        for i in range(7):
            if i == key:
                result.append(str(v7))
            else:
                cur_int = int_arr[i]
                result.append(str((cur_int + 10 - v7) % 10))
                
        return "".join(result)

def encrypt_adb_new(s: str) -> str:
    return NewCode.encode(NewCode.decode(s, 2), 2)

def encrypt_self_check_new(s: str) -> str:
    return NewCode.encode(NewCode.decode(s, 1), 1)

def process_adb_old(device_code: str) -> str:
    return encrypt_adb_old(decrypt_adb_old(device_code))

def process_self_check_old(device_code: str) -> str:
    return encrypt_self_check_old(decrypt_self_check_old(device_code))

def process_adb_new(device_code: str) -> str:
    return encrypt_adb_new(device_code)

def process_self_check_new(device_code: str) -> str:
    return encrypt_self_check_new(device_code)