import type { OperatorSourceProposal } from "./queries";

export const proposalStateLabels: Record<string, string> = {
  draft: "پیش‌نویس",
  pending: "در انتظار بررسی",
  changes_requested: "در انتظار اصلاح نماینده",
  approved: "تأیید شده",
  rejected: "رد شده",
  revoked: "لغو شده",
};
export function sourceDomain(proposal: OperatorSourceProposal) {
  try {
    return new URL(proposal.website_url || "").hostname;
  } catch {
    return "نشانی ثبت نشده";
  }
}
function workflowStage(proposal: OperatorSourceProposal) {
  if (proposal.state !== "pending" && proposal.state !== "approved")
    return {
      stage: proposalStateLabels[proposal.state ?? "draft"],
      action: "مشاهده تاریخچه",
      section: "history",
      filter: "closed",
    };
  if (
    proposal.discovery_stage === "queued" ||
    proposal.discovery_stage === "running"
  )
    return {
      stage: "در حال کشف",
      action: "پیگیری پیشرفت کشف صفحات",
      section: "url",
      filter: "discovery",
    };
  if (proposal.discovery_stage === "failed")
    return {
      stage: "کشف ناموفق",
      action: "بررسی خطای کشف",
      section: "url",
      filter: "warning",
    };
  if (proposal.profile_versions?.[0]?.status === "proposed")
    return {
      stage: "بررسی پروفایل",
      action: "بررسی و تأیید پروفایل منبع",
      section: "profile",
      filter: "profile",
    };
  if (proposal.assignment?.state === "active")
    return {
      stage: proposal.assignment.source.processing_paused
        ? "پردازش متوقف"
        : "منبع فعال",
      action: proposal.assignment.source.processing_paused
        ? "بررسی علت توقف پردازش"
        : "بررسی ملک‌ها و انتشار",
      section: proposal.assignment.source.processing_paused
        ? "processing"
        : "exceptions",
      filter: "active",
    };
  if (proposal.discovery_stage === "complete")
    return {
      stage: "بررسی پروفایل",
      action: "بررسی و تأیید پروفایل منبع",
      section: "profile",
      filter: "profile",
    };
  return {
    stage: "بررسی نشانی",
    action: "بررسی نشانی و اختیار نماینده",
    section: "url",
    filter: "url",
  };
}
export function sourceAssignee(proposal: OperatorSourceProposal) {
  return (
    proposal.responsibility?.operator ??
    proposal.assignment?.review_operator ??
    null
  );
}
export function sourceWarnings(proposal: OperatorSourceProposal) {
  return [
    proposal.current_website_conflict && "تعارض وب‌سایت",
    proposal.needs_reconciliation && "دامنه تکراری",
    proposal.discovery_stage === "failed" && "کشف ناموفق",
    proposal.assignment?.source.processing_paused && "پردازش متوقف",
  ].filter(Boolean) as string[];
}

export function sourceWorkflow(proposal: OperatorSourceProposal) {
  const workflow = workflowStage(proposal);
  return workflow.filter !== "closed" &&
    (proposal.current_website_conflict || proposal.needs_reconciliation)
    ? {
        ...workflow,
        action: "بررسی تعارض و گفت‌وگو با نماینده",
        section: "overview",
      }
    : workflow;
}
