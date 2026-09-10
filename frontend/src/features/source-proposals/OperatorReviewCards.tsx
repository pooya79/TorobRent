import { SourceProcessingStatus } from "./SourceProcessingStatus";
import { caseSections, type CaseSectionId } from "./case-sections";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  UserRound,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { SourceProcessingPanel } from "@/features/source-proposals/SourceProcessingPanel";
import { SourceConversationButton } from "@/features/source-proposals/SourceConversationButton";
import { SourceExclusionsPanel } from "@/features/source-proposals/SourceExclusionsPanel";
import { SourcePublicationModePanel } from "@/features/source-proposals/SourcePublicationModePanel";
import { SourceResponsibilityPanel } from "@/features/source-proposals/SourceResponsibilityPanel";
import { CandidateEvidence } from "@/features/source-proposals/CandidateEvidence";
import { CandidateCorrectionForm } from "@/features/source-proposals/CandidateCorrectionForm";
import { ExtractionHistory } from "./ExtractionHistory";
import { SourceExceptionsPanel } from "./SourceExceptionsPanel";
import { SourceBulkActions } from "./SourceBulkActions";
import { SourceExclusionsSummary } from "./SourceExclusionsPanel";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  useEffect,
  useState,
  createContext,
  useContext,
} from "react";
import { Link } from "react-router";

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
  type ExternalListingCandidate,
  type OperatorSourceProposal,
} from "@/features/source-proposals/queries";
import { SourceProfileReview } from "@/features/source-proposals/SourceProfileReview";
import { DiscoveryEvidence } from "@/features/source-proposals/DiscoveryEvidence";
import { currentUserQuery } from "@/features/session/queries";

import { errorMessage } from "@/lib/api/errors";
import { candidateStatus } from "./external-listing-workflow";

import { proposalStateLabels } from "@/features/source-proposals/operator-workflow";
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

const ActiveSectionContext = createContext<CaseSectionId>("overview");

