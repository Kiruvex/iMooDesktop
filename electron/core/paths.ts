// electron/core/paths.ts - 资源路径解析
// dev 模式:从源码 resources/ 读取
// prod 模式:从打包后的 resources/ 读取
//   - asar 内文件(fs 可读):data/ assets/ 等
//   - asarUnpack 文件(spawn 需要):bin/ edl/ scripts/
//   - asarUnpack 的文件需要把 .asar 替换为 .asar.unpacked

import { app } from 'electron';
import path from 'node:path';

/**
 * 把 asar 路径替换为 asar.unpacked 路径
 * 打包后 app.getAppPath() 返回 .../app.asar
 * asarUnpack 的文件实际在 .../app.asar.unpacked
 * child_process.spawn 需要真实文件系统路径,不能用 asar 虚拟路径
 */
function fixAsarPath(p: string): string {
  if (app.isPackaged && p.includes('.asar')) {
    return p.replace('.asar', '.asar.unpacked');
  }
  return p;
}

class Paths {
  /** 应用根目录(dev:项目根,prod:app.getAppPath()) */
  get appRoot(): string {
    if (app.isPackaged) {
      return app.getAppPath();
    }
    return path.resolve(__dirname, '..');
  }

  /** resources/ 目录(包含 bin/edl/scripts/data/assets) */
  get resources(): string {
    return path.join(this.appRoot, 'resources');
  }

  /** resources/bin/ - 所有 .exe + DLL(asarUnpack,spawn 需要) */
  get bin(): string {
    return fixAsarPath(path.join(this.resources, 'bin'));
  }

  /** resources/edl/ - EDL 资源(asarUnpack) */
  get edl(): string {
    return fixAsarPath(path.join(this.resources, 'edl'));
  }

  /** resources/edl/allxml/ - 分区表(asarUnpack) */
  get edlAllxml(): string {
    return fixAsarPath(path.join(this.resources, 'edl', 'allxml'));
  }

  /** resources/edl/misc/ - misc xml + img(asarUnpack) */
  get edlMisc(): string {
    return fixAsarPath(path.join(this.resources, 'edl', 'misc'));
  }

  /** resources/edl/work/ - 临时工作目录(运行时创建,不在 asar 内) */
  get edlWork(): string {
    // work/ 是运行时创建的临时目录,用 userData 下的路径
    return path.join(this.userData, 'edl_work');
  }

  /** resources/edl/eboot.img - 33MB 全零(asarUnpack) */
  get edlEboot(): string {
    return fixAsarPath(path.join(this.resources, 'edl', 'eboot.img'));
  }

  /** resources/cache/ - 下载的资源缓存(运行时创建,不在 asar 内) */
  get cache(): string {
    return path.join(this.userData, 'cache');
  }

  /** resources/scripts/ - push 到设备的 .sh(asarUnpack) */
  get scripts(): string {
    return fixAsarPath(path.join(this.resources, 'scripts'));
  }

  /** resources/data/ - 数据文件(asar 内,fs 可读) */
  get data(): string {
    return path.join(this.resources, 'data');
  }

  /** resources/assets/ - 应用自身资源(asar 内,fs 可读) */
  get assets(): string {
    return path.join(this.resources, 'assets');
  }

  /** 应用图标路径 */
  get icon(): string {
    return path.join(this.assets, 'icon.png');
  }

  /** 拼接 bin/ 下的文件路径(asarUnpack) */
  binFile(name: string): string {
    return path.join(this.bin, name);
  }

  /** 拼接 edl/ 下的文件路径(asarUnpack) */
  edlFile(name: string): string {
    return path.join(this.edl, name);
  }

  /** 拼接 edl/misc/ 下的文件路径(asarUnpack) */
  edlMiscFile(name: string): string {
    return path.join(this.edlMisc, name);
  }

  /** 拼接 edl/allxml/ 下的文件路径(asarUnpack) */
  edlAllxmlFile(name: string): string {
    return path.join(this.edlAllxml, name);
  }

  /** 拼接 scripts/ 下的文件路径(asarUnpack) */
  scriptFile(name: string): string {
    return path.join(this.scripts, name);
  }

  /** 拼接 data/ 下的文件路径(asar 内,fs 可读) */
  dataFile(name: string): string {
    return path.join(this.data, name);
  }

  /** 用户数据目录(%APPDATA%/iMooDesktop) */
  get userData(): string {
    return app.getPath('userData');
  }

  /** 日志目录(%APPDATA%/iMooDesktop/logs) */
  get logs(): string {
    return path.join(this.userData, 'logs');
  }

  /** 是否处于开发模式 */
  get isDev(): boolean {
    return !app.isPackaged;
  }
}

export const paths = new Paths();
