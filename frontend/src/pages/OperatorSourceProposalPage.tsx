import { CandidateEvidence } from "@/features/source-proposals/CandidateEvidence";
import { CandidateCorrectionForm } from "@/features/source-proposals/CandidateCorrectionForm";
import { SourceAssignmentSummary } from "@/features/source-proposals/SourceAssignmentSummary";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  claimSourceProposal,
  revokeSourceAssignment,
  startSourceProfileReview,
  releaseSourceProposal,
  claimExternalListingCandidate,
  decideExternalListingCandidate,
  decideSourceProposal,
  operatorExternalListingCandidatesQueryOptions,
  operatorSourceProposalsQueryOptions,
  type ExternalListingCandidate,
  type OperatorSourceProposal,
} from "@/features/source-proposals/queries";
import { SourceProfileReview } from "@/features/source-proposals/SourceProfileReview";
import { DiscoveryEvidence } from "@/features/source-proposals/DiscoveryEvidence";
import { currentUserQuery } from "@/features/session/queries";

import { errorMessage } from "@/lib/api/errors";

const relationshipLabels = {
  website_owner: "مالک وب‌سایت",
  website_manager: "مدیر وب‌سایت",
  authorized_representative: "نماینده مجاز",
};

const inventoryLabels = {
  "1_10": "۱ تا ۱۰",
  "11_50": "۱۱ تا ۵۰",
  "51_200": "۵۱ تا ۲۰۰",
  more_than_200: "بیش از ۲۰۰",
  unknown: "نامشخص",
};

