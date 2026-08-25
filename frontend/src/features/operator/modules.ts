import { ClipboardCheck, Headphones, type LucideIcon } from "lucide-react";

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
