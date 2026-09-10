import type { ExternalListingCandidate } from "./queries";

export function readyForRunPublication(candidate: ExternalListingCandidate) {
  return (
    candidate.state === "pending" &&
    !candidate.superseded &&
    candidate.is_current !== false &&
    !candidate.exclusion_reason &&
    Object.keys(candidate.validation_errors ?? {}).length === 0
  );
}

export function runResultGroup(candidate: ExternalListingCandidate) {
  if (candidate.superseded) return "archived";
  if (candidate.state === "published") return "published";
  if (
    candidate.is_current === false ||
    candidate.state === "rejected" ||
    candidate.state === "cancelled"
  )
    return "archived";
  return readyForRunPublication(candidate) ? "ready" : "issues";
}

export const runResultLabels = {
  ready: "آماده تأیید انتشار",
  issues: "نیازمند رسیدگی",
  published: "منتشرشده",
  archived: "بایگانی یا غیرفعال",
};

export function runResultStatus(candidate: ExternalListingCandidate) {
  if (candidate.superseded) return "جایگزین شده";
  if (candidate.state === "published") return "منتشرشده";
  if (candidate.state === "rejected") return "رد شده";
  if (candidate.state === "cancelled") return "لغو شده";
  if (candidate.is_current === false) return "استخراج غیرفعال";
  if (candidate.exclusion_reason) return "محدودیت انتشار";
  return runResultLabels[runResultGroup(candidate)];
}
