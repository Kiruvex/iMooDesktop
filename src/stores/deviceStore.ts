// src/stores/deviceStore.ts - 设备状态(Zustand)
// 见 plan.md 9.2 状态分层

import { create } from 'zustand';
import type { DeviceInfo } from '../../shared/types';

interface DeviceStore {
  current: DeviceInfo | null;
  loading: boolean;
  error: string | null;
  setCurrent: (info: DeviceInfo | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  current: null,
  loading: false,
  error: null,
  setCurrent: (info) => set({ current: info, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
