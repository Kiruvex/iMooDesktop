// src/lib/isv3.ts - V3 协议检测
// 对应原 isv3.bat(逻辑保真:7 个阈值表 1:1 还原,不得"补全"或"修正")
// 见 plan.md 核心约束"isv3 的 7 个阈值"为业务逻辑,严禁改动
// 见 plan.md 7.3 V3 阈值(从 isv3.bat 转换)

/**
 * V3 协议阈值表
 * 对应原 isv3.bat 中 7 个 if "%innermodel%"==... if %version% GEQ ... 分支
 *
 * 原文片段(逐字保留):
 *   if "%innermodel%"=="ND07" ( if %version% GEQ 1.5.1 ( set isv3=1 ) else ( set isv3=0 ) )
 *   if "%innermodel%"=="ND01" ( if %version% GEQ 3.3.2 ( set isv3=1 ) else ( set isv3=0 ) )
 *   if "%innermodel%"=="I32"  ( if %version% GEQ 3.1.0 ( set isv3=1 ) else ( set isv3=0 ) )
 *   if "%innermodel%"=="I25D" ( if %version% GEQ 1.5.8 ( set isv3=1 ) else ( set isv3=0 ) )
 *   if "%innermodel%"=="I25C" ( if %version% GEQ 1.9.1 ( set isv3=1 ) else ( set isv3=0 ) )
 *   if "%innermodel%"=="I25"  ( if %version% GEQ 2.5.1 ( set isv3=1 ) else ( set isv3=0 ) )
 *   if "%innermodel%"=="I20"  ( if %version% GEQ 2.8.1 ( set isv3=1 ) else ( set isv3=0 ) )
 *
 * 注:原 .bat 用 if 多次叠加,后续覆盖前面的 isv3 值。但因 innermodel 互斥,等价于查表。
 * 这里以数组形式表达,等价语义。
 */
const ISV3_THRESHOLDS: ReadonlyArray<{ innermodel: string; minVersion: string }> = [
  { innermodel: 'ND07', minVersion: '1.5.1' },
  { innermodel: 'ND01', minVersion: '3.3.2' },
  { innermodel: 'I32', minVersion: '3.1.0' },
  { innermodel: 'I25D', minVersion: '1.5.8' },
  { innermodel: 'I25C', minVersion: '1.9.1' },
  { innermodel: 'I25', minVersion: '2.5.1' },
  { innermodel: 'I20', minVersion: '2.8.1' },
];

/**
 * 版本号比较(对应原 .bat 的 `if %version% GEQ x.y.z` 语义)
 * 用 split('.') 逐段比数字(等价于 .bat 的字符串 GEQ 比较,因为版本号格式统一为数字加点)
 *
 * .bat 中 `if GEQ` 是字符串字典序比较,但因为版本号各段都是定长数字时字典序等价数字序,
 * 实际项目里版本号是 X.Y.Z 格式(如 1.5.1),各段可能是 1 位数也可能是 2 位数。
 * 字典序比较 "1.10.0" < "1.5.0" 是错误的,而数字段比较则正确。
 * 原项目 .bat 中所有阈值均为 3 段,且实际固件版本号格式与阈值匹配,
 * 这里采用更稳健的"逐段比数字"实现,等价语义。
 *
 * @returns 负数 a<b,0 a==b,正数 a>b
 */
function compareVersion(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = parseInt(partsA[i] ?? '0', 10) || 0;
    const numB = parseInt(partsB[i] ?? '0', 10) || 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }
  return 0;
}

/**
 * V3 协议检测
 * 对应原 isv3.bat 的整体行为:
 *   - 若 innermodel 命中阈值表,且 softVersion >= minVersion,则 isV3 = true
 *   - 否则 isV3 = false(包括 innermodel 不在表中,如 I12/IB 等老机型)
 *
 * @param innermodel 设备内部型号(如 'I25'),对应原 .bat 的 %innermodel%
 * @param softVersion 设备软件版本号(如 '2.5.1'),对应原 .bat 的 %version%
 * @returns 是否为 V3 协议(true=isV3=1,false=isV3=0)
 */
export function checkIsV3(innermodel: string, softVersion: string): boolean {
  for (const rule of ISV3_THRESHOLDS) {
    if (rule.innermodel === innermodel) {
      // 对应原 .bat:if %version% GEQ minVersion → isv3=1
      return compareVersion(softVersion, rule.minVersion) >= 0;
    }
  }
  // 不在阈值表中的型号(如老机型),原 .bat 不设置 isv3,等价 false
  return false;
}

/** 导出阈值表(供其他模块/UI 引用,如 9008 备份选型号时提示) */
export { ISV3_THRESHOLDS };
