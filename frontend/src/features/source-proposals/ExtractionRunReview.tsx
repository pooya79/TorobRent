import { CandidateEvidence } from "./CandidateEvidence";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import {
  operatorSourceProposalsQueryOptions,
  operatorExternalListingCandidatesQueryOptions,
} from "./queries";
import type { components } from "@/lib/api/schema";

export function ExtractionRunReview({
  run,
  proposalId,
  canApprove,
}: {
  run: components["schemas"]["ExtractionRun"];
  proposalId: string;
  canApprove: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const queryClient = useQueryClient();
  const approval = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/source-proposals/{proposal_id}/runs/{run_id}/approve/",
        {
          params: { path: { proposal_id: proposalId, run_id: run.id } },
          body: { reviewed_revision: run.revision, confirmed: true },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: async () => {
      setConfirmed(false);
      await Promise.all(
        [
          operatorSourceProposalsQueryOptions,
          operatorExternalListingCandidatesQueryOptions,
        ].map((options) =>
          queryClient.invalidateQueries({ queryKey: options.queryKey }),
        ),
      );
    },
  });
  const pending =
    run.candidates?.filter(
      (candidate) =>
        candidate.state === "pending" &&
        Object.keys(candidate.validation_errors ?? {}).length === 0,
    ) ?? [];
  return (
    <section className="grid gap-3" aria-label="بررسی نتایج استخراج">
      <h5 className="font-semibold">نمونه‌های استخراج</h5>
      {run.candidates?.slice(0, 5).map((candidate) => (
        <article key={candidate.id} className="rounded border p-3">
          <p>{candidate.title}</p>
          <a
            href={candidate.external_url}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className="break-all underline"
          >
            {candidate.external_url}
          </a>
          <p>
            متراژ: {candidate.area_sqm?.toLocaleString("fa-IR") ?? "نامشخص"} متر
            · ودیعه:{" "}
            {candidate.deposit_rial == null
              ? "نامشخص"
              : (candidate.deposit_rial / 10).toLocaleString("fa-IR")}{" "}
            تومان · اجاره ماهانه:{" "}
            {candidate.monthly_rent_rial == null
              ? "نامشخص"
              : (candidate.monthly_rent_rial / 10).toLocaleString("fa-IR")}{" "}
            تومان
          </p>
          {Object.values(candidate.validation_errors ?? {})
            .flatMap((value) =>
              Array.isArray(value) ? value.map(String) : [String(value)],
            )
            .map((message, index) => (
              <p key={index}>{String(message)}</p>
            ))}
          <CandidateEvidence candidate={candidate} showValidation={false} />
        </article>
      ))}
      <p>موارد نیازمند اصلاح در بخش بررسی جداگانه آگهی‌ها باقی می‌مانند.</p>
      {canApprove && run.state === "complete" && pending.length > 0 && (
        <>
          <label className="flex items-center gap-2">
            <Input
              type="checkbox"
              className="size-4"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            نمونه‌ها را بررسی و انتشار نتایج معتبر را تأیید می‌کنم
          </label>
          <Button
            disabled={!confirmed || approval.isPending}
            onClick={() => approval.mutate()}
          >
            انتشار همه نتایج معتبر
          </Button>
        </>
      )}
      {approval.isError && (
        <p role="alert">
          {approval.error.message} نتایج را دوباره بارگیری کنید.
        </p>
      )}
      {approval.isSuccess && <p role="status">نتایج معتبر منتشر شد.</p>}
    </section>
  );
}
