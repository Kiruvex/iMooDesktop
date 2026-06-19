// electron/core/config.ts - 应用配置持久化
// 使用 electron-store,对应原 settings/*.txt(见 plan.md settings 表)
// 临时文件(menutmp/smodel/isv3 等)改为内存变量,见 plan.md 2.5.5

import Store from 'electron-store';
import { AppSettings, DEFAULT_SETTINGS } from '../../shared/types';

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
});

class Config {
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return store.get(key);
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    store.set(key, value);
  }

  getAll(): AppSettings {
    return {
      windowOpacity: store.get('windowOpacity'),
      speedStart: store.get('speedStart'),
      checkUpdateTime: store.get('checkUpdateTime'),
      detailedLog: store.get('detailedLog'),
      infoEn: store.get('infoEn'),
      onUserDebug: store.get('onUserDebug'),
      showDisclaimerOnStart: store.get('showDisclaimerOnStart'),
    };
  }

  setAll(settings: Partial<AppSettings>): AppSettings {
    for (const [k, v] of Object.entries(settings)) {
      if (v !== undefined) {
        store.set(k as keyof AppSettings, v as never);
      }
    }
    return this.getAll();
  }

  reset(): AppSettings {
    store.clear();
    return this.getAll();
  }
}

export const config = new Config();
