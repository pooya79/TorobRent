import { CandidateEvidence } from "./CandidateEvidence";
import type { ExternalListingCandidate } from "./queries";

export function BulkCandidateDetails({
  candidate,
}: {
  candidate: ExternalListingCandidate;
}) {
  return (
    <details className="grid gap-2">
      <summary>جزئیات آگهی</summary>
      <p>{candidate.title}</p>
      <p>
        متراژ: {candidate.area_sqm?.toLocaleString("fa-IR") ?? "نامشخص"} متر
      </p>
      <CandidateEvidence candidate={candidate} />
    </details>
  );
}
