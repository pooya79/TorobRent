import type {
  ExternalListingCandidate,
  OperatorSourceProposal,
} from "./queries";

export function candidateNeedsAttention(candidate: ExternalListingCandidate) {
  return (
    candidate.state === "changes_requested" ||
    Boolean(candidate.exclusion_reason) ||
    Object.keys(candidate.validation_errors ?? {}).length > 0
  );
}

export function candidateStatus(candidate: ExternalListingCandidate) {
  if (candidate.exclusion_reason) return "محدودیت انتشار";
  if (candidateNeedsAttention(candidate)) return "نیازمند اصلاح";
  return {
    pending: "در انتظار بررسی",
    changes_requested: "نیازمند اصلاح",
    published: "منتشر شده",
    rejected: "رد شده",
    cancelled: "لغو شده",
  }[candidate.state ?? "pending"];
}

export function representativeName(proposal?: OperatorSourceProposal) {
  if (!proposal) return "اطلاعات نماینده در دسترس نیست";
  return (
    proposal.submitter?.display_name ||
    proposal.submitter?.account_label ||
    "حساب حذف شده"
  );
}

export function candidateCanDecide(
  candidate: ExternalListingCandidate,
  proposal: OperatorSourceProposal | undefined,
  userId?: string,
) {
  return (
    !candidate.extraction_run ||
    Boolean(
      userId &&
      proposal?.assignment?.state === "active" &&
      proposal.assignment.review_operator === userId,
    )
  );
}

export function rentalAmount(value: number | null | undefined) {
  return value == null
    ? "نامشخص"
    : `${(value / 10).toLocaleString("fa-IR")} تومان`;
}

export function normalizeListingSearch(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\s]+/g, " ")
    .trim();
}
