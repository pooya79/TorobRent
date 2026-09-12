import {
  ClipboardCheck,
  Globe2,
  Headphones,
  Layers3,
  MessageSquareWarning,
  type LucideIcon,
} from "lucide-react";

import type { components } from "@/lib/api/schema";

export type OperatorCapability =
  components["schemas"]["OperatorCapabilitiesEnum"];

export type OperatorModule = {
  capabilities: readonly OperatorCapability[];
  description: string;
  icon: LucideIcon;
  label: string;
  to: string;
};

export const operatorModules = [
  {
    capabilities: ["curate_catalog"],
    description: "مقایسه شواهد هویتی و ساماندهی گروه‌های ملک",
    icon: Layers3,
    label: "ساماندهی کاتالوگ",
    to: "/operator/catalog-curation",
  },
  {
    capabilities: ["moderate_conversations"],
    description: "بررسی شواهد فقط از مسیر گزارش و ثبت اقدام‌های نظارتی",
    icon: MessageSquareWarning,
    label: "گزارش‌های گفت‌وگو",
    to: "/operator/conversation-reports",
  },
  {
    capabilities: ["review_source_proposals", "manage_operator_queues"],
    description: "بررسی وب‌سایت، استخراج و انتشار ملک‌های آن",
    icon: Globe2,
    label: "مدیریت منابع",
    to: "/operator/source-proposals",
  },
  {
    capabilities: ["review_submissions"],
    description: "صف درخواست‌های آماده بررسی و انتشار",
    icon: ClipboardCheck,
    label: "بررسی درخواست‌های ثبت آگهی",
    to: "/operator/submissions",
  },
  {
    capabilities: ["handle_support", "handle_privacy_requests"],
    description: "رسیدگی به درخواست‌های راهنمایی و پشتیبانی",
    icon: Headphones,
    label: "پشتیبانی",
    to: "/operator/support",
  },
] as const satisfies readonly OperatorModule[];
