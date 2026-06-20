// electron/lib/ipcHelper.ts - IPC handler 高阶工具
//
// 解决问题:
//   - 每个 IPC 文件重复定义 requireAdb()
//   - 每个 handler 重复 try-catch + 错误返回 { success: false, error }
//   - 错误返回结构有时带额外字段(steps/results/props 等)
//
// 用法:
//   ipcMain.handle('app:list', wrap(
//     (args: { thirdParty?: boolean }) => AdbService.listPackages(args.thirdParty),
//     { requireDevice: 'adb' }
//   ));

import type { IpcMainInvokeEvent } from 'electron';
import { DeviceService } from '../services/DeviceService';
import { Logger } from '../services/Logger';
import type { DeviceType } from '../../shared/types';

const logger = Logger.instance;

/** 设备类型中文名(错误提示用) */
const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  adb: 'ADB',
  fastboot: 'Fastboot',
  qcom_edl: '9008 (EDL)',
  sprd_edl: '展锐 EDL',
  emulator: '模拟器',
  unauthorized: '已授权',
  offline: '离线',
};

/** wrapHandler 选项 */
export interface WrapOptions {
  /** 要求的设备类型,不满足时返回 { success: false, error } */
  requireDevice?: DeviceType;
  /** 错误时附加到返回对象的字段(如 { steps: [] } / { results: [] } / { props: [] }) */
  errorExtra?: Record<string, unknown>;
  /** 日志前缀(默认用 handler 名) */
  logPrefix?: string;
}

/**
 * 包装 IPC handler:自动设备检查 + try-catch + 统一错误返回
 *
 * @param handler 业务逻辑函数,接收 (args, evt),返回任意结果
 * @param opts 选项
 * @returns 包装后的 ipcMain.handle 回调
 *
 * 返回约定:
 *   - 成功:返回 handler 的返回值(原样透传)
 *   - 设备不满足:返回 { success: false, error: '需要 XXX 设备', ...errorExtra }
 *   - 异常:返回 { success: false, error: e.message, ...errorExtra }
 */
export function wrap<TArgs>(
  handler: (args: TArgs, evt: IpcMainInvokeEvent) => Promise<unknown> | unknown,
  opts: WrapOptions = {},
): (evt: IpcMainInvokeEvent, args: TArgs) => Promise<unknown> {
  const { requireDevice, errorExtra = {}, logPrefix } = opts;

  return async (evt: IpcMainInvokeEvent, args: TArgs): Promise<unknown> => {
    // 设备类型检查
    if (requireDevice) {
      const device = DeviceService.instance.current();
      if (device?.type !== requireDevice) {
        const label = DEVICE_TYPE_LABEL[requireDevice] ?? requireDevice;
        return { success: false, error: `需要 ${label} 设备`, ...errorExtra };
      }
    }
    // try-catch
    try {
      return await handler(args, evt);
    } catch (e) {
      const msg = (e as Error).message;
      const prefix = logPrefix ?? 'IPC';
      logger.error(prefix, `操作失败: ${msg}`);
      return { success: false, error: msg, ...errorExtra };
    }
  };
}

/**
 * 无参数版本的 wrap(handler 不接收 args)
 * 用于 ipcMain.handle('xxx', wrapNoArgs(() => ...))
 */
export function wrapNoArgs(
  handler: () => Promise<unknown> | unknown,
  opts: WrapOptions = {},
): (evt: IpcMainInvokeEvent) => Promise<unknown> {
  const wrapped = wrap<undefined>(handler, opts);
  return (evt: IpcMainInvokeEvent) => wrapped(evt, undefined);
}
