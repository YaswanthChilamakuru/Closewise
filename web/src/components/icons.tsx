import type { ComponentType } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  Clock,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  ExternalLink,
  FilePlus2,
  FileText,
  LayoutGrid,
  Link2,
  LogOut,
  Pencil,
  Plug,
  Plus,
  Printer,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  X,
  type LucideProps,
} from "lucide-react";

// Lucide icons with a slightly finer default stroke, exported under stable app names.
const wrap = (Icon: ComponentType<LucideProps>) => {
  const Wrapped = (p: LucideProps) => <Icon strokeWidth={1.75} aria-hidden {...p} />;
  Wrapped.displayName = `Icon(${Icon.displayName ?? "lucide"})`;
  return Wrapped;
};

export const IconCheck = wrap(Check);
export const IconCopy = wrap(Copy);
export const IconPlus = wrap(Plus);
export const IconTrash = wrap(Trash2);
export const IconUp = wrap(ChevronUp);
export const IconDown = wrap(ChevronDown);
export const IconArrowLeft = wrap(ArrowLeft);
export const IconExternal = wrap(ExternalLink);
export const IconEye = wrap(Eye);
export const IconEyeOff = wrap(EyeOff);
export const IconRefresh = wrap(RefreshCw);
export const IconLogout = wrap(LogOut);
export const IconAlert = wrap(CircleAlert);
export const IconSend = wrap(Send);
export const IconLink = wrap(Link2);
export const IconFile = wrap(FileText);
export const IconFilePlus = wrap(FilePlus2);
export const IconPlug = wrap(Plug);
export const IconGrid = wrap(LayoutGrid);
export const IconClock = wrap(Clock);
export const IconPencil = wrap(Pencil);
export const IconX = wrap(X);
export const IconSparkle = wrap(Sparkles);
export const IconWallet = wrap(CircleDollarSign);
export const IconTrending = wrap(TrendingUp);
export const IconTarget = wrap(Target);
export const IconCircleCheck = wrap(CircleCheck);
export const IconPrinter = wrap(Printer);
export const IconDuplicate = wrap(CopyPlus);
