import { submissionImagePreview } from "@/features/submissions/SubmissionImagesFields";
import { propertyTypeLabels } from "@/features/catalog/property-taxonomy";
import { SourceAssignmentSummary } from "@/features/source-proposals/SourceAssignmentSummary";
import { discoveryStageLabels } from "@/features/source-proposals/discovery-labels";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock3, Globe2, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router";

import { SubmitterWorkspace } from "@/features/submitter/SubmitterWorkspace";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  removeSourceProposalDraft,
  type SourceProposal,
  sourceProposalsQueryOptions,
} from "@/features/source-proposals/queries";
import {
  archiveListing,
  confirmListingAvailability,
  markListingUnavailable,
  removeSubmissionDraft,
  type Submission,
  submissionsQueryOptions,
} from "@/features/submissions/queries";
import {
  notificationAlertVariant,
  notificationStatusLabel,
} from "@/features/submissions/notification";
import {
  submissionStateLabels,
  submissionStepLabel,
} from "@/features/submissions/steps";
import { errorMessage } from "@/lib/api/errors";

const sourceProposalStateLabels = {
  draft: "پیش‌نویس",
  pending: "در انتظار بررسی",
  changes_requested: "نیازمند اصلاح",
  rejected: "ردشده",
  approved: "تأییدشده",
  revoked: "تخصیص لغوشده",
};