export function ProposalReviewCard({
  proposal,
  activeSection,
  onSectionChange,
  onDecisionSuccess,
  statusUpdatedAt,
  statusStale,
}: {
  proposal: OperatorSourceProposal;
  statusUpdatedAt?: number;
  statusStale?: boolean;
  activeSection: CaseSectionId;
  onSectionChange: (section: CaseSectionId) => void;
  onDecisionSuccess: (proposal: OperatorSourceProposal) => void;
}) {
  const [resultView, setResultView] = useState("runs");
  const [claimed, setClaimed] = useState(false);
  const [claimExpiresAt, setClaimExpiresAt] = useState<string>();
  const [claimExpired, setClaimExpired] = useState(false);
  useEffect(() => {
    if (!claimed || !claimExpiresAt) return;
    const timer = window.setTimeout(
      () => {
        setClaimed(false);
        setClaimExpired(true);
      },
      Math.max(0, Date.parse(claimExpiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [claimed, claimExpiresAt]);
  const currentUser = useQuery(currentUserQuery);
  const mayForceRelease = currentUser.data?.operator_capabilities.includes(
    "manage_operator_queues",
  );
  const canDecideSource = Boolean(
    currentUser.data?.operator_capabilities.includes(
      "review_source_proposals",
    ) && currentUser.data?.id === proposal.assignment?.review_operator,
  );
  const canReview = Boolean(
    currentUser.data?.operator_capabilities.includes(
      "review_source_proposals",
    ) &&
    (proposal.assignment?.state !== "active" || canDecideSource),
  );
  const [maxPages, setMaxPages] = useState("");
  const [targetDetailPages, setTargetDetailPages] = useState("");
  const validLimits =
    Number.isInteger(Number(maxPages)) &&
    Number.isInteger(Number(targetDetailPages)) &&
    Number(targetDetailPages) > 0 &&
    Number(maxPages) >= Number(targetDetailPages) &&
    Number(maxPages) <= 2147483647;
  const discoveryStarted = ["queued", "running", "complete"].includes(
    proposal.discovery_stage ?? "awaiting_url",
  );
  const limitsHint = validLimits
    ? "حدود بررسی آماده است."
    : Number(maxPages) > 2147483647
      ? "عدد کوچکتری برای سقف صفحات وارد کنید."
      : !maxPages || !targetDetailPages
        ? "سقف صفحات و تعداد آگهی هدف را وارد کنید تا تأیید فعال شود."
        : "عددهای صحیح و مثبت وارد کنید؛ تعداد آگهی هدف نباید از سقف صفحات بیشتر باشد.";
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const claim = useMutation({
    mutationFn: () => claimSourceProposal(proposal.id),
    onSuccess: (reviewClaim) => {
      setClaimExpiresAt(reviewClaim.expires_at);
      setClaimExpired(false);
      setClaimed(true);
    },
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
        {
          max_pages: Number(maxPages),
          target_detail_pages: Number(targetDetailPages),
        },
      ),
    onSuccess: (updated) => {
      if (updated.state !== "pending") setClaimed(false);
      onDecisionSuccess(updated);
    },
  });

  const [revocationReason, setRevocationReason] = useState("");
  const revocation = useMutation({
    mutationFn: () =>
      revokeSourceAssignment(proposal.id, proposal.revision, revocationReason),
    onSuccess: onDecisionSuccess,
  });

  const profileReview = useMutation({
    mutationFn: () =>
      startSourceProfileReview(proposal.id, proposal.revision, {
        max_pages: Number(maxPages),
        target_detail_pages: Number(targetDetailPages),
      }),
    onSuccess: (updated) => {
      setClaimed(false);
      setClaimExpired(false);
      setConfirmed(false);
      onDecisionSuccess(updated);
      claim.mutate();
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
    <ActiveSectionContext value={activeSection}>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-5 sm:p-6">
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
          {proposal.state === "pending" && (claimed || claimExpired) && (
            <div
              role="status"
              className="bg-primary/5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div className="grid gap-1 text-sm">
                <p className="font-medium">
                  {claimExpired
                    ? "مهلت بررسی شما تمام شد."
                    : "بررسی این پرونده را پذیرفته‌اید."}
                </p>
                {claimed && claimExpiresAt && (
                  <p>
                    مهلت بررسی:{" "}
                    <time dateTime={claimExpiresAt}>
                      {new Date(claimExpiresAt).toLocaleString("fa-IR")}
                    </time>
                  </p>
                )}
                <p className="text-muted-foreground">
                  رزرو بررسی ۱۵ دقیقه اعتبار دارد. پس از پایان مهلت، برای ثبت
                  تصمیم باید دوباره بررسی را بپذیرید. مسئولیت منبع با پایان این
                  مهلت تغییر نمی‌کند.
                </p>
              </div>
              {canReview && (
                <Button
                  variant="outline"
                  disabled={claim.isPending}
                  onClick={() => claim.mutate()}
                >
                  {claimExpired ? "پذیرش دوباره بررسی" : "تمدید مهلت بررسی"}
                </Button>
              )}
            </div>
          )}
          <CaseSection id="overview" title="نمای کلی و اعلام نماینده">
            {proposal.current_website_conflict && (
              <Alert variant="destructive">
                <AlertTitle>تعارض وب‌سایت‌های جاری ارسال‌کننده</AlertTitle>
                <AlertDescription>
                  پیش از تأیید، با نماینده برای بستن پیشنهادهای اضافی یا لغو
                  صریح تخصیص‌های اضافی هماهنگ کنید. سوابق حفظ می‌شوند.
                </AlertDescription>
              </Alert>
            )}
            {proposal.needs_reconciliation && (
              <Alert>
                <AlertTitle>دامنه تکراری نیازمند تطبیق خصوصی است</AlertTitle>
                <AlertDescription>
                  این علامت فقط برای اپراتور نمایش داده می‌شود؛ هویت پیشنهاد
                  دیگر افشا نمی‌شود.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="bg-muted/30 rounded-xl border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium">
                  <UserRound
                    className="text-primary size-4"
                    aria-hidden="true"
                  />
                  ارسال‌کننده و نماینده منبع
                </div>
                <p className="font-semibold">
                  {proposal.submitter?.display_name ||
                    proposal.submitter?.account_label ||
                    "حساب حذف شده"}
                </p>
                {proposal.submitter?.display_name && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    <bdi>{proposal.submitter.account_label}</bdi>
                  </p>
                )}
                <p className="text-muted-foreground mt-3 text-sm">
                  <span>
                    {proposal.relationship
                      ? relationshipLabels[proposal.relationship]
                      : "رابطه اعلام نشده"}
                  </span>{" "}
                  ·{" "}
                  {proposal.authority_declared
                    ? "اختیار اعلام شده"
                    : "اختیار اعلام نشده"}
                </p>
              </div>
              <div className="bg-muted/30 rounded-xl border p-4">
                <div className="mb-3 flex items-center gap-2 font-medium">
                  <ShieldCheck
                    className="text-info size-4"
                    aria-hidden="true"
                  />
                  اپراتور مسئول بررسی
                </div>
                <p className="font-semibold">
                  <bdi>
                    {proposal.responsibility?.operator_label ||
                      "مسئول تعیین نشده"}
                  </bdi>
                </p>
                <p className="text-muted-foreground mt-2 text-sm">
                  تصمیم‌های منبع و پیگیری نتایج به اپراتور مسئول تعلق دارد.
                </p>
                <Button
                  variant="link"
                  className="mt-1 h-auto p-0"
                  onClick={() => onSectionChange("responsibility")}
                >
                  مشاهده مسئولیت <ArrowLeft aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: "نشانی و اختیار",
                  done: !["awaiting_url", "released"].includes(
                    proposal.discovery_stage ?? "awaiting_url",
                  ),
                  section: "url" as const,
                },
                {
                  label: "کشف صفحات",
                  done: proposal.discovery_stage === "complete",
                  section: "url" as const,
                },
                {
                  label: "پروفایل فعال",
                  done: Boolean(proposal.assignment?.active_profile_version),
                  section: "profile" as const,
                },
              ].map((step, index) => (
                <button
                  key={step.label}
                  type="button"
                  onClick={() => onSectionChange(step.section)}
                  className="hover:bg-muted focus-visible:outline-ring flex items-center gap-3 rounded-xl border p-4 text-start focus-visible:outline-2"
                >
                  {step.done ? (
                    <CheckCircle2
                      className="text-info size-5"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleDashed
                      className="text-muted-foreground size-5"
                      aria-hidden="true"
                    />
                  )}
                  <span>
                    <span className="text-muted-foreground text-xs">
                      مرحله {(index + 1).toLocaleString("fa-IR")}
                    </span>
                    <span className="mt-1 block text-sm font-medium">
                      {step.label}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <dl className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
              <Detail
                label="نشانی وب‌سایت"
                value={proposal.website_url || "ثبت نشده"}
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
                label="یادداشت برای اپراتور"
                value={proposal.operator_note || "ثبت نشده"}
              />
            </dl>
          </CaseSection>
          <CaseSection id="url" title="تأیید نشانی و کشف صفحات">
            <div className="grid items-start gap-5 xl:grid-cols-2">
              <div className="min-w-0">
                <DiscoveryEvidence proposal={proposal} />
              </div>
              <div className="grid min-w-0 gap-4">
                <p className="text-muted-foreground text-sm">
                  ابتدا نشانی و اختیار نماینده را بررسی کنید، سپس حدود بررسی را
                  وارد کنید و دریافت صفحات را تأیید کنید. پس از کشف صفحات، روش
                  استخراج را در تب پروفایل بررسی می‌کنید؛ این مرحله هنوز آگهی
                  منتشر نمی‌کند.
                </p>
                {!canReview && (
                  <p role="status" className="text-sm">
                    برای ثبت تصمیم به دسترسی بررسی منابع و، برای منابع فعال،
                    مسئولیت این منبع نیاز دارید.
                  </p>
                )}
                {(claimed || proposal.state === "approved") &&
                  (proposal.state === "approved" || !discoveryStarted) && (
                    <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
                      <legend className="px-1 font-medium">
                        ۱. حدود بررسی سایت
                      </legend>
                      <p className="text-muted-foreground text-sm sm:col-span-2">
                        موجودی تقریبی اعلام‌شده:{" "}
                        {inventoryLabels[proposal.inventory_range || "unknown"]}
                        . با توجه به این برآورد، حدود بررسی را تعیین کنید. کشف
                        با رسیدن به هر کدام از این حدود یا پایان لینک‌های قابل
                        بررسی متوقف می‌شود.
                      </p>
                      <div className="grid gap-2">
                        <Label htmlFor={`max-pages-${proposal.id}`}>
                          سقف صفحات قابل بررسی
                        </Label>
                        <Input
                          id={`max-pages-${proposal.id}`}
                          type="number"
                          min={1}
                          max={2147483647}
                          step={1}
                          aria-describedby={`limits-hint-${proposal.id}`}
                          required
                          value={maxPages}
                          onChange={(event) => setMaxPages(event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`target-pages-${proposal.id}`}>
                          تعداد آگهی اجاره هدف
                        </Label>
                        <Input
                          id={`target-pages-${proposal.id}`}
                          type="number"
                          min={1}
                          max={Number(maxPages) || undefined}
                          step={1}
                          aria-describedby={`limits-hint-${proposal.id}`}
                          required
                          value={targetDetailPages}
                          onChange={(event) =>
                            setTargetDetailPages(event.target.value)
                          }
                        />
                      </div>
                      <p
                        id={`limits-hint-${proposal.id}`}
                        aria-live="polite"
                        className="text-sm sm:col-span-2"
                      >
                        {limitsHint}
                      </p>
                      <p className="text-muted-foreground text-sm sm:col-span-2">
                        تعداد آگهی هدف نباید از سقف صفحات بیشتر باشد. صفحات
                        فهرست هم در سقف صفحات حساب می‌شوند. پردازش طولانی با
                        ذخیره پیشرفت ادامه می‌یابد. استخراج‌های بعدی هم از همین
                        حدود استفاده می‌کنند.
                      </p>
                    </fieldset>
                  )}
                {proposal.state !== "pending" ? (
                  <div className="grid gap-3">
                    <p className="text-muted-foreground text-sm">
                      اصلاح یک نتیجه از بخش نتایج انجام می‌شود. بررسی تازه
                      پروفایل، صفحات منبع را دوباره دریافت می‌کند. پروفایل فعال
                      تا تأیید نسخه تازه برقرار می‌ماند؛ توقف پردازش کنترل
                      جداگانه دارد.
                    </p>

                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      دریافت دوباره صفحات و بررسی نسخه تازه پروفایل را تأیید
                      می‌کنم.
                    </label>
                    <p
                      id={`profile-start-help-${proposal.id}`}
                      aria-live="polite"
                      className="text-sm"
                    >
                      {proposal.state !== "approved"
                        ? "این پرونده در انتظار تأیید نیست. وضعیت و دلیل تصمیم را در تب تاریخچه ببینید."
                        : !canDecideSource
                          ? "شروع بررسی تازه فقط برای اپراتور مسئول منبع با دسترسی بررسی منابع ممکن است."
                          : proposal.current_website_conflict
                            ? "ابتدا تعارض وب‌سایت را در تب نمای کلی برطرف کنید."
                            : !validLimits
                              ? limitsHint
                              : "برای شروع، دریافت دوباره صفحات را تأیید کنید."}
                    </p>
                    <Button
                      aria-describedby={`profile-start-help-${proposal.id}`}
                      disabled={
                        proposal.state !== "approved" ||
                        !confirmed ||
                        !validLimits ||
                        proposal.current_website_conflict ||
                        profileReview.isPending ||
                        !canDecideSource
                      }
                      onClick={() => profileReview.mutate()}
                    >
                      آغاز بررسی نسخه تازه پروفایل
                    </Button>
                    {profileReview.error && (
                      <p role="alert">
                        {errorMessage(
                          profileReview.error,
                          "آغاز بررسی ممکن نشد.",
                        )}
                      </p>
                    )}
                  </div>
                ) : !claimed || !canReview ? (
                  <Button
                    onClick={() => claim.mutate()}
                    disabled={
                      !canReview ||
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
                      if (reason.trim())
                        decision.mutate({ kind: "request-changes", reason });
                    }}
                  >
                    <p
                      id={`approval-help-${proposal.id}`}
                      aria-live="polite"
                      className="text-sm"
                    >
                      {proposal.current_website_conflict
                        ? "ابتدا تعارض وب‌سایت را در تب نمای کلی برطرف کنید."
                        : discoveryStarted
                          ? "نشانی قبلاً تأیید شده است. پس از پایان کشف، بررسی را در تب پروفایل ادامه دهید."
                          : !validLimits
                            ? limitsHint
                            : !confirmed
                              ? "برای فعال شدن تأیید، بررسی نشانی و اختیار نماینده را علامت بزنید."
                              : "آماده شروع کشف صفحات. تأیید نهایی روش استخراج در مرحله بعد انجام می‌شود."}
                    </p>
                    {discoveryStarted && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onSectionChange("profile")}
                      >
                        رفتن به بررسی پروفایل
                      </Button>
                    )}
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      نشانی و اختیار نماینده را بررسی کردم و دریافت صفحات این
                      دامنه را تأیید می‌کنم.
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={
                          !confirmed ||
                          !validLimits ||
                          proposal.current_website_conflict ||
                          decision.isPending ||
                          discoveryStarted
                        }
                        aria-describedby={`approval-help-${proposal.id}`}
                        onClick={() =>
                          decision.mutate({ kind: "approve", reason: "" })
                        }
                      >
                        تأیید نشانی و شروع کشف
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-3 border-t pt-4">
                      <h3 className="text-sm font-medium">
                        اصلاح، رد یا انصراف از بررسی
                      </h3>
                      <div className="grid gap-2">
                        <p className="text-muted-foreground text-sm">
                          دلیل فقط برای درخواست اصلاح، رد یا انصراف لازم است؛
                          تأیید نشانی به دلیل نیاز ندارد.
                        </p>
                        <Label htmlFor={`reason-${proposal.id}`}>
                          دلیل تصمیم
                        </Label>
                        <Input
                          id={`reason-${proposal.id}`}
                          name="reason"
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!reason.trim() || release.isPending}
                          onClick={() => release.mutate()}
                        >
                          انصراف از بررسی و آزادسازی رزرو
                        </Button>
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={!reason.trim() || decision.isPending}
                        >
                          درخواست اصلاح
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={!reason.trim() || decision.isPending}
                          onClick={() =>
                            decision.mutate({ kind: "reject", reason })
                          }
                        >
                          رد پیشنهاد
                        </Button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </CaseSection>
          <CaseSection id="profile" title="پروفایل منبع">
            {!proposal.profile_versions?.length &&
              !proposal.discovery?.evidence.profile_failure && (
                <p className="text-muted-foreground text-sm">
                  پروفایل پس از تأیید نشانی و پایان کشف صفحات آماده بررسی
                  می‌شود.
                </p>
              )}
            {proposal.state === "pending" &&
              proposal.profile_versions?.length > 0 &&
              !claimed &&
              canReview && (
                <Button
                  className="justify-self-start"
                  onClick={() => claim.mutate()}
                  disabled={claim.isPending}
                >
                  پذیرش بررسی پروفایل
                </Button>
              )}{" "}
            <div id={`source-profile-${proposal.id}`} />
            <SourceProfileReview
              proposal={proposal}
              claimed={claimed && canReview}
              onUpdate={onDecisionSuccess}
            />
          </CaseSection>
          <CaseSection id="responsibility" title="تخصیص و مسئولیت">
            {" "}
            {mayForceRelease && proposal.state === "pending" && !claimed && (
              <details className="rounded-xl border p-4">
                <summary className="cursor-pointer font-medium">
                  آزادسازی رزرو بررسی
                </summary>
                <div className="mt-4 grid gap-3">
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
              </details>
            )}
            {!proposal.assignment && (
              <p className="text-muted-foreground text-sm">
                هنوز تخصیص فعالی برای این منبع ثبت نشده است. بررسی اولیه را از
                بخش نشانی و کشف شروع کنید.
              </p>
            )}{" "}
            <SourceResponsibilityPanel
              proposal={proposal}
              canManage={Boolean(mayForceRelease)}
              onUpdate={(updated) => {
                setClaimed(false);
                onDecisionSuccess(updated);
              }}
            />
            {proposal.assignment?.state === "active" && canDecideSource && (
              <details className="border-destructive/30 rounded-xl border p-4">
                <summary className="text-destructive cursor-pointer font-medium">
                  لغو تخصیص و توقف همکاری
                </summary>
                <div className="mt-4 grid gap-3">
                  <p className="text-muted-foreground text-sm">
                    لغو تخصیص، پروفایل را غیرفعال، استخراج را متوقف و آگهی‌ها را
                    ناموجود می‌کند. جایگزینی وب‌سایت تنها پس از لغو تخصیص ممکن
                    است. نماینده بعدی باید پیشنهاد تازه ثبت کند و همه مراحل
                    بررسی را بگذراند.
                  </p>
                  <Label htmlFor={`revoke-${proposal.id}`}>
                    دلیل لغو تخصیص
                  </Label>
                  <Input
                    id={`revoke-${proposal.id}`}
                    value={revocationReason}
                    onChange={(event) =>
                      setRevocationReason(event.target.value)
                    }
                  />
                  <Button
                    variant="destructive"
                    disabled={!revocationReason.trim() || revocation.isPending}
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
              </details>
            )}
          </CaseSection>
          <CaseSection id="processing" title="تنظیمات پردازش و انتشار">
            <SourceProcessingStatus
              proposal={proposal}
              updatedAt={statusUpdatedAt}
              stale={statusStale}
              onResults={() => {
                setResultView("runs");
                onSectionChange("exceptions");
              }}
            />
            {proposal.assignment?.state === "active" && !canDecideSource && (
              <p className="text-muted-foreground text-sm">
                مشاهده وضعیت برای شما ممکن است. تغییر تنظیمات فقط برای اپراتور
                مسئول منبع با دسترسی بررسی منابع فعال است.
              </p>
            )}
            <div className="grid items-start gap-5 lg:grid-cols-2">
              {" "}
              {proposal.assignment?.state === "active" && canDecideSource && (
                <SourceProcessingPanel
                  proposal={proposal}
                  onUpdate={onDecisionSuccess}
                />
              )}
              {proposal.state === "approved" &&
                proposal.assignment?.state === "active" &&
                !proposal.assignment.source.processing_paused &&
                canDecideSource && (
                  <SourcePublicationModePanel
                    proposal={proposal}
                    onUpdate={onDecisionSuccess}
                  />
                )}
            </div>
          </CaseSection>
          <CaseSection id="exceptions" title="استثناها و نتایج پردازش">
            {proposal.assignment ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    [
                      "runs",
                      "نوبت‌های استخراج",
                      proposal.assignment.recent_requests?.length ?? 0,
                    ],
                    [
                      "problems",
                      "مشکلات باز",
                      proposal.assignment.exceptions?.filter(
                        (item) => item.state === "open",
                      ).length ?? 0,
                    ],
                    [
                      "exclusions",
                      "محدودیت‌های فعال",
                      proposal.assignment.exclusions?.filter(
                        (item) => item.active,
                      ).length ?? 0,
                    ],
                  ].map(([value, label, count]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={resultView === value}
                      onClick={() => setResultView(String(value))}
                      className={`focus-visible:outline-ring flex items-center justify-between rounded-xl border p-4 text-start focus-visible:outline-2 ${resultView === value ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                    >
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-2xl font-semibold">
                        {Number(count).toLocaleString("fa-IR")}
                      </span>
                    </button>
                  ))}
                </div>
                <div
                  className={resultView === "runs" ? "grid gap-4" : "hidden"}
                >
                  <ExtractionHistory
                    requests={proposal.assignment.recent_requests ?? []}
                    review={{
                      proposalId: proposal.id,
                      canApprove:
                        proposal.assignment.state === "active" &&
                        canDecideSource &&
                        !proposal.assignment.source.processing_paused,
                    }}
                  />
                </div>
                <div
                  className={
                    resultView === "problems" ? "grid gap-4" : "hidden"
                  }
                >
                  <SourceExceptionsPanel
                    exceptions={proposal.assignment.exceptions ?? []}
                    proposalId={proposal.id}
                    operator
                    canRetry={
                      proposal.assignment.state === "active" &&
                      canDecideSource &&
                      !proposal.assignment.source.processing_paused &&
                      Boolean(proposal.assignment.active_profile_version)
                    }
                  />
                  {proposal.assignment.state === "active" &&
                    canDecideSource && (
                      <SourceBulkActions
                        proposalId={proposal.id}
                        pages={proposal.assignment.current_results ?? []}
                      />
                    )}
                </div>
                <div
                  className={
                    resultView === "exclusions" ? "grid gap-4" : "hidden"
                  }
                >
                  {proposal.assignment.state === "active" && canDecideSource ? (
                    <SourceExclusionsPanel
                      proposalId={proposal.id}
                      exclusions={proposal.assignment.exclusions ?? []}
                      onUpdate={onDecisionSuccess}
                    />
                  ) : (
                    <SourceExclusionsSummary
                      exclusions={proposal.assignment.exclusions ?? []}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="bg-muted/30 rounded-xl border border-dashed p-8 text-center">
                <p className="font-medium">هنوز پردازشی انجام نشده است</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  پس از تأیید پروفایل، نتایج استخراج و موارد نیازمند رسیدگی
                  اینجا نمایش داده می‌شود.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => onSectionChange("profile")}
                >
                  رفتن به پروفایل
                </Button>
              </div>
            )}
          </CaseSection>
          <CaseSection id="history" title="گفت‌وگو و تاریخچه">
            {canReview && (
              <SourceConversationButton proposalId={proposal.id} operator />
            )}
            {proposal.history.length === 0 && (
              <p className="text-muted-foreground text-sm">
                رویدادی ثبت نشده است.
              </p>
            )}
            <ol className="grid gap-4">
              {proposal.history.map((event) => (
                <li key={event.id} className="border-s-2 ps-4 text-sm">
                  <p className="font-medium">
                    {proposalStateLabels[event.new_state]} · {event.actor_label}
                  </p>
                  <time
                    className="text-muted-foreground"
                    dateTime={event.created_at}
                  >
                    {new Date(event.created_at).toLocaleString("fa-IR")}
                  </time>
                  {event.reason && (
                    <p className="mt-2 whitespace-pre-wrap">{event.reason}</p>
                  )}
                </li>
              ))}
            </ol>
          </CaseSection>
        </div>
      </div>
    </ActiveSectionContext>
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

export function ExternalListingCandidateCard({
  candidate,
  canDecide,
  onDecisionSuccess,
}: {
  candidate: ExternalListingCandidate;
  canDecide: boolean;
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
            <Badge variant="secondary">{candidateStatus(candidate)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {candidate.source_proposal_id && (
          <Link
            className="text-primary underline underline-offset-4"
            to={`/operator/source-proposals/${candidate.source_proposal_id}`}
          >
            پرونده منبع · {candidate.source.display_name}
          </Link>
        )}
        <Alert>
          <AlertTitle aria-level={4}>
            این آگهی استخراج‌شده هنوز منتشر نشده است
          </AlertTitle>
          <AlertDescription>
            این آگهی برای بررسی و تصمیم مستقل آماده است.
          </AlertDescription>
        </Alert>
        {Object.keys(candidate.validation_errors ?? {}).length > 0 && (
          <Alert variant="destructive">
            <AlertTitle aria-level={4}>
              پیش از انتشار، اطلاعات آگهی را اصلاح کنید
            </AlertTitle>
            <AlertDescription>
              {Object.keys(
                candidate.validation_errors ?? {},
              ).length.toLocaleString("fa-IR")}{" "}
              مورد نیازمند بررسی است. جزئیات در بخش شواهد و اعتبارسنجی آمده است.
            </AlertDescription>
          </Alert>
        )}
        {/^https?:\/\//i.test(candidate.external_url) && (
          <Button asChild variant="outline">
            <a
              href={candidate.external_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              مشاهده آگهی در وب‌سایت منبع <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        )}
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="منبع" value={candidate.source.display_name} />
          <Detail label="دامنه منبع" value={candidate.source.domain} />
          <Detail label="پیوند اصلی آگهی" value={candidate.external_url} />
          <Detail
            label="متراژ"
            value={`${candidate.area_sqm?.toLocaleString("fa-IR") ?? "نامشخص"} متر`}
          />
          <Detail
            label="رهن"
            value={`${candidate.deposit_rial == null ? "نامشخص" : (candidate.deposit_rial / 10).toLocaleString("fa-IR")} تومان`}
          />
          <Detail
            label="اجاره ماهانه"
            value={`${candidate.monthly_rent_rial == null ? "نامشخص" : (candidate.monthly_rent_rial / 10).toLocaleString("fa-IR")} تومان`}
          />
        </dl>
        <p className="text-muted-foreground text-sm">{candidate.description}</p>
        <CandidateEvidence candidate={candidate} />
        {claimed && canDecide && candidate.extraction_run && (
          <CandidateCorrectionForm candidate={candidate} />
        )}
        {!claimed || !canDecide ? (
          <Button
            onClick={() => claim.mutate()}
            disabled={claim.isPending || !canDecide}
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
                disabled={decision.isPending || !reason.trim()}
                onClick={() => decision.mutate("request-changes")}
                aria-label={`درخواست اصلاح ${candidate.title}`}
              >
                درخواست اصلاح
              </Button>
              <Button
                variant="destructive"
                disabled={decision.isPending || !reason.trim()}
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
                  Boolean(candidate.exclusion_reason) ||
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

function CaseSection({
  id,
  children,
}: {
  id: CaseSectionId;
  title: string;
  children: ReactNode;
}) {
  const active = useContext(ActiveSectionContext) === id;
  const section = caseSections.find((section) => section.id === id)!;
  const Icon = section.icon;
  return (
    <section
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      hidden={!active}
      className={
        active ? "focus-visible:outline-ring grid min-w-0 gap-5" : "hidden"
      }
    >
      <header className="flex items-start gap-3 border-b pb-5">
        <span className="bg-primary/10 text-primary rounded-xl p-3">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-6">
            {section.description}
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}
