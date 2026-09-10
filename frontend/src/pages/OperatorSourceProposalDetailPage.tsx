import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { Link, useParams, useLocation, useNavigate } from "react-router";
import { PageMain } from "@/components/layout/PageMain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { candidateCanDecide } from "@/features/source-proposals/external-listing-workflow";
import {
  ExternalListingCandidateCard,
  ProposalReviewCard,
} from "@/features/source-proposals/OperatorReviewCards";
import {
  operatorSourceContextQueryOptions,
  type OperatorSourceProposal,
} from "@/features/source-proposals/queries";
import {
  sourceDomain,
  sourceWorkflow,
} from "@/features/source-proposals/operator-workflow";
import { currentUserQuery } from "@/features/session/queries";
import {
  caseSections,
  type CaseSectionId,
} from "@/features/source-proposals/case-sections";
export function OperatorSourceProposalDetailPage({
  proposalId: explicitId,
}: {
  proposalId?: string;
}) {
  const { proposalId } = useParams();
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const activeSection: CaseSectionId =
    caseSections.find((section) => `#${section.id}` === hash)?.id ??
    (hash.startsWith("#source-profile-") ? "profile" : "overview");
  const selectSection = (section: CaseSectionId) => {
    void navigate(`${pathname}${search}#${section}`, {
      preventScrollReset: true,
    });
  };
  const id = explicitId ?? proposalId ?? "";
  const options = operatorSourceContextQueryOptions(id);
  const proposals = useQuery({ ...options, enabled: Boolean(id) });
  const currentUser = useQuery(currentUserQuery);
  const queryClient = useQueryClient();
  const [completed, setCompleted] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const proposal = proposals.data?.find((item) => item.id === id);
  const candidateId = new URLSearchParams(search).get("candidate");
  const candidate =
    proposal?.properties?.find((item) => item.id === candidateId) ??
    proposal?.assignment?.recent_requests
      ?.flatMap((request) => request.run?.candidates ?? [])
      .find((item) => item.id === candidateId);
  const closeCandidate = () => {
    const params = new URLSearchParams(search);
    params.delete("candidate");
    void navigate(`${pathname}${params.size ? `?${params}` : ""}#exceptions`, {
      preventScrollReset: true,
    });
  };
  const canReviewCandidate = Boolean(
    candidate &&
    candidateCanDecide(candidate, proposal, currentUser.data?.id) &&
    currentUser.data?.operator_capabilities.includes(
      "review_source_proposals",
    ) &&
    currentUser.data.id !== proposal?.submitter?.id &&
    !proposal?.assignment?.source.processing_paused &&
    candidate.is_current !== false &&
    !candidate.superseded &&
    (candidate.state === "pending" || candidate.state === "changes_requested"),
  );
  useEffect(() => {
    const revealTab = () =>
      document.getElementById(`tab-${activeSection}`)?.scrollIntoView?.({
        behavior: "instant",
        block: "nearest",
        inline: "nearest",
      });
    revealTab();
    window.addEventListener("resize", revealTab);
    return () => window.removeEventListener("resize", revealTab);
  }, [activeSection, proposal?.id]);
  const update = (updated: OperatorSourceProposal) => {
    queryClient.setQueryData<OperatorSourceProposal[]>(
      options.queryKey,
      (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)),
    );
    setCompleted(true);
    void queryClient.invalidateQueries({
      queryKey: ["operator-source-proposals"],
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: ["operator-external-listing-candidates"],
    });
  };
  return (
    <PageMain className="py-5">
      <Link
        className="text-primary text-sm underline underline-offset-4"
        to="/operator/source-proposals"
      >
        بازگشت به صف منابع
      </Link>
      {proposals.isPending && (
        <p role="status" className="mt-8">
          در حال بارگذاری پرونده…
        </p>
      )}
      {proposals.isError && (
        <div role="alert" className="mt-8">
          پرونده بارگذاری نشد.{" "}
          <Button variant="outline" onClick={() => void proposals.refetch()}>
            تلاش دوباره
          </Button>
        </div>
      )}
      {proposals.isSuccess && !proposal && (
        <p className="mt-8">پرونده پیدا نشد یا به آن دسترسی ندارید.</p>
      )}
      {proposal && (
        <>
          <header className="my-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">
                  {proposal.website_name || "پرونده منبع"}
                </h1>
                <Badge variant="secondary">
                  {sourceWorkflow(proposal).stage}
                </Badge>
              </div>
              <p
                className="text-muted-foreground mt-2 text-end break-all"
                dir="ltr"
              >
                {sourceDomain(proposal)}
              </p>
              <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-sm">
                ارسال‌کننده:{" "}
                <span className="text-foreground">
                  {proposal.submitter?.display_name ||
                    proposal.submitter?.account_label ||
                    "حساب حذف شده"}
                </span>
                {proposal.submitter?.display_name && (
                  <bdi className="text-xs">
                    {proposal.submitter.account_label}
                  </bdi>
                )}
              </p>
            </div>
            {currentUser.data?.operator_capabilities.includes(
              "review_source_proposals",
            ) &&
              activeSection !== "exceptions" && (
                <Button asChild variant="outline">
                  <Link to={`${pathname}#exceptions`}>آگهی‌های این منبع</Link>
                </Button>
              )}
          </header>
          {completed && (
            <p role="status" className="bg-primary/10 mb-4 rounded-lg p-3">
              تصمیم ثبت شد.
            </p>
          )}
          {activeSection !== sourceWorkflow(proposal).section && (
            <div className="bg-primary/5 border-primary/15 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground text-xs">
                  اقدام بعدی
                </span>
                <p className="text-sm font-medium">
                  {sourceWorkflow(proposal).action}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  selectSection(
                    sourceWorkflow(proposal).section as CaseSectionId,
                  )
                }
              >
                رفتن به اقدام بعدی
              </Button>
            </div>
          )}
          <div className="bg-background sticky top-18 z-20 mb-5 rounded-xl border p-1.5 lg:top-0">
            <div
              role="tablist"
              aria-label="بخش‌های پرونده"
              className="flex gap-1 overflow-x-auto"
            >
              {caseSections.map(
                ({ id: sectionId, label, icon: Icon }, index) => (
                  <button
                    key={sectionId}
                    id={`tab-${sectionId}`}
                    type="button"
                    role="tab"
                    aria-selected={activeSection === sectionId}
                    aria-controls={`panel-${sectionId}`}
                    tabIndex={activeSection === sectionId ? 0 : -1}
                    onClick={() => selectSection(sectionId)}
                    onKeyDown={(event) => {
                      const offset =
                        event.key === "ArrowLeft"
                          ? 1
                          : event.key === "ArrowRight"
                            ? -1
                            : 0;
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? caseSections.length - 1
                            : offset
                              ? (index + offset + caseSections.length) %
                                caseSections.length
                              : -1;
                      if (next < 0) return;
                      event.preventDefault();
                      const section = caseSections[next]!;
                      selectSection(section.id);
                      document.getElementById(`tab-${section.id}`)?.focus();
                    }}
                    className={`focus-visible:outline-ring flex min-h-12 min-w-max flex-none items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 lg:flex-1 ${activeSection === sectionId ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>
          <Dialog
            open={Boolean(candidateId)}
            onOpenChange={(open) => {
              if (!open) closeCandidate();
            }}
          >
            <DialogContent
              className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto"
              onOpenAutoFocus={() => {
                returnFocus.current = document.activeElement as HTMLElement;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                (returnFocus.current?.isConnected
                  ? returnFocus.current
                  : document.getElementById("tab-exceptions")
                )?.focus();
              }}
            >
              <DialogTitle className="pe-10">
                {candidate?.title || "بررسی ملک"}
              </DialogTitle>
              <DialogDescription>
                نتیجه دریافت‌شده از {proposal.website_name}؛ اصلاح و تصمیم فقط
                برای همین صفحه اعمال می‌شود.
              </DialogDescription>
              {candidate ? (
                <>
                  {!canReviewCandidate &&
                    candidate.state !== "published" &&
                    candidate.state !== "rejected" &&
                    candidate.state !== "cancelled" && (
                      <p
                        role="status"
                        className="rounded-lg border p-3 text-sm"
                      >
                        {candidate.is_current === false || candidate.superseded
                          ? "این نتیجه متعلق به استخراج غیرفعال یا قدیمی است؛ برای پیگیری، وضعیت پردازش منبع را ببینید."
                          : "برای تصمیم‌گیری، پردازش باید فعال باشد و شما اپراتور مسئول این منبع باشید."}
                      </p>
                    )}
                  <ExternalListingCandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    canDecide={canReviewCandidate}
                    onDecisionSuccess={() => {
                      void queryClient.invalidateQueries({
                        queryKey: ["operator-source-proposals"],
                      });
                      void queryClient.invalidateQueries({
                        queryKey: ["operator-external-listing-candidates"],
                      });
                      setCompleted(true);
                      closeCandidate();
                    }}
                  />
                </>
              ) : (
                <p role="status">
                  این ملک پیدا نشد یا با نتیجه تازه جایگزین شده است. فهرست
                  ملک‌های وب‌سایت را بررسی کنید.
                </p>
              )}
              <Button variant="outline" onClick={closeCandidate}>
                بازگشت به ملک‌های وب‌سایت
              </Button>
            </DialogContent>
          </Dialog>
          <ProposalReviewCard
            key={proposal.id}
            proposal={proposal}
            statusUpdatedAt={proposals.dataUpdatedAt}
            statusStale={proposals.isRefetchError}
            activeSection={activeSection}
            onSectionChange={selectSection}
            onDecisionSuccess={update}
          />
        </>
      )}
    </PageMain>
  );
}
