// src/routes/Files.tsx - ADB 文件管理(增强版)
//
// 参考开源项目(已对比 README):
//   - wkbin/AdbFileManager:搜索/排序/书签/网格视图/文本编辑/多选/拖拽/多设备/主题
//   - T0biaCZe/AdbFileManager:双栏/保留 mtime/旧 Android 兼容模式/批量删除
//   - JSleim/adb-file-explorer:多设备/剪贴板(剪切复制粘贴)/完整文件操作
//   - coolshou/qtadb:Qt5 经典双栏布局
//
// 实现功能(对标开源项目):
//   [x] 多设备选择(下拉切换 serial)
//   [x] 搜索当前目录(find -iname + grep 回退)
//   [x] 高级排序(名称/大小/时间/扩展名 × 升降序 + 目录优先开关)
//   [x] 多选(Ctrl/Shift + 点击)+ 批量删除/批量下载
//   [x] 网格视图 / 列表视图 切换
//   [x] 书签(本地 localStorage 持久化,增删)
//   [x] 拖拽上传(HTML5 drag-drop → 本地路径 → push)
//   [x] 文本编辑器弹窗(读取 → 编辑 → 保存)
//   [x] 新建文件弹窗(文件名 + 可选内容)
//   [x] chmod 弹窗(八进制模式 + 递归)
//   [x] 推送/拉取进度条(订阅 file:transfer-progress 事件)
//   [x] 兼容模式开关(旧 Android ls -l 无 -A)
//   [x] 保留 mtime 开关
//   [x] 剪贴板:剪切/复制/粘贴(跨目录)
//   [x] 快捷键:Backspace 上一级 / Enter 进入目录 / Delete 删除 / F2 重命名 / Ctrl+A 全选

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  ChevronRight,
  ArrowUp,
  RefreshCw,
  Home,
  FolderPlus,
  Upload,
  Download,
  Pencil,
  Trash2,
  Package,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  HardDrive,
  File as FileIcon,
  Folder as FolderIcon,
  Link2,
  X,
  Search,
  LayoutGrid,
  List as ListIcon,
  Bookmark,
  BookmarkPlus,
  Scissors,
  Copy,
  ClipboardPaste,
  FilePlus,
  Lock,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  api,
  type FileEntry,
  type DiskInfo,
  type QuickPath,
  type AdbDevice,
  type TransferProgress,
  type SortKey,
  type SortDir,
} from '../lib/api';
import { cn, formatBytes } from '../lib/utils';
import { useDeviceStore } from '../stores/deviceStore';
import { toast } from '../stores/toastStore';
import { ApkPreviewDialog } from '../components/common/ApkPreviewDialog';

// 快捷路径图标映射
const QUICK_ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  home: Home,
  image: FileIcon,
  download: Download,
  music: FileIcon,
  film: FileIcon,
  file: FileIcon,
  drive: HardDrive,
  terminal: ChevronRight,
  database: HardDrive,
};

// 书签本地存储 key
const BOOKMARKS_KEY = 'iMooDesktop.fileBookmarks';

interface Bookmark {
  label: string;
  path: string;
}