function ProposalReviewCard({
  proposal,
  onDecisionSuccess,
}: {
  proposal: OperatorSourceProposal;
  onDecisionSuccess: (proposal: OperatorSourceProposal) => void;
}) {
  const [claimed, setClaimed] = useState(false);
  const currentUser = useQuery(currentUserQuery);
  const mayForceRelease = currentUser.data?.operator_capabilities.includes(
    "manage_operator_queues",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const claim = useMutation({
    mutationFn: () => claimSourceProposal(proposal.id),
    onSuccess: () => setClaimed(true),
  });
  const decision = useMutation({
    mutationFn: ({
      kind,
      reason,
    }: {
      kind: "request-changes" | "reject" | "approve";
      reason: string;
    }) =>
      decideSourceProposal(
        proposal.id,
        kind,
        proposal.revision,
        reason,
        proposal.profile_versions?.[0]?.id,
      ),
    onSuccess: (updated) => {
      if (updated.state !== "pending") setClaimed(false);
      onDecisionSuccess(updated);
    },
  });

  const revocation = useMutation({
    mutationFn: () =>
      revokeSourceAssignment(proposal.id, proposal.revision, reason),
    onSuccess: onDecisionSuccess,
  });

  const profileReview = useMutation({
    mutationFn: () => startSourceProfileReview(proposal.id, proposal.revision),
    onSuccess: (updated) => {
      setClaimed(true);
      setConfirmed(false);
      onDecisionSuccess(updated);
    },
  });

  const release = useMutation({
    mutationFn: () =>
      releaseSourceProposal(proposal.id, proposal.revision, reason),
    onSuccess: (updated) => {
      setClaimed(false);
      onDecisionSuccess(updated);
    },
  });

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{proposal.website_name}</h2>
          <Badge variant="secondary">
            نسخه {proposal.revision.toLocaleString("fa-IR")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        {proposal.needs_reconciliation && (
          <Alert>
            <AlertTitle>دامنه تکراری نیازمند تطبیق خصوصی است</AlertTitle>
            <AlertDescription>
              این علامت فقط برای اپراتور نمایش داده می‌شود؛ هویت پیشنهاد دیگر
              افشا نمی‌شود.
            </AlertDescription>
          </Alert>
        )}
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail
            label="نشانی وب‌سایت"
            value={proposal.website_url || "ثبت نشده"}
          />
          <Detail
            label="رابطه نماینده"
            value={
              proposal.relationship
                ? relationshipLabels[proposal.relationship] ||
                  proposal.relationship
                : "ثبت نشده"
            }
          />
          <Detail
            label="موجودی تقریبی"
            value={
              proposal.inventory_range
                ? inventoryLabels[proposal.inventory_range] ||
                  proposal.inventory_range
                : "ثبت نشده"
            }
          />
          <Detail
            label="نقشه یا خوراک"
            value={proposal.sitemap_url || "ثبت نشده"}
          />
          <Detail
            label="اعلام اختیار"
            value={proposal.authority_declared ? "تأیید شده" : "تأیید نشده"}
          />
          <Detail
            label="یادداشت برای اپراتور"
            value={proposal.operator_note || "ثبت نشده"}
          />
        </dl>
        {proposal.assignment && (
          <SourceAssignmentSummary
            assignment={proposal.assignment}
            review={{
              proposalId: proposal.id,
              canApprove:
                proposal.state === "approved" &&
                proposal.assignment.state === "active" &&
                proposal.assignment.review_mode === "approval_required" &&
                currentUser.data?.id === proposal.assignment.review_operator,
            }}
          />
        )}
        {proposal.assignment?.state === "active" &&
          currentUser.data?.operator_capabilities.includes(
            "review_source_proposals",
          ) && (
            <div className="grid gap-3">
              <p className="text-muted-foreground text-sm">
                لغو تخصیص، استخراج را متوقف و آگهی‌ها را ناموجود می‌کند. نماینده
                بعدی باید پیشنهاد تازه ثبت کند و همه مراحل بررسی را بگذراند.
              </p>
              <Label htmlFor={`revoke-${proposal.id}`}>دلیل لغو تخصیص</Label>
              <Input
                id={`revoke-${proposal.id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                variant="destructive"
                disabled={!reason.trim() || revocation.isPending}
                onClick={() => revocation.mutate()}
              >
                لغو تخصیص منبع
              </Button>
              {revocation.error && (
                <p role="alert">
                  {errorMessage(revocation.error, "لغو تخصیص ممکن نشد.")}
                </p>
              )}
            </div>
          )}
        <DiscoveryEvidence proposal={proposal} />
        <SourceProfileReview
          proposal={proposal}
          claimed={claimed}
          onUpdate={onDecisionSuccess}
        />
        {mayForceRelease && !claimed && (
          <div className="grid gap-2">
            <Label htmlFor={`release-${proposal.id}`}>
              دلیل آزادسازی مسئولیت بررسی
            </Label>
            <Input
              id={`release-${proposal.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!reason.trim() || release.isPending}
              onClick={() => release.mutate()}
            >
              آزادسازی اجباری
            </Button>
          </div>
        )}
        {proposal.state === "approved" ? (
          <div className="grid gap-3">
            <p className="text-muted-foreground text-sm">
              اصلاح یک نتیجه از بخش نتایج انجام می‌شود. بررسی تازه پروفایل،
              صفحات منبع را دوباره دریافت می‌کند و انتشار را تا تأیید نسخه تازه
              متوقف می‌کند.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              دریافت دوباره صفحات و بررسی نسخه تازه پروفایل را تأیید می‌کنم.
            </label>
            <Button
              disabled={
                !confirmed ||
                profileReview.isPending ||
                proposal.assignment?.review_operator !== currentUser.data?.id
              }
              onClick={() => profileReview.mutate()}
            >
              آغاز بررسی نسخه تازه پروفایل
            </Button>
            {profileReview.error && (
              <p role="alert">
                {errorMessage(profileReview.error, "آغاز بررسی ممکن نشد.")}
              </p>
            )}
          </div>
        ) : !claimed ? (
          <Button
            onClick={() => claim.mutate()}
            disabled={
              claim.isPending ||
              (mayForceRelease &&
                !currentUser.data?.operator_capabilities.includes(
                  "review_source_proposals",
                ))
            }
          >
            شروع بررسی
          </Button>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              decision.mutate({ kind: "request-changes", reason });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor={`reason-${proposal.id}`}>دلیل تصمیم</Label>
              <Input
                id={`reason-${proposal.id}`}
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              نشانی و اختیار نماینده را بررسی کردم و دریافت صفحات این دامنه را
              تأیید می‌کنم.
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={claim.isPending}
                onClick={() => claim.mutate()}
              >
                تمدید مسئولیت بررسی
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!reason.trim() || release.isPending}
                onClick={() => release.mutate()}
              >
                آزادسازی مسئولیت و رزرو
              </Button>
              <Button
                type="submit"
                variant="outline"
                disabled={decision.isPending}
              >
                درخواست اصلاح
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={decision.isPending}
                onClick={() => decision.mutate({ kind: "reject", reason })}
              >
                رد پیشنهاد
              </Button>
              <Button
                type="button"
                disabled={
                  !confirmed ||
                  decision.isPending ||
                  ["queued", "running", "complete"].includes(
                    proposal.discovery_stage ?? "awaiting_url",
                  )
                }
                onClick={() => decision.mutate({ kind: "approve", reason: "" })}
              >
                تأیید نشانی و شروع کشف
              </Button>
            </div>
          </form>
        )}
        {(claim.error || decision.error || release.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(
                claim.error ?? decision.error ?? release.error,
                "ثبت عملیات ممکن نشد.",
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

function ExternalListingCandidateCard({
  candidate,
  onDecisionSuccess,
}: {
  candidate: ExternalListingCandidate;
  onDecisionSuccess: (candidateId: string) => void;
}) {
  const [claimed, setClaimed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const claim = useMutation({
    mutationFn: () => claimExternalListingCandidate(candidate.id),
    onSuccess: () => setClaimed(true),
  });
  const decision = useMutation({
    mutationFn: (kind: "request-changes" | "reject" | "approve") =>
      decideExternalListingCandidate(
        candidate.id,
        kind,
        candidate.revision,
        reason,
      ),
    onSuccess: () => onDecisionSuccess(candidate.id),
  });

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{candidate.title}</h3>
          <div className="flex gap-2">
            <Badge variant="secondary">نتیجه استخراج</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Alert>
          <AlertTitle>این آگهی استخراج‌شده هنوز منتشر نشده است</AlertTitle>
          <AlertDescription>
            این آگهی برای بررسی و تصمیم مستقل آماده است.
          </AlertDescription>
        </Alert>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="منبع" value={candidate.source.display_name} />
          <Detail label="دامنه منبع" value={candidate.source.domain} />
          <Detail label="پیوند اصلی آگهی" value={candidate.external_url} />
          <Detail
            label="متراژ"
            value={`${candidate.area_sqm?.toLocaleString("fa-IR") ?? "نامشخص"} متر`}
          />
          <Detail
            label="ودیعه"
            value={`${candidate.deposit_rial == null ? "نامشخص" : (candidate.deposit_rial / 10).toLocaleString("fa-IR")} تومان`}
          />
          <Detail
            label="اجاره ماهانه"
            value={`${candidate.monthly_rent_rial == null ? "نامشخص" : (candidate.monthly_rent_rial / 10).toLocaleString("fa-IR")} تومان`}
          />
        </dl>
        <p className="text-muted-foreground text-sm">{candidate.description}</p>
        <CandidateEvidence candidate={candidate} />
        {claimed && candidate.extraction_run && (
          <CandidateCorrectionForm candidate={candidate} />
        )}
        {!claimed ? (
          <Button
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
            aria-label={`شروع بررسی ${candidate.title}`}
          >
            شروع بررسی آگهی
          </Button>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`candidate-reason-${candidate.id}`}>
                دلیل تصمیم {candidate.title}
              </Label>
              <Input
                id={`candidate-reason-${candidate.id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                aria-label={`تأیید انتشار ${candidate.title}`}
              />
              تأیید می‌کنم این آگهی استخراج‌شده مستقلاً بررسی شده و ادامه آن فقط
              از پیوند اصلی آگهی خواهد بود.
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={decision.isPending}
                onClick={() => decision.mutate("request-changes")}
                aria-label={`درخواست اصلاح ${candidate.title}`}
              >
                درخواست اصلاح
              </Button>
              <Button
                variant="destructive"
                disabled={decision.isPending}
                onClick={() => decision.mutate("reject")}
                aria-label={`رد ${candidate.title}`}
              >
                رد آگهی استخراج‌شده
              </Button>
              <Button
                disabled={
                  !confirmed ||
                  decision.isPending ||
                  candidate.state !== "pending" ||
                  Object.keys(candidate.validation_errors ?? {}).length > 0
                }
                onClick={() => decision.mutate("approve")}
                aria-label={`تأیید و انتشار ${candidate.title}`}
              >
                تأیید و انتشار
              </Button>
            </div>
          </div>
        )}
        {(claim.error || decision.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(
                claim.error ?? decision.error,
                "ثبت تصمیم آگهی ممکن نشد.",
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function OperatorSourceProposalPage() {
  const queryClient = useQueryClient();
  const [completed, setCompleted] = useState(false);
  const [listingCompleted, setListingCompleted] = useState(false);
  const proposals = useQuery(operatorSourceProposalsQueryOptions);
  const currentUser = useQuery(currentUserQuery);
  const mayReview =
    currentUser.data?.operator_capabilities.includes(
      "review_source_proposals",
    ) ?? true;
  const candidates = useQuery({
    ...operatorExternalListingCandidatesQueryOptions,
    enabled: mayReview,
  });
  const removeCompletedProposal = (updated: OperatorSourceProposal) => {
    queryClient.setQueryData<OperatorSourceProposal[]>(
      operatorSourceProposalsQueryOptions.queryKey,
      (current) =>
        current?.flatMap((proposal) =>
          proposal.id !== updated.id
            ? [proposal]
            : updated.state === "pending"
              ? [updated]
              : [],
        ),
    );
    setCompleted(true);
    void queryClient.invalidateQueries({
      queryKey: operatorExternalListingCandidatesQueryOptions.queryKey,
    });
  };
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
      <header className="mb-8 border-b pb-6">
        <p className="text-primary text-sm font-semibold">فضای اپراتور</p>
        <h1 className="mt-2 text-3xl font-semibold">
          اعتبارسنجی درخواست‌های ثبت منبع
        </h1>
      </header>
      {proposals.isPending && <p role="status">در حال بارگذاری…</p>}
      {proposals.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            صف درخواست‌های ثبت منبع بارگذاری نشد.
          </AlertDescription>
        </Alert>
      )}
      {completed && <p role="status">تصمیم ثبت شد.</p>}
      {proposals.data?.length === 0 && (
        <p>درخواست ثبت منبع در انتظار بررسی وجود ندارد.</p>
      )}
      <div className="grid gap-6">
        {proposals.data?.map((proposal) => (
          <ProposalReviewCard
            key={proposal.id}
            proposal={proposal}
            onDecisionSuccess={removeCompletedProposal}
          />
        ))}
      </div>
      {mayReview && (
        <section className="mt-12" aria-labelledby="external-candidate-heading">
          <header className="mb-6 border-b pb-6">
            <h2
              id="external-candidate-heading"
              className="text-2xl font-semibold"
            >
              بررسی مستقل آگهی‌های منابع بیرونی
            </h2>
            <p className="text-muted-foreground mt-2">
              هر آگهی در این بخش به بررسی و تصمیم جداگانه نیاز دارد.
            </p>
          </header>
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
          {candidates.data?.length === 0 && (
            <p>آگهی منبع بیرونی در انتظار بررسی وجود ندارد.</p>
          )}
          <div className="grid gap-6">
            {candidates.data?.map((candidate) => (
              <ExternalListingCandidateCard
                key={candidate.id}
                candidate={candidate}
                onDecisionSuccess={removeCompletedCandidate}
              />
            ))}
          </div>
        </section>
      )}
    </PageMain>
  );
}
