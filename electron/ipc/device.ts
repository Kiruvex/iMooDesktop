// electron/ipc/device.ts - device:* 通道

import { ipcMain } from 'electron';
import { DeviceService } from '../services/DeviceService';
import { DeviceType } from '../../shared/types';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerDeviceIpc(): void {
  // 当前设备状态
  ipcMain.handle('device:current', () => {
    return DeviceService.instance.current();
  });

  // 等待任一类型设备
  ipcMain.handle(
    'device:wait',
    (_evt, { types, timeout }: { types: DeviceType[]; timeout?: number }) => {
      return DeviceService.instance.waitFor(types, timeout);
    },
  );

  logger.info('ipc', 'device:* 通道已注册');
}
