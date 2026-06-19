// electron/ipc/index.ts - 注册所有 IPC handler
// 见 plan.md 8.1 通道命名规范

import { registerSystemIpc } from './system';
import { registerDeviceIpc } from './device';
import { registerLogIpc } from './log';
import { registerRebootIpc } from './reboot';
import { registerCloudIpc } from './cloud';
import { registerScrcpyIpc } from './scrcpy';
import { registerAppIpc } from './app';
import { registerToolsIpc } from './tools';
import { registerMagiskIpc } from './magisk';
import { registerBackupIpc } from './backup';
import { registerRootIpc } from './root';
import { registerFileIpc } from './file';
import { registerEdlPartitionIpc } from './edlPartition';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerAllIpc(): void {
  registerSystemIpc();
  registerDeviceIpc();
  registerLogIpc();
  registerRebootIpc();
  registerCloudIpc();
  registerScrcpyIpc();
  registerAppIpc();
  registerToolsIpc();
  registerMagiskIpc();
  registerBackupIpc();
  registerRootIpc();
  registerFileIpc();
  registerEdlPartitionIpc();
  logger.info('ipc', '所有 IPC 通道已注册');
}
