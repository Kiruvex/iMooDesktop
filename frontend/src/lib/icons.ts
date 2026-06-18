/**
 * 统一图标导出（lucide-preact）
 *
 * 所有组件/页面从此处 import，避免散乱直接 import 'lucide-preact'。
 * 这样未来更换图标库（或调整子集）只需改这一个文件。
 *
 * 用法：
 *   import { Home, Smartphone } from '../lib/icons';
 *   <Home size={18} />
 *
 * 类型签名：每个图标都是 `LucideIcon`（即 `ComponentType<LucideProps>`），
 * LucideProps 继承自 Preact 的 SVGAttributes<SVGSVGElement>，
 * 含 size / color / strokeWidth 等专有属性 + 透传任意 SVG 原生属性。
 *
 * 注意：lucide-preact 1.20.0 的类型声明文件在发布时缺失，
 * 我们在 src/types/lucide-preact.d.ts 手动补齐了类型声明。
 */

import type { LucideIcon } from 'lucide-preact';
export type { LucideIcon };

export {
  // 导航
  Home, Smartphone, User, Activity, Globe, MessageCircle, Star, Wrench, Settings,
  // 操作
  X, Menu, RefreshCw, Trash2, Edit, Plus, Minus, Check, ChevronRight, ChevronDown, ChevronLeft, ChevronUp,
  ArrowRight, ArrowLeft, Send, Copy, Download, Upload, Search, Filter, Eye, EyeOff,
  // 状态
  CheckCircle2, CheckCheck, AlertCircle, AlertTriangle, AlertOctagon, Info, XCircle,
  Loader2, Clock, Hourglass, Timer,
  // 设备
  Watch, BatteryLow, BatteryMedium, BatteryFull, Battery, Wifi, WifiOff, Signal, MapPin, HeartPulse,
  // 社交
  Heart, MessageSquare, ThumbsUp, Users, UserPlus, UserCheck, MessagesSquare,
  // 文件/图片
  Image, ImagePlus, Film, Video, Link2, FileText, FileX, Paperclip, Inbox,
  // 主题
  Sun, Moon, Monitor, Palette,
  // 工具
  Calculator, Clipboard, ClipboardCheck, ClipboardCopy, ClipboardList, ScrollText,
  // 运动
  BarChart3, Dumbbell, Repeat, Footprints,
  // 其他
  Sparkles, Zap, Flame, TrendingUp, Award, Bookmark, Flag, Bell, Camera, Phone, Mail,
  Calendar, Gauge, BookOpen, Quote, RotateCw, RotateCcw, CircleDot, Circle, Frown,
  Unplug, SearchX,
} from 'lucide-preact';
