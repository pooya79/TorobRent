import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExternalListingCandidateCard } from "@/features/source-proposals/OperatorReviewCards";
import {
  operatorExternalListingCandidatesQueryOptions,
  operatorSourceProposalsQueryOptions,
  type ExternalListingCandidate,
} from "@/features/source-proposals/queries";
import { currentUserQuery } from "@/features/session/queries";
export function OperatorExternalListingsPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [listingCompleted, setListingCompleted] = useState(false);
  const currentUser = useQuery(currentUserQuery);
  const mayReview =
    currentUser.data?.operator_capabilities.includes(
      "review_source_proposals",
    ) ?? false;
  const proposals = useQuery({
    ...operatorSourceProposalsQueryOptions,
    enabled: mayReview,
  });
  const candidates = useQuery({
    ...operatorExternalListingCandidatesQueryOptions,
    enabled: mayReview,
  });
  const visibleCandidates = candidates.data?.filter(
    (candidate) =>
      !searchParams.get("proposal") ||
      candidate.source_proposal_id === searchParams.get("proposal"),
  );
  const removeCompletedCandidate = (candidateId: string) => {
    queryClient.setQueryData<ExternalListingCandidate[]>(
      operatorExternalListingCandidatesQueryOptions.queryKey,
      (current) => current?.filter((candidate) => candidate.id !== candidateId),
    );
    setListingCompleted(true);
    void queryClient.invalidateQueries({
      queryKey: operatorSourceProposalsQueryOptions.queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: operatorExternalListingCandidatesQueryOptions.queryKey,
    });
  };

  return (
    <PageMain>
      <header>
        <p className="text-info text-sm font-semibold">فضای اپراتور</p>
        <h1
          id="external-candidate-heading"
          className="mt-2 text-3xl font-semibold"
        >
          آگهی‌های استخراج‌شده
        </h1>
        <p className="text-muted-foreground mt-3">
          شواهد هر آگهی را بررسی کنید و درباره انتشار آن تصمیم بگیرید.
        </p>
        <Link
          className="text-primary mt-4 inline-block underline"
          to="/operator/source-proposals"
        >
          رفتن به صف منابع
        </Link>
        {searchParams.get("proposal") && (
          <p className="mt-3">
            نمایش آگهی‌های یک منبع ·{" "}
            <Link
              className="text-primary underline"
              to="/operator/external-listings"
            >
              نمایش همه آگهی‌ها
            </Link>
          </p>
        )}
      </header>{" "}
      {mayReview && (
        <section className="mt-12" aria-labelledby="external-candidate-heading">
          {candidates.isPending && (
            <p role="status">در حال بارگذاری آگهی‌ها…</p>
          )}
          {candidates.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                صف آگهی‌های منابع بیرونی بارگذاری نشد.
              </AlertDescription>
            </Alert>
          )}
          {listingCompleted && <p role="status">تصمیم آگهی ثبت شد.</p>}
          {visibleCandidates?.length === 0 && (
            <p>آگهی منبع بیرونی در انتظار بررسی وجود ندارد.</p>
          )}
          <div className="grid gap-6">
            {visibleCandidates?.map((candidate) => (
              <ExternalListingCandidateCard
                key={candidate.id}
                candidate={candidate}
                canDecide={
                  !candidate.extraction_run ||
                  Boolean(
                    proposals.data?.some(
                      (proposal) =>
                        proposal.id === candidate.source_proposal_id &&
                        proposal.assignment?.state === "active" &&
                        proposal.assignment.review_operator ===
                          currentUser.data?.id,
                    ),
                  )
                }
                onDecisionSuccess={removeCompletedCandidate}
              />
            ))}
          </div>
        </section>
      )}
    </PageMain>
  );
}