export function SubmitterDashboardPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const submissions = useQuery(submissionsQueryOptions);
  const sourceProposals = useQuery(sourceProposalsQueryOptions);
  const queryClient = useQueryClient();
  const draftRemoval = useMutation({
    mutationFn: (target: {
      kind: "submission" | "source_proposal";
      id: string;
    }) =>
      target.kind === "submission"
        ? removeSubmissionDraft(target.id)
        : removeSourceProposalDraft(target.id),
    onSuccess: (_data, target) => {
      if (target.kind === "submission") {
        queryClient.setQueryData<Submission[]>(["submissions"], (current) =>
          current?.filter((submission) => submission.id !== target.id),
        );
        return;
      }
      queryClient.setQueryData<SourceProposal[]>(
        ["source-proposals"],
        (current) => current?.filter((proposal) => proposal.id !== target.id),
      );
    },
  });
  const availabilityAction = useMutation({
    mutationFn: ({
      submissionId,
      action,
    }: {
      submissionId: string;
      action: "confirm" | "unavailable" | "archive";
    }) => {
      if (action === "confirm") return confirmListingAvailability(submissionId);
      if (action === "unavailable") return markListingUnavailable(submissionId);
      return archiveListing(submissionId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Submission[]>(["submissions"], (current) =>
        current?.map((submission) =>
          submission.id === updated.id ? updated : submission,
        ),
      );
    },
  });

  return (
    <SubmitterWorkspace>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm">پنل ثبت‌کننده</p>
          <h1 className="text-3xl font-semibold tracking-tight">آگهی‌های من</h1>
          <p className="text-muted-foreground mt-2">
            آگهی‌ها را مدیریت کنید، پیش‌نویس‌ها را ادامه دهید و نتیجه بررسی را
            ببینید.
          </p>
        </div>
        <Button asChild className="rounded-full">
          <Link to="/submitter/get-started">
            <Plus aria-hidden="true" /> پیشنهاد تازه
          </Link>
        </Button>
      </header>

      {draftRemoval.isError && (
        <Alert className="mb-6" variant="destructive">
          <AlertDescription>
            {errorMessage(
              draftRemoval.error,
              "حذف پیش‌نویس انجام نشد. دوباره تلاش کنید.",
            )}
          </AlertDescription>
        </Alert>
      )}

      <div
        className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4"
        aria-label="خلاصه آگهی‌ها"
      >
        {[
          { label: "همه آگهی‌ها", value: "all" },
          { label: "پیش‌نویس‌ها", value: "draft" },
          { label: "در انتظار بررسی", value: "pending" },
          { label: "نیازمند اصلاح", value: "changes_requested" },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={`rounded-2xl border p-5 text-start transition-colors ${filter === item.value ? "border-primary/40 bg-primary/5" : "bg-card hover:bg-muted"}`}
          >
            <span className="text-muted-foreground text-sm">{item.label}</span>
            <span className="mt-3 block text-3xl font-semibold">
              {submissions.data
                ? submissions.data
                    .filter(
                      (entry) =>
                        item.value === "all" || entry.state === item.value,
                    )
                    .length.toLocaleString("fa-IR")
                : "—"}
            </span>
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">آگهی‌های شما</h2>
        <Input
          className="w-full sm:max-w-72"
          aria-label="جست‌وجوی آگهی‌ها"
          placeholder="جست‌وجو بر اساس محله…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div
        className="mb-5 flex flex-wrap gap-2"
        role="group"
        aria-label="فیلتر وضعیت آگهی"
      >
        {[
          { value: "all", label: "همه" },
          ...Object.entries(submissionStateLabels).map(([value, label]) => ({
            value,
            label,
          })),
        ].map(({ value, label }) => (
          <Button
            key={value}
            variant={filter === value ? "default" : "outline"}
            size="sm"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {submissions.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            آگهی‌ها بارگذاری نشدند.
            <Button
              variant="outline"
              onClick={() => void submissions.refetch()}
            >
              تلاش دوباره
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {submissions.isPending && <p>در حال بارگذاری پیش‌نویس‌ها…</p>}
      {submissions.data?.length === 0 && (
        <Card className="shadow-none">
          <CardContent>
            <div className="py-8 text-center">
              <Clock3
                className="text-primary mx-auto mb-4 size-9"
                aria-hidden="true"
              />
              <p className="font-medium">
                هنوز آگهی ثبت‌شده‌ای ندارید. با ثبت مشخصات ملک شروع کنید.
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                اطلاعات در هر مرحله ذخیره می‌شود تا بعداً ادامه دهید.
              </p>
              <Button asChild className="mt-5">
                <Link to="/add-submission?new=1">ثبت اولین آگهی</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {Boolean(submissions.data?.length) &&
        !submissions.data?.some(
          (entry) =>
            (filter === "all" || entry.state === filter) &&
            (entry.location?.neighborhood ?? "").includes(search.trim()),
        ) && (
          <div className="mb-6 rounded-xl border border-dashed p-8 text-center">
            <p>آگهی‌ای با این جست‌وجو و وضعیت پیدا نشد.</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setFilter("all");
                setSearch("");
              }}
            >
              نمایش همه آگهی‌ها
            </Button>
          </div>
        )}
      <section className="grid gap-4" aria-label="ارسال‌های شما">
        {submissions.data
          ?.filter(
            (submission) =>
              (filter === "all" || submission.state === filter) &&
              (submission.location?.neighborhood ?? "").includes(search.trim()),
          )
          .map((submission) => {
            const title = submission.location?.neighborhood
              ? `ملک در ${submission.location.neighborhood}`
              : submission.role === "owner"
                ? "پیش‌نویس مالک"
                : "پیش‌نویس نماینده مالک";
            const cover = submission.images?.find(
              (image) => image.is_primary && image.status === "ready",
            );
            const preview = cover ? submissionImagePreview(cover) : undefined;
            const currentStep = submission.current_step ?? "location";
            const canEdit =
              submission.available_actions?.includes("edit") ??
              submission.state === "draft";
            const canSubmit =
              submission.available_actions?.includes("submit") ?? false;
            const canDelete =
              submission.available_actions?.includes("delete") ?? false;
            const canConfirmAvailability =
              submission.available_actions?.includes("confirm_availability") ??
              false;
            const canMarkUnavailable =
              submission.available_actions?.includes("mark_unavailable") ??
              false;
            const canArchive =
              submission.available_actions?.includes("archive") ?? false;
            const latestReason = [...(submission.history ?? [])]
              .reverse()
              .find((event) => event.reason)?.reason;
            return (
              <Card
                className="overflow-hidden rounded-2xl shadow-none"
                id={`submission-${submission.id}`}
                key={submission.id}
              >
                <CardContent className="flex flex-col gap-5">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="bg-muted flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl">
                      {preview ? (
                        <img
                          src={preview.url}
                          alt={`تصویر ${title}`}
                          className="size-full object-cover"
                        />
                      ) : (
                        <Clock3
                          className="text-muted-foreground size-7"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-3">
                        <h3 className="font-semibold">{title}</h3>
                        <Badge variant="secondary">
                          {submissionStateLabels[submission.state ?? "draft"]}
                        </Badge>
                        {submission.revision && (
                          <span className="text-muted-foreground text-xs">
                            نسخه {submission.revision.toLocaleString("fa-IR")}
                          </span>
                        )}
                      </div>
                      <p className="text-sm">
                        مرحله کنونی: {submissionStepLabel(currentStep)}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        آخرین ذخیره:{" "}
                        {new Date(submission.updated_at).toLocaleString(
                          "fa-IR",
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canEdit && (
                        <Button asChild variant="outline">
                          <Link
                            to={`/add-submission?submission=${submission.id}&step=${currentStep}`}
                            aria-label={`${submission.state === "changes_requested" ? "اصلاح" : "ادامه"} ${title}`}
                          >
                            {submission.state === "changes_requested"
                              ? "اصلاح"
                              : "ادامه"}{" "}
                            <ArrowLeft aria-hidden="true" />
                          </Link>
                        </Button>
                      )}
                      {canSubmit && (
                        <Button asChild>
                          <Link
                            to={`/add-submission?submission=${submission.id}&step=review`}
                            aria-label={`ارسال برای بررسی ${title}`}
                          >
                            ارسال برای بررسی
                            <ArrowLeft aria-hidden="true" />
                          </Link>
                        </Button>
                      )}
                      {canDelete && (
                        <DeleteDraftDialog
                          label={title}
                          pending={draftRemoval.isPending}
                          onDelete={() =>
                            draftRemoval.mutate({
                              kind: "submission",
                              id: submission.id,
                            })
                          }
                        />
                      )}
                      {canConfirmAvailability && (
                        <Button
                          type="button"
                          onClick={() =>
                            availabilityAction.mutate({
                              submissionId: submission.id,
                              action: "confirm",
                            })
                          }
                          disabled={availabilityAction.isPending}
                        >
                          تأیید موجودی
                        </Button>
                      )}
                      {canMarkUnavailable && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            availabilityAction.mutate({
                              submissionId: submission.id,
                              action: "unavailable",
                            })
                          }
                          disabled={availabilityAction.isPending}
                        >
                          ناموجود شده
                        </Button>
                      )}
                      {canArchive && (
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() =>
                            availabilityAction.mutate({
                              submissionId: submission.id,
                              action: "archive",
                            })
                          }
                          disabled={availabilityAction.isPending}
                        >
                          بایگانی
                        </Button>
                      )}
                    </div>
                  </div>
                  {(submission.property_facts || submission.rental_terms) && (
                    <dl className="bg-muted/70 grid grid-cols-2 gap-4 rounded-xl p-4 text-sm sm:grid-cols-3">
                      {submission.property_facts && (
                        <div>
                          <dt className="text-muted-foreground text-xs">
                            مشخصات ملک
                          </dt>
                          <dd className="mt-1 font-medium">
                            {
                              propertyTypeLabels[
                                submission.property_facts.property_type
                              ]
                            }{" "}
                            ·{" "}
                            {submission.property_facts.area_sqm.toLocaleString(
                              "fa-IR",
                            )}{" "}
                            متر مربع
                          </dd>
                        </div>
                      )}
                      {submission.rental_terms && (
                        <>
                          <div>
                            <dt className="text-muted-foreground text-xs">
                              ودیعه
                            </dt>
                            <dd className="mt-1 font-medium">
                              {submission.rental_terms.deposit_toman.toLocaleString(
                                "fa-IR",
                              )}{" "}
                              تومان
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground text-xs">
                              اجاره ماهانه
                            </dt>
                            <dd className="mt-1 font-medium">
                              {submission.rental_terms.monthly_rent_toman.toLocaleString(
                                "fa-IR",
                              )}{" "}
                              تومان
                            </dd>
                          </div>
                        </>
                      )}
                    </dl>
                  )}
                  {submission.availability?.expiring_soon && (
                    <Alert>
                      <AlertDescription>
                        این آگهی در هفت روز آینده منقضی می‌شود. اگر همچنان موجود
                        است، موجودی را تأیید کنید.
                      </AlertDescription>
                    </Alert>
                  )}
                  {availabilityAction.isSuccess &&
                    availabilityAction.data.id === submission.id &&
                    availabilityAction.variables.action === "confirm" && (
                      <Alert>
                        <AlertDescription>
                          موجودی آگهی برای ۳۰ روز دیگر تأیید شد.
                        </AlertDescription>
                      </Alert>
                    )}
                  {availabilityAction.isError &&
                    availabilityAction.variables?.submissionId ===
                      submission.id && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {errorMessage(
                            availabilityAction.error,
                            "تغییر وضعیت موجودی انجام نشد.",
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  {latestReason && (
                    <Alert>
                      <AlertDescription>{latestReason}</AlertDescription>
                    </Alert>
                  )}
                  {submission.notification && (
                    <Alert
                      variant={notificationAlertVariant(
                        submission.notification.status,
                      )}
                    >
                      <AlertDescription>
                        {notificationStatusLabel(
                          submission.notification.status,
                        )}
                        {submission.notification.status === "failed" &&
                          " تصمیم و جزئیات آن همچنان در همین داشبورد معتبر است."}
                      </AlertDescription>
                    </Alert>
                  )}
                  {submission.history && submission.history.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium">
                        تاریخچه وضعیت
                      </summary>
                      <ol className="mt-3 space-y-2 border-s ps-4">
                        {submission.history.map((event) => (
                          <li key={event.id}>
                            {submissionStateLabels[event.prior_state]} ←{" "}
                            {submissionStateLabels[event.new_state]}
                            <span className="text-muted-foreground ms-2">
                              {new Date(event.created_at).toLocaleString(
                                "fa-IR",
                              )}
                            </span>
                            {event.reason && (
                              <p className="mt-1">{event.reason}</p>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })}
      </section>
      <section className="mt-10" aria-labelledby="source-proposals-heading">
        <div className="mb-4">
          <h2 id="source-proposals-heading" className="text-xl font-semibold">
            پیشنهادهای منبع
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            وب‌سایت‌هایی که برای اعتبارسنجی اپراتور معرفی کرده‌اید.
          </p>
        </div>
        {sourceProposals.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              پیشنهادهای وب‌سایت بارگذاری نشدند.
              <Button
                variant="outline"
                onClick={() => void sourceProposals.refetch()}
              >
                تلاش دوباره
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {sourceProposals.isPending && <p>در حال بارگذاری پیشنهادهای منبع…</p>}
        {sourceProposals.data?.length === 0 && (
          <Card className="shadow-none">
            <CardContent>
              <p>هنوز وب‌سایتی معرفی نکرده‌اید.</p>
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4">
          {sourceProposals.data?.map((proposal) => {
            const title = proposal.website_name || "پیشنهاد وب‌سایت تازه";
            const state = proposal.state ?? "draft";
            const sourceState = sourceProposalStateLabels[state];
            const history = proposal.history ?? [];
            const canEdit = proposal.available_actions.includes("edit");
            const canDelete = proposal.available_actions.includes("delete");
            return (
              <Card className="shadow-none" key={proposal.id}>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  {state !== "approved" && state !== "rejected" && (
                    <p role="status">
                      {
                        discoveryStageLabels[
                          proposal.discovery_stage ?? "awaiting_url"
                        ]
                      }
                    </p>
                  )}
                  <span className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-full">
                    <Globe2 className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-semibold">{title}</h3>
                      <Badge variant="secondary">{sourceState}</Badge>
                      <span className="text-muted-foreground text-xs">
                        نسخه {(proposal.revision ?? 1).toLocaleString("fa-IR")}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {state === "pending"
                        ? "اقدام بعدی: منتظر بررسی اپراتور بمانید."
                        : state === "changes_requested"
                          ? "اقدام بعدی: موارد خواسته‌شده را اصلاح و دوباره ارسال کنید."
                          : state === "approved"
                            ? "بررسی این پیشنهاد پایان یافته است."
                            : state === "rejected"
                              ? "این پیشنهاد بسته شده است."
                              : "اقدام بعدی: اطلاعات و پیش‌نمایش را تکمیل و تأیید کنید."}
                    </p>
                    {proposal.assignment && (
                      <SourceAssignmentSummary
                        assignment={proposal.assignment}
                        proposalId={proposal.id}
                      />
                    )}
                    {history.length > 0 && (
                      <section
                        className="mt-4 rounded-lg border p-3"
                        aria-label={`تاریخچه پیشنهاد وب‌سایت ${title}`}
                      >
                        <h4 className="font-medium">تاریخچه بررسی</h4>
                        <ol className="mt-2 grid gap-3 text-sm">
                          {history.map((event) => (
                            <li key={event.id}>
                              <p>
                                {sourceProposalStateLabels[event.new_state]} —
                                نسخه {event.revision.toLocaleString("fa-IR")}
                              </p>
                              {event.reason && (
                                <p className="mt-1">{event.reason}</p>
                              )}
                              <p className="text-muted-foreground mt-1 text-xs">
                                {new Date(event.created_at).toLocaleString(
                                  "fa-IR",
                                )}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </section>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <Button asChild variant="outline">
                        <Link
                          to={`/source-proposal?proposal=${proposal.id}`}
                          aria-label={`${state === "changes_requested" ? "اصلاح" : "ادامه"} پیشنهاد وب‌سایت ${title}`}
                        >
                          {state === "changes_requested" ? "اصلاح" : "ادامه"}{" "}
                          <ArrowLeft aria-hidden="true" />
                        </Link>
                      </Button>
                    )}
                    {canDelete && (
                      <DeleteDraftDialog
                        label={title}
                        pending={draftRemoval.isPending}
                        onDelete={() =>
                          draftRemoval.mutate({
                            kind: "source_proposal",
                            id: proposal.id,
                          })
                        }
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </SubmitterWorkspace>
  );
}

function DeleteDraftDialog({
  label,
  pending,
  onDelete,
}: {
  label: string;
  pending: boolean;
  onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          aria-label={`حذف پیش‌نویس ${label}`}
          disabled={pending}
          type="button"
          variant="outline"
        >
          <Trash2 aria-hidden="true" /> حذف
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>پیش‌نویس حذف شود؟</AlertDialogTitle>
          <AlertDialogDescription>
            پیش‌نویس «{label}» برای همیشه حذف می‌شود و قابل بازیابی نیست.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 text-white"
            disabled={pending}
            onClick={onDelete}
          >
            حذف پیش‌نویس
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default SubmitterDashboardPage;
