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

import { ipcMain } from 'electron';
import { RootService, type RootOptions, type RootContext } from '../services/RootService';
import { Logger } from '../services/Logger';

const logger = Logger.instance;

export function registerRootIpc(): void {
  // 启动 Root 流程
  ipcMain.handle(
    'root:start',
    async (_evt, options: RootOptions): Promise<{ success: boolean; taskId?: string; error?: string }> => {
      try {
        const taskId = await RootService.start(options);
        return { success: true, taskId };
      } catch (e) {
        logger.error('root', `启动 Root 失败: ${(e as Error).message}`);
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 取消(尝试恢复 DCIM,不回滚已刷的分区)
  ipcMain.handle(
    'root:cancel',
    async (_evt, { taskId }: { taskId: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        await RootService.cancel(taskId);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 暂停(在下一个状态边界停下)
  ipcMain.handle(
    'root:pause',
    async (_evt, { taskId }: { taskId: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        await RootService.pause(taskId);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 恢复
  ipcMain.handle(
    'root:resume',
    async (_evt, { taskId }: { taskId: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        await RootService.resume(taskId);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  // 获取当前 context
  ipcMain.handle(
    'root:get-context',
    async (_evt, { taskId }: { taskId: string }): Promise<{ success: boolean; context?: RootContext; error?: string }> => {
      try {
        const ctx = RootService.getContext(taskId);
        if (!ctx) {
          return { success: false, error: `任务不存在: ${taskId}` };
        }
        return { success: true, context: ctx };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  );

  logger.info('ipc', 'root:* 通道已注册');
}
