import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import { CandidateCorrectionForm } from "./CandidateCorrectionForm";
import { CandidateEvidence } from "./CandidateEvidence";
import type { ExternalListingCandidate } from "./queries";

export function BulkCandidateDetails({
  candidate,
  onCorrected,
}: {
  candidate: ExternalListingCandidate;
  onCorrected: () => void;
}) {
  const [claimed, setClaimed] = useState(false);
  const claim = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/external-listing-candidates/{candidate_id}/claim/",
        {
          params: { path: { candidate_id: candidate.id } },
          body: { for_correction: true },
        },
      );
      if (error || !data) throw apiError(error);
    },
    onSuccess: () => setClaimed(true),
  });
  return (
    <details className="grid gap-2">
      <summary>جزئیات و اصلاح همین آگهی</summary>
      <p>{candidate.title}</p>
      <p>
        متراژ: {candidate.area_sqm?.toLocaleString("fa-IR") ?? "نامشخص"} متر
      </p>
      <CandidateEvidence candidate={candidate} />
      {!candidate.superseded &&
        (candidate.state === "pending" ||
          candidate.state === "changes_requested") &&
        (claimed ? (
          <CandidateCorrectionForm
            candidate={candidate}
            onCorrected={onCorrected}
          />
        ) : (
          <Button
            variant="outline"
            disabled={claim.isPending}
            onClick={() => claim.mutate()}
          >
            شروع اصلاح همین آگهی
          </Button>
        ))}
      {claim.error && <p role="alert">{claim.error.message}</p>}
    </details>
  );
}