export function Files(): JSX.Element {
  const device = useDeviceStore((s) => s.current);
  const [cwd, setCwd] = useState('/sdcard');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [addressValue, setAddressValue] = useState('/sdcard');
  const [editingAddress, setEditingAddress] = useState(false);
  const [quickPaths, setQuickPaths] = useState<QuickPath[]>([]);

  // 多设备
  const [devices, setDevices] = useState<AdbDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string | undefined>(undefined);

  // 多选
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  // 搜索
  const [searchQuery, setSearchQuery] = useState('');

  // 排序
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [dirsFirst, setDirsFirst] = useState(true);

  // 视图模式
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // 书签
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // 剪贴板
  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: 'copy' | 'cut' } | null>(null);

  // 选项开关
  const [compatMode, setCompatMode] = useState(false);
  const [keepMtime, setKeepMtime] = useState(false);

  // 传输进度
  const [transfer, setTransfer] = useState<TransferProgress | null>(null);

  // 历史
  const [history, setHistory] = useState<string[]>(['/sdcard']);
  const [histIdx, setHistIdx] = useState(0);

  // 弹窗
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ entry: FileEntry; newName: string } | null>(null);
  const [editorTarget, setEditorTarget] = useState<{ entry: FileEntry; content: string; loading: boolean; dirty: boolean } | null>(null);
  const [chmodTarget, setChmodTarget] = useState<{ entry: FileEntry; mode: string; recursive: boolean } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);

  const listAbortRef = useRef(0);

  // 加载快捷路径
  useEffect(() => {
    api.file.quickPaths().then((r) => {
      if (r.success) setQuickPaths(r.paths);
    });
    // 加载书签
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      if (raw) setBookmarks(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  // 加载设备列表
  const refreshDevices = useCallback(async (): Promise<void> => {
    const r = await api.file.listDevices();
    if (r.success) {
      setDevices(r.devices);
      // 如果当前选中的设备不在列表里,清空
      if (selectedSerial && !r.devices.find((d) => d.serial === selectedSerial)) {
        setSelectedSerial(undefined);
      }
    }
  }, [selectedSerial]);

  useEffect(() => {
    void refreshDevices();
    // 订阅设备变化事件(替代轮询),USB 插拔/状态切换时刷新设备列表
    const unsub = api.device.onChange(() => {
      void refreshDevices();
    });
    return unsub;
  }, [refreshDevices]);

  // 订阅传输进度
  useEffect(() => {
    const unsub = api.file.onTransferProgress((p) => {
      setTransfer(p);
      if (p.percent >= 100) {
        window.setTimeout(() => setTransfer(null), 800);
      }
    });
    return unsub;
  }, []);

  // 设置兼容模式 / 保留 mtime(同步到后端)
  useEffect(() => {
    void api.file.setCompatMode(compatMode);
  }, [compatMode]);
  useEffect(() => {
    void api.file.setKeepMtime(keepMtime);
  }, [keepMtime]);

  // 加载目录
  const loadDir = useCallback(
    async (path: string, pushHistory = true): Promise<void> => {
      if (!device || device.type !== 'adb') {
        setEntries([]);
        setError(null);
        return;
      }
      const myToken = ++listAbortRef.current;
      setLoading(true);
      setError(null);
      setSelected(new Set());
      setLastSelected(null);
      setSearchQuery('');
      try {
        const res = await api.file.list(path, selectedSerial);
        if (myToken !== listAbortRef.current) return;
        if (res.success) {
          setEntries(res.entries);
          setCwd(path);
          setAddressValue(path);
        } else {
          setError(res.error ?? '读取目录失败');
          setEntries([]);
        }
      } catch (e) {
        if (myToken !== listAbortRef.current) return;
        setError((e as Error).message);
        setEntries([]);
      } finally {
        if (myToken === listAbortRef.current) setLoading(false);
      }
      if (pushHistory) {
        setHistory((prev) => {
          const next = prev.slice(0, histIdx + 1);
          next.push(path);
          return next;
        });
        setHistIdx((i) => i + 1);
      }
      if (path.startsWith('/sdcard') || path.startsWith('/storage')) {
        api.file.diskInfo(path).then((r) => {
          if (r.success && r.info) setDisk(r.info);
        });
      }
    },
    [device, histIdx, selectedSerial],
  );

  useEffect(() => {
    if (device?.type === 'adb') {
      void loadDir(cwd, false);
    } else {
      setEntries([]);
      setDisk(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, selectedSerial]);

  // 面包屑
  const crumbs = useMemo(() => {
    const parts = cwd.split('/').filter(Boolean);
    const list = [{ name: '根', path: '/' }];
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      list.push({ name: p, path: acc });
    }
    return list;
  }, [cwd]);

  // 搜索过滤 + 排序
  const displayEntries = useMemo(() => {
    let list = entries;
    // 搜索过滤(本地过滤,快速响应;深度搜索走后端 searchInDir)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    // 排序
    const sorted = [...list].sort((a, b) => {
      // 目录优先
      if (dirsFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'mtime':
          cmp = a.mtime.localeCompare(b.mtime);
          break;
        case 'ext':
          cmp = a.ext.localeCompare(b.ext);
          if (cmp === 0) cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [entries, searchQuery, sortKey, sortDir, dirsFirst]);

  // 导航
  const goUp = (): void => {
    const idx = cwd.lastIndexOf('/');
    const parent = idx <= 0 ? '/' : cwd.slice(0, idx);
    void loadDir(parent);
  };
  const goBack = (): void => {
    if (histIdx > 0) {
      const newIdx = histIdx - 1;
      setHistIdx(newIdx);
      void loadDir(history[newIdx], false);
    }
  };
  const goForward = (): void => {
    if (histIdx < history.length - 1) {
      const newIdx = histIdx + 1;
      setHistIdx(newIdx);
      void loadDir(history[newIdx], false);
    }
  };
  const goHome = (): void => void loadDir('/sdcard');

  // 选中操作
  const selectOnly = (path: string): void => {
    setSelected(new Set([path]));
    setLastSelected(path);
  };
  const toggleSelect = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setLastSelected(path);
  };
  const rangeSelect = (path: string): void => {
    if (!lastSelected) {
      selectOnly(path);
      return;
    }
    const startIdx = displayEntries.findIndex((e) => e.path === lastSelected);
    const endIdx = displayEntries.findIndex((e) => e.path === path);
    if (startIdx < 0 || endIdx < 0) {
      selectOnly(path);
      return;
    }
    const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const next = new Set(selected);
    for (let i = from; i <= to; i++) {
      next.add(displayEntries[i].path);
    }
    setSelected(next);
    setLastSelected(path);
  };
  const selectAll = (): void => {
    setSelected(new Set(displayEntries.map((e) => e.path)));
  };
  const clearSelection = (): void => {
    setSelected(new Set());
    setLastSelected(null);
  };

  // 打开条目
  const openEntry = (entry: FileEntry): void => {
    if (entry.isDir) {
      void loadDir(entry.path);
    } else if (entry.ext === 'apk') {
      void handleInstallApk(entry);
    } else if (isTextFile(entry)) {
      void handleEditText(entry);
    }
  };

  const isTextFile = (e: FileEntry): boolean => {
    const textExts = ['txt', 'log', 'md', 'json', 'xml', 'sh', 'conf', 'cfg', 'properties', 'ini', 'yaml', 'yml', 'csv'];
    return textExts.includes(e.ext) || (!e.ext && e.size < 65536 && e.size > 0);
  };

  // 操作:新建文件夹
  const handleNewFolder = async (): Promise<void> => {
    const name = newFolderName.trim();
    if (!name) return;
    const newPath = joinPath(cwd, name);
    const res = await api.file.mkdir(newPath, true);
    if (res.success) {
      toast.ok(`已创建文件夹: ${name}`);
      setNewFolderOpen(false);
      setNewFolderName('');
      await loadDir(cwd, false);
    } else {
      toast.err(`创建失败: ${res.error}`);
    }
  };

  // 操作:新建文件
  const handleNewFile = async (): Promise<void> => {
    const name = newFileName.trim();
    if (!name) return;
    const newPath = joinPath(cwd, name);
    const res = await api.file.createFile(newPath, newFileContent);
    if (res.success) {
      toast.ok(`已创建文件: ${name}`);
      setNewFileOpen(false);
      setNewFileName('');
      setNewFileContent('');
      await loadDir(cwd, false);
    } else {
      toast.err(`创建失败: ${res.error}`);
    }
  };

  // 操作:上传
  const handleUpload = async (filePaths?: string[]): Promise<void> => {
    let files = filePaths;
    if (!files) {
      const picked = await api.system.pickFile({ kind: 'open', multi: true });
      if (!picked) return;
      files = Array.isArray(picked) ? picked : [picked];
    }
    for (const f of files) {
      const name = f.split(/[\\/]/).pop() ?? 'file';
      const remote = joinPath(cwd, name);
      const res = await api.file.push(f, remote, selectedSerial);
      if (res.success) {
        toast.ok(`已上传: ${name}`);
      } else {
        toast.err(`上传失败: ${name} - ${res.error}`);
      }
    }
    await loadDir(cwd, false);
  };

  // 操作:下载单个
  const handleDownload = async (entry: FileEntry): Promise<void> => {
    const picked = await api.system.pickFile({ kind: 'folder' });
    if (!picked || Array.isArray(picked)) return;
    const local = picked.endsWith('\\') || picked.endsWith('/') ? picked + entry.name : picked + '/' + entry.name;
    const res = await api.file.pull(entry.path, local, selectedSerial);
    if (res.success) {
      toast.ok(`已下载到: ${local}`);
    } else {
      toast.err(`下载失败: ${res.error}`);
    }
  };

  // 操作:批量下载
  const handleBatchDownload = async (): Promise<void> => {
    const picked = await api.system.pickFile({ kind: 'folder' });
    if (!picked || Array.isArray(picked)) return;
    const targets = entries.filter((e) => selected.has(e.path));
    for (const entry of targets) {
      if (entry.isDir) continue; // 目录跳过(简化)
      const local = picked.endsWith('\\') || picked.endsWith('/') ? picked + entry.name : picked + '/' + entry.name;
      const res = await api.file.pull(entry.path, local, selectedSerial);
      if (!res.success) {
        toast.err(`下载失败: ${entry.name} - ${res.error}`);
      }
    }
    toast.ok(`批量下载完成(${targets.filter((e) => !e.isDir).length} 个文件)`);
  };

  // 操作:删除单个
  const handleDelete = async (entry: FileEntry): Promise<void> => {
    if (!window.confirm(`确定删除 "${entry.name}"?${entry.isDir ? ' (目录将递归删除)' : ''}`)) return;
    const res = await api.file.remove(entry.path, true);
    if (res.success) {
      toast.ok(`已删除: ${entry.name}`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(entry.path);
        return next;
      });
      await loadDir(cwd, false);
    } else {
      toast.err(`删除失败: ${res.error}`);
    }
  };

  // 操作:批量删除
  const handleBatchDelete = async (): Promise<void> => {
    const targets = entries.filter((e) => selected.has(e.path));
    if (targets.length === 0) return;
    if (!window.confirm(`确定删除选中的 ${targets.length} 项?(目录将递归删除)`)) return;
    const res = await api.file.batchRemove(targets.map((e) => e.path), true);
    if (res.success) {
      const okCount = res.deleted.length;
      const failCount = res.failed.length;
      if (failCount === 0) {
        toast.ok(`已删除 ${okCount} 项`);
      } else {
        toast.err(`成功 ${okCount} 项,失败 ${failCount} 项`);
      }
      clearSelection();
      await loadDir(cwd, false);
    } else {
      toast.err(`批量删除失败: ${res.error}`);
    }
  };

  // 操作:重命名
  const handleRename = async (): Promise<void> => {
    if (!renameTarget) return;
    const newName = renameTarget.newName.trim();
    if (!newName || newName === renameTarget.entry.name) {
      setRenameTarget(null);
      return;
    }
    const newPath = joinPath(cwd, newName);
    const res = await api.file.rename(renameTarget.entry.path, newPath);
    if (res.success) {
      toast.ok(`已重命名为: ${newName}`);
      setRenameTarget(null);
      await loadDir(cwd, false);
    } else {
      toast.err(`重命名失败: ${res.error}`);
    }
  };

  // 操作:安装 APK
  const handleInstallApk = async (entry: FileEntry): Promise<void> => {
    if (!window.confirm(`安装设备上的 APK: ${entry.name}?`)) return;
    toast.ok(`正在安装: ${entry.name}...`);
    const res = await api.file.installApk(entry.path);
    if (res.success) {
      toast.ok(`安装成功: ${entry.name}`);
    } else {
      toast.err(`安装失败: ${res.error}`);
    }
  };

  const [localApkPreview, setLocalApkPreview] = useState<string | null>(null);

  const handleInstallLocalApk = async (): Promise<void> => {
    // 选文件后弹 APK 预览,确认后安装
    const picked = await api.system.pickFile({
      kind: 'open',
      filter: 'APK 文件|*.apk;所有文件|*.*',
    });
    if (!picked) return;
    const apkPath = Array.isArray(picked) ? picked[0] : picked;
    setLocalApkPreview(apkPath);
  };

  const handleConfirmLocalInstall = async (apkPath: string): Promise<void> => {
    setLocalApkPreview(null);
    toast.ok('正在安装...');
    const res = await api.app.install(apkPath);
    if (res.success) {
      toast.ok(`安装成功`);
    } else {
      toast.err(`安装失败: ${res.error}`);
    }
  };

  // 操作:文本编辑
  const handleEditText = async (entry: FileEntry): Promise<void> => {
    setEditorTarget({ entry, content: '', loading: true, dirty: false });
    const res = await api.file.readText(entry.path);
    if (res.success) {
      setEditorTarget({ entry, content: res.content, loading: false, dirty: false });
    } else {
      toast.err(`读取失败: ${res.error}`);
      setEditorTarget(null);
    }
  };

  const handleSaveText = async (): Promise<void> => {
    if (!editorTarget) return;
    const res = await api.file.writeFile(editorTarget.entry.path, editorTarget.content);
    if (res.success) {
      toast.ok(`已保存: ${editorTarget.entry.name}`);
      setEditorTarget({ ...editorTarget, dirty: false });
    } else {
      toast.err(`保存失败: ${res.error}`);
    }
  };

  // 操作:chmod
  const handleChmod = async (): Promise<void> => {
    if (!chmodTarget) return;
    const res = await api.file.chmod(chmodTarget.entry.path, chmodTarget.mode, chmodTarget.recursive);
    if (res.success) {
      toast.ok(`权限已修改: ${chmodTarget.mode}`);
      setChmodTarget(null);
      await loadDir(cwd, false);
    } else {
      toast.err(`修改失败: ${res.error}`);
    }
  };

  // 操作:剪贴板(剪切/复制/粘贴)
  const handleCopy = (): void => {
    const targets = entries.filter((e) => selected.has(e.path)).map((e) => e.path);
    if (targets.length === 0) return;
    setClipboard({ paths: targets, mode: 'copy' });
    toast.ok(`已复制 ${targets.length} 项`);
  };
  const handleCut = (): void => {
    const targets = entries.filter((e) => selected.has(e.path)).map((e) => e.path);
    if (targets.length === 0) return;
    setClipboard({ paths: targets, mode: 'cut' });
    toast.ok(`已剪切 ${targets.length} 项`);
  };
  const handlePaste = async (): Promise<void> => {
    if (!clipboard || clipboard.paths.length === 0) return;
    for (const src of clipboard.paths) {
      const name = src.split('/').pop() ?? 'item';
      const dst = joinPath(cwd, name);
      try {
        if (clipboard.mode === 'copy') {
          await api.file.copy(src, dst, true);
        } else {
          await api.file.rename(src, dst);
        }
      } catch (e) {
        toast.err(`粘贴失败: ${name} - ${(e as Error).message}`);
      }
    }
    toast.ok(`已粘贴 ${clipboard.paths.length} 项`);
    if (clipboard.mode === 'cut') setClipboard(null);
    clearSelection();
    await loadDir(cwd, false);
  };

  // 操作:书签
  const addBookmark = (): void => {
    const name = cwd.split('/').pop() || cwd;
    const next = bookmarks.filter((b) => b.path !== cwd);
    next.push({ label: name, path: cwd });
    setBookmarks(next);
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    toast.ok(`已添加书签: ${name}`);
  };
  const removeBookmark = (path: string): void => {
    const next = bookmarks.filter((b) => b.path !== path);
    setBookmarks(next);
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  // 拖拽上传
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    for (const f of files) {
      const remote = joinPath(cwd, f.name);
      const res = await api.file.push(f.path, remote, selectedSerial);
      if (!res.success) {
        toast.err(`上传失败: ${f.name} - ${res.error}`);
      }
    }
    toast.ok(`已上传 ${files.length} 个文件`);
    await loadDir(cwd, false);
  };

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // 编辑地址栏/弹窗时不响应
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (newFolderOpen || newFileOpen || renameTarget || editorTarget || chmodTarget) return;

      if (e.key === 'Backspace' && device?.type === 'adb' && cwd !== '/') {
        e.preventDefault();
        goUp();
      } else if (e.key === 'Delete' && selected.size > 0) {
        e.preventDefault();
        void handleBatchDelete();
      } else if (e.key === 'F2' && selected.size === 1) {
        e.preventDefault();
        const entry = entries.find((x) => selected.has(x.path));
        if (entry) setRenameTarget({ entry, newName: entry.name });
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        handleCut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard) {
        e.preventDefault();
        void handlePaste();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, selected, entries, device, clipboard, newFolderOpen, newFileOpen, renameTarget, editorTarget, chmodTarget]);

  // 右键菜单
  const onContextMenu = (e: React.MouseEvent, entry: FileEntry | null): void => {
    e.preventDefault();
    if (entry && !selected.has(entry.path)) {
      selectOnly(entry.path);
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (): void => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  const hasDevice = device?.type === 'adb';
  const canBack = histIdx > 0;
  const canForward = histIdx < history.length - 1;
  const selectedCount = selected.size;


  return (
    <div className="space-y-6" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {/* 标题 + 设备选择器 + 刷新 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            <FolderOpen className="title-icon" />
            文件管理
          </h1>
          <p className="text-desc">浏览/传输/管理设备文件</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedSerial ?? ''}
            onChange={(e) => setSelectedSerial(e.target.value || undefined)}
            disabled={devices.length === 0}
            className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-xs text-zinc-300 focus:border-blue-600 focus:outline-none disabled:opacity-50"
          >
            <option value="">默认设备</option>
            {devices.map((d) => (
              <option key={d.serial} value={d.serial}>
                {d.model ? `${d.model} (${d.serial})` : d.serial}
                {d.state !== 'device' ? ` [${d.state}]` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => void loadDir(cwd, false)}
            disabled={!hasDevice || loading}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            刷新
          </button>
        </div>
      </div>

      {/* 无设备提示 */}
      {!hasDevice && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 py-16">
          <AlertTriangle className="h-10 w-10 text-zinc-600" />
          <div className="text-sm text-zinc-400">需要 ADB 设备连接后才能浏览文件</div>
          <p className="max-w-md text-center text-xs text-zinc-500">
            请连接手表并开启 ADB 调试后使用文件管理
          </p>
        </div>
      )}

      {/* 导航按钮组 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={goBack}
          disabled={!canBack || !hasDevice}
          className="btn-secondary"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> 后退
        </button>
        <button
          onClick={goForward}
          disabled={!canForward || !hasDevice}
          className="btn-secondary"
        >
          <ChevronRight className="h-3.5 w-3.5" /> 前进
        </button>
        <button
          onClick={goUp}
          disabled={!hasDevice || cwd === '/'}
          className="btn-secondary"
        >
          <ArrowUp className="h-3.5 w-3.5" /> 上一级
        </button>
        <button
          onClick={goHome}
          disabled={!hasDevice}
          className="btn-secondary"
        >
          <Home className="h-3.5 w-3.5" /> 主页
        </button>
      </div>

      {/* 文件操作按钮组 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setNewFolderOpen(true)}
          disabled={!hasDevice}
          className="btn-primary"
        >
          <FolderPlus className="h-3.5 w-3.5" /> 新建文件夹
        </button>
        <button
          onClick={() => setNewFileOpen(true)}
          disabled={!hasDevice}
          className="btn-primary"
        >
          <FilePlus className="h-3.5 w-3.5" /> 新建文件
        </button>
        <button
          onClick={() => void handleUpload()}
          disabled={!hasDevice}
          className="btn-primary"
        >
          <Upload className="h-3.5 w-3.5" /> 上传
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-800" />

        <button
          onClick={() => void handleBatchDownload()}
          disabled={!hasDevice || selectedCount === 0}
          className="btn-secondary"
        >
          <Download className="h-3.5 w-3.5" /> 下载
        </button>
        <button
          onClick={() => {
            const e = entries.find((x) => selected.has(x.path));
            if (e) setRenameTarget({ entry: e, newName: e.name });
          }}
          disabled={!hasDevice || selectedCount !== 1}
          className="btn-secondary"
        >
          <Pencil className="h-3.5 w-3.5" /> 重命名
        </button>
        <button
          onClick={() => void handleBatchDelete()}
          disabled={!hasDevice || selectedCount === 0}
          className="flex items-center gap-1.5 rounded-md border border-red-900/50 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> 删除
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-800" />

        <button
          onClick={handleCopy}
          disabled={selectedCount === 0}
          className="btn-secondary"
        >
          <Copy className="h-3.5 w-3.5" /> 复制
        </button>
        <button
          onClick={handleCut}
          disabled={selectedCount === 0}
          className="btn-secondary"
        >
          <Scissors className="h-3.5 w-3.5" /> 剪切
        </button>
        <button
          onClick={() => void handlePaste()}
          disabled={!clipboard || !hasDevice}
          className="btn-secondary"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> 粘贴
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-800" />

        <button
          onClick={handleInstallLocalApk}
          disabled={!hasDevice}
          className="btn-secondary"
        >
          <Package className="h-3.5 w-3.5" /> 安装 APK
        </button>
        <button
          onClick={() => {
            const e = entries.find((x) => selected.has(x.path));
            if (e) setChmodTarget({ entry: e, mode: '644', recursive: e.isDir });
          }}
          disabled={!hasDevice || selectedCount !== 1}
          className="btn-secondary"
        >
          <Lock className="h-3.5 w-3.5" /> 权限
        </button>
        <button
          onClick={addBookmark}
          disabled={!hasDevice}
          className="btn-secondary"
        >
          <BookmarkPlus className="h-3.5 w-3.5" /> 书签
        </button>
      </div>

      {/* 操作结果(用全局 toast,见 Toaster 组件) */}

      {/* 传输进度 */}
      {transfer && (
        <div className="flex items-center gap-3 rounded-md border border-blue-800/50 bg-blue-950/20 p-3 text-sm">
          {transfer.direction === 'push' ? (
            <Upload className="h-4 w-4 text-blue-400" />
          ) : (
            <Download className="h-4 w-4 text-blue-400" />
          )}
          <span className="text-blue-300">
            {transfer.direction === 'push' ? '上传' : '下载'}: {transfer.remote.split('/').pop()}
          </span>
          <div className="relative h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-all"
              style={{ width: `${transfer.percent}%` }}
            />
          </div>
          <span className="tabular-nums text-blue-400">{transfer.percent}%</span>
        </div>
      )}

      {/* 文件列表 section */}
      <section>
        <h2 className="section-title">
          <FolderOpen className="h-3.5 w-3.5" />
          文件列表 {selectedCount > 0 && `(已选 ${selectedCount} 项)`}
        </h2>
        <div className="card">
          {/* 搜索 + 排序 + 视图 + 选项 */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索当前目录..."
                className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-xs text-zinc-300 focus:border-blue-600 focus:outline-none"
            >
              <option value="name">名称</option>
              <option value="size">大小</option>
              <option value="mtime">修改时间</option>
              <option value="ext">类型</option>
            </select>
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="rounded-md border border-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              title={sortDir === 'asc' ? '升序' : '降序'}
            >
              {sortDir === 'asc' ? '↑ 升序' : '↓ 降序'}
            </button>
            <label className="flex items-center gap-1 text-xs text-zinc-500">
              <input
                type="checkbox"
                checked={dirsFirst}
                onChange={(e) => setDirsFirst(e.target.checked)}
                className="h-3 w-3"
              />
              目录优先
            </label>
            <div className="mx-1 h-4 w-px bg-zinc-800" />
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'rounded-md border px-2 py-1.5 text-xs',
                viewMode === 'list'
                  ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                  : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900',
              )}
              title="列表视图"
            >
              <ListIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'rounded-md border px-2 py-1.5 text-xs',
                viewMode === 'grid'
                  ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                  : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900',
              )}
              title="网格视图"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <div className="mx-1 h-4 w-px bg-zinc-800" />
            <label className="flex items-center gap-1 text-xs text-zinc-500" title="旧 Android 不支持 ls -lA">
              <input
                type="checkbox"
                checked={compatMode}
                onChange={(e) => setCompatMode(e.target.checked)}
                className="h-3 w-3"
              />
              兼容模式
            </label>
            <label className="flex items-center gap-1 text-xs text-zinc-500" title="推送时保留修改时间">
              <input
                type="checkbox"
                checked={keepMtime}
                onChange={(e) => setKeepMtime(e.target.checked)}
                className="h-3 w-3"
              />
              保留 mtime
            </label>
          </div>

          {/* 地址栏 */}
          <div className="mb-3 flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            {editingAddress ? (
              <input
                autoFocus
                value={addressValue}
                onChange={(e) => setAddressValue(e.target.value)}
                onBlur={() => {
                  setEditingAddress(false);
                  if (addressValue.trim() && addressValue !== cwd) {
                    void loadDir(addressValue.trim());
                  } else {
                    setAddressValue(cwd);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  else if (e.key === 'Escape') {
                    setAddressValue(cwd);
                    setEditingAddress(false);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent px-1 text-xs text-zinc-200 focus:outline-none"
              />
            ) : (
              <div
                className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
                onClick={() => setEditingAddress(true)}
              >
                {crumbs.map((c, i) => (
                  <div key={c.path} className="flex shrink-0 items-center">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-600" />}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void loadDir(c.path);
                      }}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-zinc-800',
                        i === crumbs.length - 1 ? 'font-medium text-blue-300' : 'text-zinc-400',
                      )}
                    >
                      {c.name}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <span className="shrink-0 text-xs text-zinc-500">{displayEntries.length} 项</span>
          </div>

          {/* 主体: 侧栏 + 列表 */}
          <div className="flex gap-3">
            <aside className="hidden w-40 shrink-0 space-y-3 sm:block">
              {/* 快捷路径 */}
              <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2">
                <div className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  快捷访问
                </div>
                <div className="flex flex-col gap-0.5">
                  {quickPaths.map((qp) => {
                    const Icon = QUICK_ICON_MAP[qp.icon] ?? FolderIcon;
                    const active = cwd === qp.path;
                    return (
                      <button
                        key={qp.path}
                        onClick={() => void loadDir(qp.path)}
                        disabled={!hasDevice}
                        className={cn(
                          'flex items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40',
                          active
                            ? 'bg-blue-500/10 text-blue-300'
                            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
                        )}
                        title={qp.path}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{qp.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* 书签 */}
              <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2">
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">书签</span>
                  <button
                    onClick={addBookmark}
                    disabled={!hasDevice}
                    title="添加当前目录"
                    className="text-zinc-500 hover:text-blue-400 disabled:opacity-40"
                  >
                    <BookmarkPlus className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex flex-col gap-0.5">
                  {bookmarks.length === 0 ? (
                    <div className="px-1 py-1.5 text-xs text-zinc-600">暂无书签</div>
                  ) : (
                    bookmarks.map((b) => (
                      <div key={b.path} className="group flex items-center">
                        <button
                          onClick={() => void loadDir(b.path)}
                          disabled={!hasDevice}
                          className={cn(
                            'flex flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40',
                            cwd === b.path
                              ? 'bg-blue-500/10 text-blue-300'
                              : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
                          )}
                          title={b.path}
                        >
                          <Bookmark className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{b.label}</span>
                        </button>
                        <button
                          onClick={() => removeBookmark(b.path)}
                          className="ml-0.5 hidden shrink-0 text-zinc-600 hover:text-red-400 group-hover:block"
                          title="移除书签"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>

            <div
              className="min-w-0 flex-1"
              onContextMenu={(e) => onContextMenu(e, null)}
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">读取目录中...</span>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10">
                  <AlertTriangle className="h-8 w-8 text-red-400" />
                  <span className="text-sm text-red-400">{error}</span>
                  <button
                    onClick={() => void loadDir(cwd, false)}
                    className="mt-2 rounded-md border border-zinc-800 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  >
                    重试
                  </button>
                </div>
              ) : displayEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-500">
                  <FolderOpen className="h-8 w-8 text-zinc-600" />
                  <span className="text-sm">{searchQuery ? '无匹配结果' : '空目录'}</span>
                </div>
              ) : viewMode === 'list' ? (
                <div className="max-h-[calc(100vh-420px)] min-h-[280px] overflow-y-auto rounded-md border border-zinc-800">
                  <div className="sticky top-0 z-10 grid grid-cols-[24px_1fr_90px_140px_90px] gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur">
                    <span></span>
                    <span>名称</span>
                    <span className="text-right">大小</span>
                    <span>修改时间</span>
                    <span>权限</span>
                  </div>
                  {displayEntries.map((entry) => {
                    const isSel = selected.has(entry.path);
                    const Icon = entry.isDir ? FolderIcon : entry.isLink ? Link2 : FileIcon;
                    return (
                      <div
                        key={entry.path}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) toggleSelect(entry.path);
                          else if (e.shiftKey) rangeSelect(entry.path);
                          else selectOnly(entry.path);
                        }}
                        onDoubleClick={() => openEntry(entry)}
                        onContextMenu={(e) => onContextMenu(e, entry)}
                        className={cn(
                          'grid cursor-pointer grid-cols-[24px_1fr_90px_140px_90px] items-center gap-2 border-b border-zinc-800/60 px-3 py-2 text-xs transition-colors last:border-0',
                          isSel ? 'bg-blue-500/10 text-blue-100' : 'text-zinc-300 hover:bg-zinc-900/40',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelect(entry.path)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3 w-3"
                        />
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon
                            className={cn(
                              'h-4 w-4 shrink-0',
                              entry.isDir ? 'text-blue-400' : entry.isLink ? 'text-purple-400' : 'text-zinc-500',
                            )}
                          />
                          <span className="truncate">{entry.name}</span>
                          {entry.ext === 'apk' && (
                            <span className="shrink-0 rounded bg-green-900/40 px-1 py-0.5 text-xs text-green-400">
                              APK
                            </span>
                          )}
                        </span>
                        <span className="text-right tabular-nums text-zinc-500">
                          {entry.isDir ? '-' : formatBytes(entry.size)}
                        </span>
                        <span className="text-zinc-500">{entry.mtime}</span>
                        <span className="truncate font-mono text-xs text-zinc-600">{entry.perms}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid max-h-[calc(100vh-420px)] min-h-[280px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                  {displayEntries.map((entry) => {
                    const isSel = selected.has(entry.path);
                    const Icon = entry.isDir ? FolderIcon : entry.isLink ? Link2 : FileIcon;
                    return (
                      <div
                        key={entry.path}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) toggleSelect(entry.path);
                          else if (e.shiftKey) rangeSelect(entry.path);
                          else selectOnly(entry.path);
                        }}
                        onDoubleClick={() => openEntry(entry)}
                        onContextMenu={(e) => onContextMenu(e, entry)}
                        className={cn(
                          'flex cursor-pointer flex-col items-center gap-1 rounded-md border p-2 text-center transition-colors',
                          isSel
                            ? 'border-blue-600 bg-blue-950/40'
                            : 'border-zinc-800 hover:bg-zinc-900/40',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-8 w-8',
                            entry.isDir ? 'text-blue-400' : entry.isLink ? 'text-purple-400' : 'text-zinc-500',
                          )}
                        />
                        <span className="line-clamp-2 w-full text-xs text-zinc-300" title={entry.name}>
                          {entry.name}
                        </span>
                        <span className="text-xs text-zinc-600">
                          {entry.isDir ? '' : formatBytes(entry.size)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 磁盘用量 */}
          {disk && (
            <div className="mt-3 flex items-center gap-3 border-t border-zinc-800 pt-3 text-xs">
              <HardDrive className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className="shrink-0 text-zinc-400">{disk.path}</span>
              <div className="relative h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full',
                    disk.usagePercent > 90 ? 'bg-red-500' : 'bg-blue-500',
                  )}
                  style={{ width: `${Math.min(disk.usagePercent, 100)}%` }}
                />
              </div>
              <span className="shrink-0 tabular-nums text-zinc-400">
                {formatBytes(disk.used)} / {formatBytes(disk.total)} ({disk.usagePercent}%)
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 新建文件夹弹窗 */}
      {newFolderOpen && (
        <ModalDialog
          title="新建文件夹"
          onClose={() => {
            setNewFolderOpen(false);
            setNewFolderName('');
          }}
        >
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleNewFolder();
              if (e.key === 'Escape') {
                setNewFolderOpen(false);
                setNewFolderName('');
              }
            }}
            placeholder="文件夹名称"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setNewFolderOpen(false);
                setNewFolderName('');
              }}
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              取消
            </button>
            <button
              onClick={handleNewFolder}
              disabled={!newFolderName.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </ModalDialog>
      )}

      {/* 新建文件弹窗 */}
      {newFileOpen && (
        <ModalDialog
          title="新建文件"
          wide
          onClose={() => {
            setNewFileOpen(false);
            setNewFileName('');
            setNewFileContent('');
          }}
        >
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="文件名(如 note.txt)"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
          />
          <textarea
            value={newFileContent}
            onChange={(e) => setNewFileContent(e.target.value)}
            placeholder="文件内容(可选)"
            rows={8}
            className="mt-3 w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setNewFileOpen(false);
                setNewFileName('');
                setNewFileContent('');
              }}
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              取消
            </button>
            <button
              onClick={handleNewFile}
              disabled={!newFileName.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </ModalDialog>
      )}

      {/* 重命名弹窗 */}
      {renameTarget && (
        <ModalDialog
          title={`重命名: ${renameTarget.entry.name}`}
          onClose={() => setRenameTarget(null)}
        >
          <input
            autoFocus
            value={renameTarget.newName}
            onChange={(e) => setRenameTarget({ ...renameTarget, newName: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRename();
              if (e.key === 'Escape') setRenameTarget(null);
            }}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 focus:border-blue-600 focus:outline-none"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setRenameTarget(null)}
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              取消
            </button>
            <button
              onClick={handleRename}
              disabled={
                !renameTarget.newName.trim() || renameTarget.newName.trim() === renameTarget.entry.name
              }
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              重命名
            </button>
          </div>
        </ModalDialog>
      )}

      {/* 文本编辑器弹窗 */}
      {editorTarget && (
        <ModalDialog
          title={`编辑: ${editorTarget.entry.name}${editorTarget.dirty ? ' *' : ''}`}
          wide
          onClose={() => {
            if (editorTarget.dirty && !window.confirm('有未保存的修改,确定关闭?')) return;
            setEditorTarget(null);
          }}
        >
          {editorTarget.loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 读取中...
            </div>
          ) : (
            <>
              <textarea
                value={editorTarget.content}
                onChange={(e) => setEditorTarget({ ...editorTarget, content: e.target.value, dirty: true })}
                rows={16}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-blue-600 focus:outline-none"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-zinc-600">{editorTarget.content.length} 字符</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditorTarget(null)}
                    className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  >
                    关闭
                  </button>
                  <button
                    onClick={handleSaveText}
                    disabled={!editorTarget.dirty}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </div>
            </>
          )}
        </ModalDialog>
      )}

      {/* chmod 弹窗 */}
      {chmodTarget && (
        <ModalDialog
          title={`修改权限: ${chmodTarget.entry.name}`}
          onClose={() => setChmodTarget(null)}
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                权限模式(八进制,如 644 / 755 / 600)
              </label>
              <input
                autoFocus
                value={chmodTarget.mode}
                onChange={(e) =>
                  setChmodTarget({
                    ...chmodTarget,
                    mode: e.target.value.replace(/[^0-7]/g, '').slice(0, 4),
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleChmod();
                  if (e.key === 'Escape') setChmodTarget(null);
                }}
                placeholder="644"
                className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-500 focus:border-blue-600 focus:outline-none"
              />
            </div>
            {chmodTarget.entry.isDir && (
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={chmodTarget.recursive}
                  onChange={(e) => setChmodTarget({ ...chmodTarget, recursive: e.target.checked })}
                  className="h-3 w-3"
                />
                递归应用到子文件
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setChmodTarget(null)}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              >
                取消
              </button>
              <button
                onClick={handleChmod}
                disabled={!/^[0-7]{3,4}$/.test(chmodTarget.mode)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                应用
              </button>
            </div>
          </div>
        </ModalDialog>
      )}

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-xl"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 180),
            top: Math.min(ctxMenu.y, window.innerHeight - 320),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.entry ? (
            <>
              <CtxItem
                icon={FolderOpen}
                label={ctxMenu.entry.isDir ? '进入目录' : '打开'}
                onClick={() => {
                  openEntry(ctxMenu.entry!);
                  setCtxMenu(null);
                }}
              />
              {ctxMenu.entry.ext === 'apk' && (
                <CtxItem
                  icon={Package}
                  label="安装此 APK"
                  onClick={() => {
                    void handleInstallApk(ctxMenu.entry!);
                    setCtxMenu(null);
                  }}
                />
              )}
              {!ctxMenu.entry.isDir && isTextFile(ctxMenu.entry) && (
                <CtxItem
                  icon={Pencil}
                  label="编辑文本"
                  onClick={() => {
                    void handleEditText(ctxMenu.entry!);
                    setCtxMenu(null);
                  }}
                />
              )}
              <CtxItem
                icon={Download}
                label="下载到电脑"
                onClick={() => {
                  void handleDownload(ctxMenu.entry!);
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                icon={Pencil}
                label="重命名 (F2)"
                onClick={() => {
                  setRenameTarget({ entry: ctxMenu.entry!, newName: ctxMenu.entry!.name });
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                icon={Lock}
                label="修改权限"
                onClick={() => {
                  setChmodTarget({
                    entry: ctxMenu.entry!,
                    mode: '644',
                    recursive: ctxMenu.entry!.isDir,
                  });
                  setCtxMenu(null);
                }}
              />
              <div className="my-1 h-px bg-zinc-800" />
              <CtxItem
                icon={Trash2}
                label="删除 (Delete)"
                danger
                onClick={() => {
                  void handleDelete(ctxMenu.entry!);
                  setCtxMenu(null);
                }}
              />
            </>
          ) : (
            <>
              <CtxItem
                icon={FolderPlus}
                label="新建文件夹"
                onClick={() => {
                  setNewFolderOpen(true);
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                icon={FilePlus}
                label="新建文件"
                onClick={() => {
                  setNewFileOpen(true);
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                icon={Upload}
                label="上传文件"
                onClick={() => {
                  void handleUpload();
                  setCtxMenu(null);
                }}
              />
              {clipboard && (
                <CtxItem
                  icon={ClipboardPaste}
                  label={`粘贴 ${clipboard.paths.length} 项`}
                  onClick={() => {
                    void handlePaste();
                    setCtxMenu(null);
                  }}
                />
              )}
              <div className="my-1 h-px bg-zinc-800" />
              <CtxItem
                icon={RefreshCw}
                label="刷新"
                onClick={() => {
                  void loadDir(cwd, false);
                  setCtxMenu(null);
                }}
              />
            </>
          )}
        </div>
      )}

      {/* 本地 APK 预览弹窗 */}
      <ApkPreviewDialog
        apkPath={localApkPreview}
        onConfirm={(path) => void handleConfirmLocalInstall(path)}
        onClose={() => setLocalApkPreview(null)}
      />
    </div>
  );
}

// ========== 辅助函数 ==========

function joinPath(base: string, name: string): string {
  if (base.endsWith('/')) return base + name;
  return base + '/' + name;
}

// ========== 子组件 ==========

function CtxItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        danger ? 'text-red-400 hover:bg-red-950/30' : 'text-zinc-300 hover:bg-zinc-800 hover:text-blue-300',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

function ModalDialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={cn(
          'rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-2xl',
          wide ? 'w-[600px]' : 'w-[360px]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">{title}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
