/**
 * useDevice - 设备状态 Hook
 *
 * 从 getConfig 加载初始设备，并监听 device_changed 信号自动更新。
 * 任何页面调用此 hook 都能拿到最新的 device 状态。
 *
 * 模块级 cache：避免 hook 被多个页面同时调用时重复请求 getConfig
 * （App.tsx 已经会调用一次 getConfig，各页面再用此 hook 时直接复用缓存）
 */

import { useState, useEffect } from 'preact/hooks';
import { getConfig, onDeviceChanged } from './pyapi';
import type { DeviceInfo } from './pyapi';

// undefined = 未加载；null = 已加载但无设备；DeviceInfo = 已加载且有设备
let deviceCache: DeviceInfo | null | undefined = undefined;
// 让多个 hook 实例共享同一个 getConfig Promise，避免重复请求
let deviceLoadPromise: Promise<DeviceInfo | null> | null = null;

function loadDeviceOnce(): Promise<DeviceInfo | null> {
  if (deviceCache !== undefined) return Promise.resolve(deviceCache);
  if (deviceLoadPromise) return deviceLoadPromise;
  deviceLoadPromise = getConfig()
    .then((cfg) => {
      deviceCache = cfg.device;
      return cfg.device;
    })
    .catch((e) => {
      console.warn('[useDevice] init failed', e);
      // 失败时重置 cache 和 promise，允许后续重试
      deviceCache = null;
      deviceLoadPromise = null;
      return null;
    });
  return deviceLoadPromise;
}

export function useDevice(): DeviceInfo | null {
  const [device, setDevice] = useState<DeviceInfo | null>(deviceCache ?? null);

  useEffect(() => {
    let mounted = true;
    loadDeviceOnce().then((d) => {
      if (mounted && d !== device) setDevice(d);
    });
    // device_changed 信号到达时同步刷新缓存
    const unsub = onDeviceChanged((d) => {
      deviceCache = d;
      if (mounted) setDevice(d);
    });
    return () => {
      mounted = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return device;
}
