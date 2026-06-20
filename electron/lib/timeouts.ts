// electron/lib/timeouts.ts - 统一超时常量
//
// 集中管理所有子进程调用的超时时间,避免魔法数字散落各处
// 按操作类型分级,语义清晰

/** 超时常量集(毫秒) */
export const TIMEOUT = {
  /** 设备检测/属性读取(adb devices / fastboot devices / lsusb / getprop) */
  device: 5000,

  /** 短 shell 命令(setprop / input tap / am start / pm path 等) */
  shell: 10000,

  /** 列目录 / 文件操作(ls / mkdir / rm / mv / cp) */
  fileOp: 15000,

  /** 一般 shell 命令(pm list / cmd package compile / chmod 等) */
  shellLong: 30000,

  /** 刷分区 / 重启(fh_loader --sendxml / QSaharaServer) */
  flash: 60000,

  /** APK 安装(adb install / pm install-create+write+commit) */
  install: 120000,

  /** 大文件传输(push/pull 大分区镜像) */
  transfer: 300000,

  /** 全盘备份/恢复(9008 全分区读写 + 7z 压缩) */
  backup: 600000,

  /** 等待开机完成(adb wait-for-device + boot_completed 轮询) */
  bootComplete: 120000,
} as const;

/** 超时类型(用于文档/日志) */
export type TimeoutKey = keyof typeof TIMEOUT;
