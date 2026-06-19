// src/stores/settingsStore.ts - 用户设置(Zustand)
// 见 plan.md 9.2 状态分层

import { create } from 'zustand';
import type { AppSettings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { api } from '../lib/api';

interface SettingsStore extends AppSettings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (settings: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await api.system.getSettings();
    set({ ...settings, loaded: true });
  },
  update: async (settings) => {
    const updated = await api.system.setSettings(settings);
    set(updated);
  },
}));
