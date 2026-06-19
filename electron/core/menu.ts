// electron/core/menu.ts - 应用菜单(文件/编辑/视图/帮助)
// 见 plan.md 5. electron/core/menu.ts
// UI 规范:无 emoji,lucide 图标(菜单用原生,不用 lucide)

import { Menu, app, shell, BrowserWindow } from 'electron';
import { APP_META } from '../../shared/types';

export function buildAppMenu(): Menu {
  const isDev = !app.isPackaged;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 iMooDesktop',
          click: () => showAboutDialog(),
        },
        ...(APP_META.authorWebsite
          ? [
              {
                label: '项目仓库',
                click: () => shell.openExternal(APP_META.authorWebsite),
              },
            ]
          : []),
        {
          label: '反馈 Bug',
          click: () => shell.openExternal(`mailto:${APP_META.authorEmail}`),
        },
        ...(isDev
          ? [
              { type: 'separator' as const },
              {
                label: '开发者:打开日志目录',
                click: () => {
                  const { paths } = require('./paths');
                  shell.openPath(paths.logs);
                },
              },
            ]
          : []),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function showAboutDialog(): void {
  const { dialog } = require('electron');
  dialog.showMessageBox(BrowserWindow.getFocusedWindow() ?? undefined!, {
    type: 'info',
    title: '关于 iMooDesktop',
    message: `iMooDesktop ${APP_META.version}`,
    detail: [
      APP_META.copyright,
      '',
      `作者:${APP_META.author}`,
      `QQ:${APP_META.authorQQ}`,
      ...(APP_META.authorQQGroup ? [`交流 QQ 群:${APP_META.authorQQGroup}`] : []),
      `邮箱:${APP_META.authorEmail}`,
      '',
      `基于 ${APP_META.basedOn}`,
      '',
      '本工具仅供学习交流,严禁用于商业用途与手表强制解绑。',
      '拾取他人手表请归还失主或联系 110。',
    ].join('\n'),
    buttons: ['确定'],
  });
}
