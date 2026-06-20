// electron/ipc/root.ts - root:* 通道
// 见 plan.md 8.1 通道命名规范 + 6.7 RootService
//
// Root 全流程相关通道:
//   - root:start    → RootService.start(options) → { taskId }
//   - root:cancel   → RootService.cancel(taskId)
//   - root:pause    → RootService.pause(taskId)
//   - root:resume   → RootService.resume(taskId)
//   - root:get-context → RootService.getContext(taskId)
//
// 事件(主进程 → 渲染进程):
//   - root:stage-change → 推送 RootContext(每次 stage 变化时)
//
// 重构:用 wrap 高阶函数消除重复 try-catch

import { ipcMain } from 'electron';
import { RootService, type RootOptions, type RootContext } from '../services/RootService';
import { Logger } from '../services/Logger';
import { wrap } from '../lib/ipcHelper';

const logger = Logger.instance;

export function registerRootIpc(): void {
  // 启动 Root 流程
  ipcMain.handle(
    'root:start',
    wrap((options: RootOptions) =>
      RootService.start(options).then((taskId) => ({ success: true, taskId })),
    { logPrefix: 'root' }),
  );

  // 取消(尝试恢复 DCIM,不回滚已刷的分区)
  ipcMain.handle(
    'root:cancel',
    wrap(({ taskId }: { taskId: string }) =>
      RootService.cancel(taskId).then(() => ({ success: true })),
    { logPrefix: 'root' }),
  );

  // 暂停(在下一个状态边界停下)
  ipcMain.handle(
    'root:pause',
    wrap(({ taskId }: { taskId: string }) =>
      RootService.pause(taskId).then(() => ({ success: true })),
    { logPrefix: 'root' }),
  );

  // 恢复
  ipcMain.handle(
    'root:resume',
    wrap(({ taskId }: { taskId: string }) =>
      RootService.resume(taskId).then(() => ({ success: true })),
    { logPrefix: 'root' }),
  );

  // 获取当前 context
  ipcMain.handle(
    'root:get-context',
    wrap(({ taskId }: { taskId: string }) => {
      const ctx = RootService.getContext(taskId);
      if (!ctx) {
        return { success: false, error: `任务不存在: ${taskId}` };
      }
      return { success: true, context: ctx as RootContext };
    }, { logPrefix: 'root' }),
  );

  logger.info('ipc', 'root:* 通道已注册');
}
