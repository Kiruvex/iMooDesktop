// src/hooks/useDevice.ts - 当前设备状态
// 见 plan.md 9.3 TanStack Query 用途 + useDevice

import { useEffect } from 'react';
import { api } from '../lib/api';
import { useDeviceStore } from '../stores/deviceStore';

export function useDevice(): void {
  const setCurrent = useDeviceStore((s) => s.setCurrent);

  useEffect(() => {
    // 初次获取
    api.device.current().then(setCurrent).catch(() => {
      // ignore
    });
    // 订阅变化
    const unsub = api.device.onChange((info) => {
      setCurrent(info);
    });
    return unsub;
  }, [setCurrent]);
}
