import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clock3,
  MessageSquareWarning,
  ShieldX,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  approveSubmission,
  claimSubmission,
  operatorQueueQueryOptions,
  operatorSubmissionQueryOptions,
  rejectSubmission,
  releaseSubmissionClaim,
  renewSubmissionClaim,
  requestSubmissionChanges,
  retrySubmissionNotification,
  type OperatorSubmissionQueueItem,
  type OperatorQueueFilters,
  type Submission,
  type SubmissionApproval,
} from "@/features/submissions/queries";
import { submissionStateLabels } from "@/features/submissions/steps";
import {
  notificationAlertVariant,
  notificationStatusLabel,
} from "@/features/submissions/notification";
import { ApiError, errorMessage } from "@/lib/api/errors";

type NormalizedProperty = NonNullable<
  SubmissionApproval["normalized_property"]
>;

const numericCorrectionFields = [
  "area_sqm",
  "room_count",
  "construction_year",
  "floor",
  "total_floors",
  "units_per_floor",
] as const;

const featureFields = [
  ["parking", "پارکینگ"],
  ["elevator", "آسانسور"],
  ["storage", "انباری"],
  ["balcony", "بالکن"],
  ["furnished", "مبله"],
] as const;

function submissionTitle(submission: Submission | OperatorSubmissionQueueItem) {
  return (
    submission.location?.neighborhood ??
    `Submission ${submission.id.slice(0, 8)}`
  );
}

function locationFieldLabel(
  field: "city_id" | "district_id" | "neighborhood_id",
) {
  return {
    city_id: "شناسه شهر نرمال‌شده",
    district_id: "شناسه منطقه نرمال‌شده",
    neighborhood_id: "شناسه محله نرمال‌شده",
  }[field];
}

function normalizedFieldLabel(field: (typeof numericCorrectionFields)[number]) {
  return {
    area_sqm: "متراژ نرمال‌شده",
    room_count: "تعداد اتاق نرمال‌شده",
    construction_year: "سال ساخت نرمال‌شده",
    floor: "طبقه نرمال‌شده",
    total_floors: "تعداد طبقات نرمال‌شده",
    units_per_floor: "واحد در طبقه نرمال‌شده",
  }[field];
}

function currentNumericValue(
  submission: Submission,
  field: (typeof numericCorrectionFields)[number],
) {
  const value = submission.property_facts?.[field];
  return value == null ? "" : String(value);
}

const reviewConflictMessages: Record<string, string> = {
  review_revision_conflict: "نسخه Submission از زمان بررسی شما تغییر کرده است.",
  review_claim_expired: "مهلت Review Claim شما تمام شده است.",
  review_claim_replaced: "Review Claim اکنون در اختیار اپراتور دیگری است.",
  review_decision_conflict:
    "اپراتور دیگری پیش از شما برای این Submission تصمیم گرفته است.",
  review_claim_required: "Review Claim فعلی دیگر به شما تعلق ندارد.",
};

function isReviewConflict(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    Boolean(error.code && reviewConflictMessages[error.code])
  );
}

function hasAuditData(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.keys(value as Record<string, unknown>).length,
  );
}

