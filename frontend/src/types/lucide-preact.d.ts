/**
 * lucide-preact 类型声明（补丁）
 *
 * 背景：lucide-preact@1.20.0 的 package.json 指向 dist/lucide-preact.d.ts，
 * 但实际发布的包里该文件缺失（发布打包遗漏）。这里手动声明我们用到的那部分
 * 命名导出，让 TypeScript 不再报 "Could not find a declaration file" 错误。
 *
 * 如果将来 lucide-preact 修复了类型发布问题（升级版本后），可以删除此文件。
 *
 * 每个图标都是 Preact FunctionComponent，接受 LucideProps。
 * 完整 LucideProps 还包含 absoluteStrokeWidth / aria-hidden 等透传给 SVG 的属性，
 * 这里简化为常用集合；如需更多，可自行扩展。
 */
declare module 'lucide-preact' {
  import type { ComponentType, SVGAttributes } from 'preact';

  export interface LucideProps extends SVGAttributes<SVGSVGElement> {
    size?: number | string;
    color?: string;
    stroke?: string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
  }

  export type LucideIcon = ComponentType<LucideProps>;

  // 导航
  export const Home: LucideIcon;
  export const Smartphone: LucideIcon;
  export const User: LucideIcon;
  export const Activity: LucideIcon;
  export const Globe: LucideIcon;
  export const MessageCircle: LucideIcon;
  export const Star: LucideIcon;
  export const Wrench: LucideIcon;
  export const Settings: LucideIcon;

  // 操作
  export const X: LucideIcon;
  export const Menu: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const Trash2: LucideIcon;
  export const Edit: LucideIcon;
  export const Plus: LucideIcon;
  export const Minus: LucideIcon;
  export const Check: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const ChevronLeft: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ArrowLeft: LucideIcon;
  export const Send: LucideIcon;
  export const Copy: LucideIcon;
  export const Download: LucideIcon;
  export const Upload: LucideIcon;
  export const Search: LucideIcon;
  export const Filter: LucideIcon;
  export const Eye: LucideIcon;
  export const EyeOff: LucideIcon;

  // 状态
  export const CheckCircle2: LucideIcon;
  export const CheckCheck: LucideIcon;
  export const AlertCircle: LucideIcon;
  export const AlertTriangle: LucideIcon;
  export const AlertOctagon: LucideIcon;
  export const Info: LucideIcon;
  export const XCircle: LucideIcon;
  export const Loader2: LucideIcon;
  export const Clock: LucideIcon;
  export const Hourglass: LucideIcon;
  export const Timer: LucideIcon;

  // 设备
  export const Watch: LucideIcon;
  export const BatteryLow: LucideIcon;
  export const BatteryMedium: LucideIcon;
  export const BatteryFull: LucideIcon;
  export const Battery: LucideIcon;
  export const Wifi: LucideIcon;
  export const WifiOff: LucideIcon;
  export const Signal: LucideIcon;
  export const MapPin: LucideIcon;
  export const HeartPulse: LucideIcon;

  // 社交
  export const Heart: LucideIcon;
  export const MessageSquare: LucideIcon;
  export const ThumbsUp: LucideIcon;
  export const Users: LucideIcon;
  export const UserPlus: LucideIcon;
  export const UserCheck: LucideIcon;
  export const MessagesSquare: LucideIcon;

  // 文件/图片
  export const Image: LucideIcon;
  export const ImagePlus: LucideIcon;
  export const Film: LucideIcon;
  export const Video: LucideIcon;
  export const Link2: LucideIcon;
  export const FileText: LucideIcon;
  export const FileX: LucideIcon;
  export const Paperclip: LucideIcon;
  export const Inbox: LucideIcon;

  // 主题
  export const Sun: LucideIcon;
  export const Moon: LucideIcon;
  export const Monitor: LucideIcon;
  export const Palette: LucideIcon;

  // 工具
  export const Calculator: LucideIcon;
  export const Clipboard: LucideIcon;
  export const ClipboardCheck: LucideIcon;
  export const ClipboardCopy: LucideIcon;
  export const ClipboardList: LucideIcon;
  export const ScrollText: LucideIcon;

  // 运动
  export const BarChart3: LucideIcon;
  export const Dumbbell: LucideIcon;
  export const Repeat: LucideIcon;
  export const Footprints: LucideIcon;

  // 其他
  export const Sparkles: LucideIcon;
  export const Zap: LucideIcon;
  export const Flame: LucideIcon;
  export const TrendingUp: LucideIcon;
  export const Award: LucideIcon;
  export const Bookmark: LucideIcon;
  export const Flag: LucideIcon;
  export const Bell: LucideIcon;
  export const Camera: LucideIcon;
  export const Phone: LucideIcon;
  export const Mail: LucideIcon;
  export const Calendar: LucideIcon;
  export const Gauge: LucideIcon;
  export const BookOpen: LucideIcon;
  export const Quote: LucideIcon;
  export const RotateCw: LucideIcon;
  export const RotateCcw: LucideIcon;
  export const CircleDot: LucideIcon;
  export const Circle: LucideIcon;
  export const Frown: LucideIcon;
  export const Unplug: LucideIcon;
  export const SearchX: LucideIcon;
}
