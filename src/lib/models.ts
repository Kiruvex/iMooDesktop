// src/lib/models.ts - 型号与 innermodel 对照表
// 从原 innermodel.bat 转换(逻辑保真:对照表内容与原项目一致)
// 用于 Reboot/Sidebar 等需要选型号的地方

export interface ModelInfo {
  /** innermodel(内部型号,如 I25) */
  innermodel: string;
  /** 用户可见型号名(如 Z7) */
  model: string;
  /** 系列 */
  series: 'Z' | 'D' | 'Q' | 'N' | 'U' | 'Y';
  /** 平台(用于 misc 刷入) */
  platform: 'otherpash' | 'v3pash' | 'z10';
}

// 对应原 innermodel.bat 的 Z 系列 + rebootpro.bat 的型号选择菜单
// platform 分类:
//   otherpash:MSM8909W 系(老机型,Z2-Z6)
//   v3pash:MSM8937 系(Z6巅峰-Z9)
//   z10:aarch64 系(Z10/Z11)
export const MODELS: ModelInfo[] = [
  // Z 系列(otherpash)
  { innermodel: 'I12', model: 'Z2', series: 'Z', platform: 'otherpash' },
  { innermodel: 'IB', model: 'Z3', series: 'Z', platform: 'otherpash' },
  { innermodel: 'I13C', model: 'Z5A', series: 'Z', platform: 'otherpash' },
  { innermodel: 'I13', model: 'Z5/Z5Q', series: 'Z', platform: 'otherpash' },
  { innermodel: 'I19', model: 'Z5Pro', series: 'Z', platform: 'otherpash' },
  { innermodel: 'I18', model: 'Z6', series: 'Z', platform: 'otherpash' },
  // Z 系列(v3pash)
  { innermodel: 'I20', model: 'Z6巅峰版', series: 'Z', platform: 'v3pash' },
  { innermodel: 'I25', model: 'Z7', series: 'Z', platform: 'v3pash' },
  { innermodel: 'I25C', model: 'Z7A', series: 'Z', platform: 'v3pash' },
  { innermodel: 'I25D', model: 'Z7S', series: 'Z', platform: 'v3pash' },
  { innermodel: 'I32', model: 'Z8', series: 'Z', platform: 'v3pash' },
  { innermodel: 'ND07', model: 'Z8A', series: 'Z', platform: 'v3pash' },
  { innermodel: 'ND01', model: 'Z9', series: 'Z', platform: 'v3pash' },
  // Z 系列(z10)
  { innermodel: 'ND03', model: 'Z10', series: 'Z', platform: 'z10' },
  { innermodel: 'ND08', model: 'Z11', series: 'Z', platform: 'z10' },
];

/** fastbootd 模式支持的型号(仅 Z10/Z11,对应 rebootpro.bat:255-266 A11.json) */
export const FASTBOOTD_MODELS: ModelInfo[] = MODELS.filter((m) => m.platform === 'z10');

/** twrp-temp / qmmi / ffbm / wipe-data 支持的型号(对应 rebootpro.bat rebtwrp.json/qmmi.json) */
export const ALL_MODELS: ModelInfo[] = MODELS;

/** 按 innermodel 查找 */
export function findByInnermodel(innermodel: string): ModelInfo | undefined {
  return MODELS.find((m) => m.innermodel === innermodel);
}
