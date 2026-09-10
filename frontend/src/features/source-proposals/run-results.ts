import type { ExternalListingCandidate } from "./queries";

export function readyForRunPublication(candidate: ExternalListingCandidate) {
  return (
    candidate.state === "pending" &&
    !candidate.superseded &&
    !candidate.exclusion_reason &&
    Object.keys(candidate.validation_errors ?? {}).length === 0
  );
}

export function runResultGroup(candidate: ExternalListingCandidate) {
  if (candidate.superseded) return "archived";
  if (candidate.state === "published") return "published";
  if (candidate.state === "rejected" || candidate.state === "cancelled")
    return "archived";
  return readyForRunPublication(candidate) ? "ready" : "issues";
}

export const runResultLabels = {
  ready: "آماده تأیید انتشار",
  issues: "نیازمند رسیدگی",
  published: "منتشرشده",
  archived: "ردشده یا قدیمی",
};