export function OperatorReviewPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<OperatorQueueFilters>({
    state: "pending",
    ordering: "oldest",
  });
  const queue = useQuery(operatorQueueQueryOptions(filters));
  const [selectedId, setSelectedId] = useState<string>();
  const [reason, setReason] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [description, setDescription] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [sourceClaims, setSourceClaims] = useState("");
  const [provenanceNote, setProvenanceNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [reviewConflict, setReviewConflict] = useState<ApiError>();
  const queueItems = queue.data?.results ?? [];
  const activeId = selectedId ?? queueItems[0]?.id ?? "";
  const detail = useQuery(operatorSubmissionQueryOptions(activeId));
  const selected = detail.data;

  const resetDecisionDraft = () => {
    setReason("");
    setPropertyId("");
    setCorrections({});
    setDescription("");
    setSourceReference("");
    setSourceClaims("");
    setProvenanceNote("");
    setInternalNote("");
  };
  const finishDecision = async () => {
    await queryClient.invalidateQueries({ queryKey: ["operator-submissions"] });
    resetDecisionDraft();
    setReviewConflict(undefined);
  };
  const refreshSelected = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["operator-submissions"] }),
      queryClient.invalidateQueries({
        queryKey: ["operator-submissions", "detail", activeId],
      }),
    ]);
  };
  const claimMutation = useMutation({
    mutationFn: () => claimSubmission(activeId),
    onSuccess: async () => {
      await refreshSelected();
      setReviewConflict(undefined);
    },
  });
  const releaseMutation = useMutation({
    mutationFn: () => releaseSubmissionClaim(activeId),
    onSuccess: refreshSelected,
  });
  const handleDecisionError = (error: unknown) => {
    if (!isReviewConflict(error)) return;
    if (selected) setSelectedId(selected.id);
    setReviewConflict(error);
  };
  const changesMutation = useMutation({
    mutationFn: () =>
      requestSubmissionChanges(selected!.id, selected!.revision, reason),
    onSuccess: finishDecision,
    onError: handleDecisionError,
  });
  const rejectMutation = useMutation({
    mutationFn: () =>
      rejectSubmission(selected!.id, selected!.revision, reason),
    onSuccess: finishDecision,
    onError: handleDecisionError,
  });
  const approveMutation = useMutation({
    mutationFn: () => {
      const normalizedProperty: NormalizedProperty = {};
      for (const [field, value] of Object.entries(corrections)) {
        if (!value) continue;
        Object.assign(normalizedProperty, {
          [field]: (numericCorrectionFields as readonly string[]).includes(
            field,
          )
            ? Number(value)
            : value,
        });
      }
      return approveSubmission(selected!.id, {
        reviewed_revision: selected!.revision,
        ...(propertyId ? { property_id: propertyId } : {}),
        normalized_property: normalizedProperty,
        source_metadata: {
          ...(sourceReference ? { source_reference: sourceReference } : {}),
          ...(sourceClaims ? { source_claims: JSON.parse(sourceClaims) } : {}),
          ...(provenanceNote ? { provenance_note: provenanceNote } : {}),
        },
        ...(description ? { formatting: { description } } : {}),
        ...(internalNote ? { internal_note: internalNote } : {}),
      });
    },
    onSuccess: finishDecision,
    onError: handleDecisionError,
  });
  const retryNotificationMutation = useMutation({
    mutationFn: (notificationId: string) =>
      retrySubmissionNotification(selected!.id, notificationId),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["operator-submissions", "detail", updated.id],
        updated,
      );
    },
  });
  const mutationError =
    claimMutation.error ??
    releaseMutation.error ??
    changesMutation.error ??
    rejectMutation.error ??
    approveMutation.error ??
    retryNotificationMutation.error;

  useEffect(() => {
    if (!activeId || selected?.claim_status !== "claimed_by_me") return;
    const timer = window.setInterval(
      () => {
        void renewSubmissionClaim(activeId).catch(() => {
          void queryClient.invalidateQueries({
            queryKey: ["operator-submissions"],
          });
        });
      },
      5 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [activeId, queryClient, selected?.claim_status]);

  if (queue.isPending) {
    return (
      <PageMain>
        <p>در حال بارگذاری صف بررسی…</p>
      </PageMain>
    );
  }
  if (queue.isError) {
    return (
      <PageMain className="flex min-h-[70vh] items-center py-16">
        <Card className="mx-auto max-w-lg text-center shadow-none">
          <CardContent className="flex flex-col items-center py-8">
            <ShieldX className="mb-5 size-8" aria-hidden="true" />
            <h1 className="text-2xl font-semibold">دسترسی اپراتور لازم است</h1>
            <p className="text-muted-foreground mt-3 leading-7">
              این صف فقط برای کارکنانی نمایش داده می‌شود که مجوز بررسی
              Submission را دارند.
            </p>
            <Button asChild className="mt-6" variant="outline">
              <Link to="/">بازگشت به خانه</Link>
            </Button>
          </CardContent>
        </Card>
      </PageMain>
    );
  }

  return (
    <PageMain>
      <header className="mb-6">
        <p className="text-muted-foreground mb-2 text-sm">فضای اپراتور</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          صف بررسی آگهی‌ها
        </h1>
        <p className="text-muted-foreground mt-2">
          {queue.data.count.toLocaleString("fa-IR")} مورد مطابق فیلترها
        </p>
      </header>

      <Card className="mb-6 shadow-none">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Label>
            وضعیت
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.state}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  state: event.target.value || undefined,
                })
              }
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="draft">پیش‌نویس</option>
              <option value="pending">در انتظار بررسی</option>
              <option value="changes_requested">نیازمند اصلاح</option>
              <option value="rejected">ردشده</option>
              <option value="published">منتشرشده</option>
            </select>
          </Label>
          <Label>
            شناسه Source
            <Input
              value={filters.source ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  source: event.target.value || undefined,
                })
              }
            />
          </Label>
          <Label>
            شناسه شهر
            <Input
              value={filters.city ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  city: event.target.value || undefined,
                })
              }
            />
          </Label>
          <Label>
            شناسه منطقه
            <Input
              value={filters.district ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  district: event.target.value || undefined,
                })
              }
            />
          </Label>
          <Label>
            شناسه محله
            <Input
              value={filters.neighborhood ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  neighborhood: event.target.value || undefined,
                })
              }
            />
          </Label>
          <Label>
            ورود به صف پیش از
            <Input
              type="datetime-local"
              onChange={(event) =>
                setFilters({
                  ...filters,
                  pending_before: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : undefined,
                })
              }
            />
          </Label>
          <Label>
            ورود به صف پس از
            <Input
              type="datetime-local"
              onChange={(event) =>
                setFilters({
                  ...filters,
                  pending_after: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : undefined,
                })
              }
            />
          </Label>
          <Label>
            مسئول بررسی
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.assignee ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  assignee: event.target.value || undefined,
                  page: 1,
                })
              }
            >
              <option value="">همه</option>
              <option value="unclaimed">بدون مسئول</option>
              <option value="mine">در اختیار من</option>
              <option value="other">در اختیار دیگران</option>
            </select>
          </Label>
          <Label>
            حداقل سن صف (روز)
            <Input
              min="0"
              type="number"
              value={filters.age_days ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  age_days: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                  page: 1,
                })
              }
            />
          </Label>
          <Label>
            ترتیب
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.ordering}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  ordering: event.target.value as "oldest" | "newest",
                })
              }
            >
              <option value="oldest">قدیمی‌ترین ابتدا</option>
              <option value="newest">تازه‌ترین ابتدا</option>
            </select>
          </Label>
        </CardContent>
      </Card>

      {reviewConflict && reviewConflict.code && (
        <Alert className="mb-5" variant="destructive">
          <AlertDescription className="space-y-3">
            <p>{reviewConflictMessages[reviewConflict.code]}</p>
            <p>
              یادداشت‌ها و اصلاحات شما در این مرورگر حفظ شده‌اند. ابتدا
              Submission را به‌روز کنید و سپس Review Claim جدیدی بگیرید.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void refreshSelected().then(() => setReviewConflict(undefined));
              }}
            >
              به‌روزرسانی Submission
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {Boolean(mutationError) && !isReviewConflict(mutationError) && (
        <Alert className="mb-5" variant="destructive">
          <AlertDescription>
            {errorMessage(mutationError, "ثبت تصمیم ناموفق بود.")}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
        <section className="space-y-3" aria-label="صف ارسال‌ها">
          {queueItems.map((submission) => (
            <button
              className={`border-border min-h-24 w-full rounded-xl border p-4 text-start ${submission.id === selected?.id ? "border-primary bg-primary/5" : "bg-card"}`}
              key={submission.id}
              onClick={() => {
                setSelectedId(submission.id);
                resetDecisionDraft();
                setReviewConflict(undefined);
              }}
              type="button"
            >
              <span className="mb-2 flex items-center justify-between gap-2 font-semibold">
                {submissionTitle(submission)}
                <Badge>
                  {submissionStateLabels[submission.state ?? "draft"]}
                </Badge>
              </span>
              <span className="text-muted-foreground flex items-center gap-3 text-xs">
                <UserRound className="size-3" aria-hidden="true" />
                {submission.role === "owner" ? "مالک" : "نماینده"}
                <Clock3 className="size-3" aria-hidden="true" />
                نسخه {submission.revision.toLocaleString("fa-IR")}
              </span>
              <span className="mt-2 block text-xs">
                {submission.claim_status === "unclaimed"
                  ? "بدون مسئول"
                  : submission.claim_status === "claimed_by_me"
                    ? "در اختیار من"
                    : "در اختیار اپراتور دیگر"}
              </span>
            </button>
          ))}
          {queueItems.length === 0 && (
            <p className="text-muted-foreground">موردی در صف نیست.</p>
          )}
          <div className="flex justify-between gap-3">
            <Button
              variant="outline"
              disabled={!queue.data.previous}
              onClick={() =>
                setFilters({
                  ...filters,
                  page: Math.max(1, (filters.page ?? 1) - 1),
                })
              }
            >
              صفحه قبل
            </Button>
            <Button
              variant="outline"
              disabled={!queue.data.next}
              onClick={() =>
                setFilters({ ...filters, page: (filters.page ?? 1) + 1 })
              }
            >
              صفحه بعد
            </Button>
          </div>
        </section>

        {selected ? (
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>{submissionTitle(selected)}</CardTitle>
              <p className="text-muted-foreground text-sm">
                {selected.location?.address}
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="bg-muted rounded-lg p-4">
                  <dt>متراژ</dt>
                  <dd className="font-semibold">
                    {selected.property_facts?.area_sqm.toLocaleString("fa-IR")}{" "}
                    متر
                  </dd>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <dt>شرایط اجاره</dt>
                  <dd className="font-semibold">
                    {selected.rental_terms?.deposit_toman.toLocaleString(
                      "fa-IR",
                    )}{" "}
                    تومان ودیعه
                  </dd>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <dt>تماس</dt>
                  <dd className="font-semibold">{selected.contact?.phone}</dd>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <dt>توضیحات</dt>
                  <dd className="font-semibold">{selected.description}</dd>
                </div>
              </dl>
              {selected.notification && (
                <Alert
                  variant={notificationAlertVariant(
                    selected.notification.status,
                  )}
                >
                  <AlertDescription>
                    {notificationStatusLabel(selected.notification.status)}
                    {selected.notification.failure_reason && (
                      <span className="mt-1 block">
                        {selected.notification.failure_reason}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {selected.state === "pending" &&
                selected.claim_status === "unclaimed" && (
                  <div className="flex justify-end">
                    <Button
                      disabled={claimMutation.isPending}
                      onClick={() => claimMutation.mutate()}
                    >
                      پذیرفتن مسئولیت بررسی
                    </Button>
                  </div>
                )}
              {selected.state === "pending" &&
                selected.claim_status === "claimed_by_another" && (
                  <Alert>
                    <AlertDescription>
                      این Submission در اختیار اپراتور دیگری است و فقط خواندنی
                      نمایش داده می‌شود.
                    </AlertDescription>
                  </Alert>
                )}
              {selected.state === "pending" &&
                selected.claim_status === "claimed_by_me" &&
                !reviewConflict && (
                  <div className="flex flex-wrap justify-end gap-3">
                    <Button
                      variant="ghost"
                      disabled={releaseMutation.isPending}
                      onClick={() => releaseMutation.mutate()}
                    >
                      آزاد کردن بررسی
                    </Button>
                    <DecisionDialog
                      title="درخواست اصلاح ارسال شود؟"
                      trigger="درخواست اصلاح"
                      reason={reason}
                      setReason={setReason}
                      label="دلیل درخواست اصلاح"
                      confirm="ارسال درخواست اصلاح"
                      pending={changesMutation.isPending}
                      onConfirm={() => changesMutation.mutate()}
                    />
                    <DecisionDialog
                      title="Submission رد شود؟"
                      trigger="رد نهایی"
                      reason={reason}
                      setReason={setReason}
                      label="دلیل رد"
                      confirm="رد Submission"
                      pending={rejectMutation.isPending}
                      onConfirm={() => rejectMutation.mutate()}
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button>
                          <Check aria-hidden="true" /> تأیید و انتشار
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>آگهی منتشر شود؟</AlertDialogTitle>
                          <AlertDialogDescription>
                            برای گروه‌بندی، شناسه Property موجود را وارد کنید؛
                            خالی‌بودن آن یک Property تازه می‌سازد.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="max-h-[60vh] space-y-3 overflow-y-auto pe-1">
                          <Label>
                            شناسه Property موجود (اختیاری)
                            <Input
                              value={propertyId}
                              onChange={(event) =>
                                setPropertyId(event.target.value)
                              }
                            />
                          </Label>
                          {(
                            [
                              "city_id",
                              "district_id",
                              "neighborhood_id",
                            ] as const
                          ).map((field) => (
                            <Label key={field}>
                              {locationFieldLabel(field)}
                              <Input
                                value={corrections[field] ?? ""}
                                onChange={(event) =>
                                  setCorrections({
                                    ...corrections,
                                    [field]: event.target.value,
                                  })
                                }
                              />
                            </Label>
                          ))}
                          <Label>
                            نوع ملک نرمال‌شده
                            <select
                              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
                              value={corrections.property_type ?? ""}
                              onChange={(event) =>
                                setCorrections({
                                  ...corrections,
                                  property_type: event.target.value,
                                })
                              }
                            >
                              <option value="">بدون تغییر</option>
                              <option value="apartment">آپارتمان</option>
                              <option value="house">خانه</option>
                              <option value="villa">ویلا</option>
                            </select>
                          </Label>
                          {numericCorrectionFields.map((field) => (
                            <Label key={field}>
                              {normalizedFieldLabel(field)}
                              <Input
                                inputMode="numeric"
                                value={corrections[field] ?? ""}
                                placeholder={currentNumericValue(
                                  selected,
                                  field,
                                )}
                                onChange={(event) =>
                                  setCorrections({
                                    ...corrections,
                                    [field]: event.target.value,
                                  })
                                }
                              />
                            </Label>
                          ))}
                          {featureFields.map(([field, label]) => (
                            <Label key={field}>
                              {label}
                              <select
                                className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
                                value={corrections[field] ?? ""}
                                onChange={(event) =>
                                  setCorrections({
                                    ...corrections,
                                    [field]: event.target.value,
                                  })
                                }
                              >
                                <option value="">بدون تغییر</option>
                                <option value="unknown">نامشخص</option>
                                <option value="present">دارد</option>
                                <option value="absent">ندارد</option>
                              </select>
                            </Label>
                          ))}
                          <Label>
                            یادداشت مکانی اپراتور
                            <Input
                              value={corrections.operator_location_notes ?? ""}
                              onChange={(event) =>
                                setCorrections({
                                  ...corrections,
                                  operator_location_notes: event.target.value,
                                })
                              }
                            />
                          </Label>
                          <Label>
                            شناسه در Source
                            <Input
                              value={sourceReference}
                              onChange={(event) =>
                                setSourceReference(event.target.value)
                              }
                            />
                          </Label>
                          <Label>
                            ادعاهای Source (JSON)
                            <textarea
                              className="border-input bg-background mt-1 min-h-20 w-full rounded-md border px-3 py-2"
                              value={sourceClaims}
                              onChange={(event) =>
                                setSourceClaims(event.target.value)
                              }
                            />
                          </Label>
                          <Label>
                            یادداشت منشأ
                            <Input
                              value={provenanceNote}
                              onChange={(event) =>
                                setProvenanceNote(event.target.value)
                              }
                            />
                          </Label>
                          <Label>
                            یادداشت داخلی (اختیاری)
                            <Input
                              value={internalNote}
                              onChange={(event) =>
                                setInternalNote(event.target.value)
                              }
                            />
                          </Label>
                          <Label>
                            قالب‌بندی توضیحات
                            <Input
                              value={description || selected.description || ""}
                              onChange={(event) =>
                                setDescription(event.target.value)
                              }
                            />
                          </Label>
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel>انصراف</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={approveMutation.isPending}
                            onClick={() => approveMutation.mutate()}
                          >
                            تأیید نهایی و انتشار
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-none">
            <CardContent>یک Submission را انتخاب کنید.</CardContent>
          </Card>
        )}

        <aside aria-labelledby="status-history-title">
          <h2 id="status-history-title" className="mb-4 text-lg font-semibold">
            تاریخچه وضعیت
          </h2>
          <ol className="border-border space-y-6 border-s ps-5 text-sm">
            {selected?.history.map((event) => (
              <li key={event.id}>
                <p className="font-semibold">
                  {event.event_type === "decision_correction"
                    ? "اصلاح ثبت تصمیم"
                    : `${submissionStateLabels[event.prior_state]} ← ${submissionStateLabels[event.new_state]}`}
                </p>
                <p className="text-muted-foreground mt-1">
                  {event.actor_email} ·{" "}
                  {new Date(event.created_at).toLocaleString("fa-IR")}
                </p>
                <p className="text-muted-foreground mt-1">
                  نسخه بررسی‌شده:{" "}
                  {(event.reviewed_revision ?? event.revision).toLocaleString(
                    "fa-IR",
                  )}
                </p>
                {event.reason && <p className="mt-1">{event.reason}</p>}
                {event.notification && (
                  <div className="mt-2 space-y-2">
                    <p>{notificationStatusLabel(event.notification.status)}</p>
                    {event.notification.failure_reason && (
                      <p className="text-muted-foreground">
                        {event.notification.failure_reason}
                      </p>
                    )}
                    {event.notification.status === "failed" && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={retryNotificationMutation.isPending}
                        onClick={() =>
                          retryNotificationMutation.mutate(
                            event.notification!.id,
                          )
                        }
                      >
                        تلاش دوباره برای ارسال ایمیل
                      </Button>
                    )}
                  </div>
                )}
                {hasAuditData(event.normalized_corrections) && (
                  <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                    اصلاحات نرمال‌شده:{" "}
                    {JSON.stringify(event.normalized_corrections, null, 2)}
                  </pre>
                )}
                {hasAuditData(event.publication_result) && (
                  <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                    نتیجه انتشار:{" "}
                    {JSON.stringify(event.publication_result, null, 2)}
                  </pre>
                )}
                {hasAuditData(event.correction) && (
                  <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                    رکورد اصلاحی: {JSON.stringify(event.correction, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </PageMain>
  );
}

function DecisionDialog({
  title,
  trigger,
  reason,
  setReason,
  label,
  confirm,
  pending,
  onConfirm,
}: {
  title: string;
  trigger: string;
  reason: string;
  setReason: (reason: string) => void;
  label: string;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <MessageSquareWarning aria-hidden="true" />
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            دلیل برای ثبت‌کننده و در تاریخچه قابل مشاهده است.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Label>
          {label}
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Label>
        <AlertDialogFooter>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim() || pending}
            onClick={onConfirm}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default OperatorReviewPage;
