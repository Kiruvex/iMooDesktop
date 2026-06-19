# iMooDesktop

XTC 电话手表工具箱 —— 基于 AllToolBox 1.3.8fix1 的现代化重构。

## 技术栈

- Electron + Vite + React + TypeScript
- Tailwind CSS + lucide-react (SVG 图标)
- Zustand + TanStack Query

## 开发

```bash
bun install
bun run dev
```

## 构建

```bash
bun run electron:build
```

产出在 `release/` 目录(NSIS 安装包 + 便携版)。

## CI

推送到 `v*` tag 时自动触发 GitHub Actions 构建 Windows 安装包。

## 许可证

GPL-3.0

## 免责声明

本工具仅供学习交流,严禁用于商业用途与手表强制解绑。详见 [EULA](resources/data/EULA.txt)。
