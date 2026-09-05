import {
  ClipboardCheck,
  Globe2,
  Headphones,
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
    capabilities: ["moderate_conversations"],
    description: "بررسی شواهد فقط از مسیر گزارش و ثبت اقدام‌های نظارتی",
    icon: MessageSquareWarning,
    label: "گزارش‌های گفت‌وگو",
    to: "/operator/conversation-reports",
  },
  {
    capabilities: ["review_source_proposals", "manage_operator_queues"],
    description: "اعتبارسنجی Source و رابطه نماینده آن",
    icon: Globe2,
    label: "اعتبارسنجی Sourceها",
    to: "/operator/source-proposals",
  },
  {
    capabilities: ["review_submissions"],
    description: "صف Submissionهای آماده بررسی و انتشار",
    icon: ClipboardCheck,
    label: "بررسی Submissionها",
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
