import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Search, ShieldX, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserQuery } from "@/features/session/queries";
import { supportClassificationLabels } from "@/features/support/labels";
import { SupportResolutionPanel } from "@/features/support/SupportResolutionPanel";
import { SupportTriagePanel } from "@/features/support/SupportTriagePanel";
import {
  addSupportNote,
  claimSupportRequest,
  reassignSupportRequest,
  recordSupportExternalContact,
  recordSupportIdentityVerification,
  recordSupportPrivacyAction,
  releaseSupportRequest,
  reopenSupportRequest,
  resolveSupportRequest,
  supportQueueQueryOptions,
  supportRequestQueryOptions,
  triageSupportRequest,
  type AssigneeFacet,
  type SupportQueueFilters,
  type IntakeKind,
  type SupportClassification,
  type SupportReassignmentInput,
  type SupportExternalContactInput,
  type SupportIdentityVerificationInput,
  type SupportNoteInput,
  type SupportPrivacyActionInput,
  type SupportReopenInput,
  type SupportResolutionInput,
  type SupportRequestQueueItem,
  type SupportRequestStatus,
  type SupportTriageInput,
} from "@/features/support/queries";
import { errorMessage } from "@/lib/api/errors";

const statusLabels = {
  open: "باز",
  in_progress: "در حال رسیدگی",
  escalated: "ارجاع‌شده",
  resolved: "رسیدگی‌شده",
} satisfies Record<SupportRequestStatus, string>;

const intakeKindLabels = {
  general: "راهنمایی و پرسش",
  account_deletion: "حذف حساب",
  public_contact_removal: "حذف اطلاعات تماس عمومی",
} satisfies Record<IntakeKind, string>;

const priorityLabels = {
  normal: "عادی",
  urgent: "فوری",
} as const;

const eventLabels = {
  assigned: "واگذاری",
  classified: "تغییر دسته‌بندی",
  escalated: "ارجاع تخصصی",
  priority_changed: "تغییر فوریت",
  reassigned: "واگذاری مجدد",
  released: "آزادسازی",
  note_added: "یادداشت داخلی",
  external_contact_recorded: "ثبت ارتباط بیرونی",
  resolved: "نتیجه نهایی",
  reopened: "بازگشایی",
  identity_verified: "تأیید هویت",
  privacy_action_recorded: "ثبت اقدام حریم خصوصی",
} as const;

function requestTitle(supportRequest: SupportRequestQueueItem) {
  return supportRequest.name || supportRequest.email;
}

function assignmentAge(assignedAt: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(assignedAt).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes.toLocaleString("fa-IR")} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString("fa-IR")} ساعت`;
  return `${Math.floor(hours / 24).toLocaleString("fa-IR")} روز`;
}

export function OperatorSupportPage() {
  const queryClient = useQueryClient();
  const currentUser = useQuery(currentUserQuery);
  const [filters, setFilters] = useState<SupportQueueFilters>({
    ordering: "oldest",
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const queue = useQuery(supportQueueQueryOptions(filters));
  const queueItems = (queue.data?.results ?? []).filter(
    ({ id }) => !suppressedIds.has(id),
  );
  const activeId =
    selectedId && !suppressedIds.has(selectedId)
      ? selectedId
      : (queueItems[0]?.id ?? "");
  const detail = useQuery(supportRequestQueryOptions(activeId));
  const selected = detail.data;

  const refreshSupportRequest = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["operator-support-requests"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["operator-support-requests", "detail", activeId],
      }),
    ]);
  };
  const claim = useMutation({
    mutationFn: () => claimSupportRequest(activeId),
    onSuccess: refreshSupportRequest,
  });
  const release = useMutation({
    mutationFn: () => releaseSupportRequest(activeId),
    onSuccess: refreshSupportRequest,
  });
  const triage = useMutation({
    mutationFn: (input: SupportTriageInput) =>
      triageSupportRequest(activeId, input),
    onSuccess: async (_, input) => {
      const losesPrivacyAccess =
        (input.classification === "privacy" ||
          input.classification === "account_deletion") &&
        !currentUser.data?.operator_capabilities.includes(
          "handle_privacy_requests",
        );
      const lacksRequiredCapability = Boolean(
        input.required_capability &&
        !currentUser.data?.operator_capabilities.includes(
          input.required_capability,
        ),
      );
      if (losesPrivacyAccess || lacksRequiredCapability) {
        setSuppressedIds((current) => new Set(current).add(activeId));
        setSelectedId(undefined);
        queryClient.removeQueries({
          queryKey: ["operator-support-requests", "detail", activeId],
        });
      }
      await refreshSupportRequest();
    },
  });
  const reassign = useMutation({
    mutationFn: (input: SupportReassignmentInput) =>
      reassignSupportRequest(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const addNote = useMutation({
    mutationFn: (input: SupportNoteInput) => addSupportNote(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const recordExternalContact = useMutation({
    mutationFn: (input: SupportExternalContactInput) =>
      recordSupportExternalContact(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const resolve = useMutation({
    mutationFn: (input: SupportResolutionInput) =>
      resolveSupportRequest(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const reopen = useMutation({
    mutationFn: (input: SupportReopenInput) =>
      reopenSupportRequest(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const recordIdentityVerification = useMutation({
    mutationFn: (input: SupportIdentityVerificationInput) =>
      recordSupportIdentityVerification(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const recordPrivacyAction = useMutation({
    mutationFn: (input: SupportPrivacyActionInput) =>
      recordSupportPrivacyAction(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const mutationError =
    claim.error ??
    release.error ??
    triage.error ??
    reassign.error ??
    addNote.error ??
    recordExternalContact.error ??
    resolve.error ??
    reopen.error ??
    recordIdentityVerification.error ??
    recordPrivacyAction.error;
  const operationalMutationPending =
    addNote.isPending ||
    recordExternalContact.isPending ||
    resolve.isPending ||
    reopen.isPending ||
    recordIdentityVerification.isPending ||
    recordPrivacyAction.isPending;

  if (queue.isPending) {
    return (
      <PageMain>
        <p>در حال بارگذاری صف پشتیبانی…</p>
      </PageMain>
    );
  }

  if (queue.isError) {
    return (
      <PageMain className="flex min-h-[70vh] items-center py-16">
        <Card className="mx-auto max-w-lg text-center shadow-none">
          <CardContent className="flex flex-col items-center py-8">
            <ShieldX className="mb-5 size-8" aria-hidden="true" />
            <h1 className="text-2xl font-semibold">دسترسی پشتیبانی لازم است</h1>
            <p className="text-muted-foreground mt-3 leading-7">
              این صف فقط برای اپراتورهای دارای قابلیت پشتیبانی نمایش داده
              می‌شود.
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
          صف درخواست‌های پشتیبانی
        </h1>
        <p className="text-muted-foreground mt-2">
          {queue.data.count.toLocaleString("fa-IR")} مورد مطابق فیلترها
        </p>
      </header>

      <Card className="mb-6 shadow-none">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Label className="lg:col-span-2">
            جست‌وجو
            <span className="relative mt-1 block">
              <Search
                className="text-muted-foreground absolute start-3 top-3 size-4"
                aria-hidden="true"
              />
              <Input
                className="ps-9"
                value={filters.search ?? ""}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    search: event.target.value || undefined,
                    page: 1,
                  })
                }
              />
            </span>
          </Label>
          <Label>
            وضعیت
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.status ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  status: event.target.value
                    ? (event.target.value as SupportRequestStatus)
                    : undefined,
                  page: 1,
                })
              }
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="open">باز</option>
              <option value="in_progress">در حال رسیدگی</option>
              <option value="escalated">ارجاع‌شده</option>
              <option value="resolved">رسیدگی‌شده</option>
            </select>
          </Label>
          <Label>
            مسئول رسیدگی
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.assignee ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  assignee: event.target.value
                    ? (event.target.value as AssigneeFacet)
                    : undefined,
                  page: 1,
                })
              }
            >
              <option value="">همه</option>
              <option value="unassigned">بدون مسئول</option>
              <option value="mine">در اختیار من</option>
              <option value="other">در اختیار دیگران</option>
            </select>
          </Label>
          <Label>
            Intake Kind
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.intake_kind ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  intake_kind: event.target.value
                    ? (event.target.value as IntakeKind)
                    : undefined,
                  page: 1,
                })
              }
            >
              <option value="">همه ورودی‌ها</option>
              <option value="general">راهنمایی و پرسش</option>
              <option value="account_deletion">حذف حساب</option>
              <option value="public_contact_removal">
                حذف اطلاعات تماس عمومی
              </option>
            </select>
          </Label>
          <Label>
            Support Classification
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.classification ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  classification: event.target.value
                    ? (event.target.value as SupportClassification)
                    : undefined,
                  page: 1,
                })
              }
            >
              <option value="">همه دسته‌بندی‌ها</option>
              {Object.entries(supportClassificationLabels).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </Label>
          <Label>
            حداقل سن درخواست (روز)
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
            اولویت
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.priority ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  priority: event.target.value
                    ? (event.target.value as "normal" | "urgent")
                    : undefined,
                  page: 1,
                })
              }
            >
              <option value="">همه اولویت‌ها</option>
              <option value="normal">عادی</option>
              <option value="urgent">فوری</option>
            </select>
          </Label>
          <Label>
            ترتیب
            <select
              className="border-input bg-background mt-1 h-11 w-full rounded-md border px-3"
              value={filters.ordering}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  ordering: event.target.value as "newest" | "oldest",
                  page: 1,
                })
              }
            >
              <option value="oldest">قدیمی‌ترین ابتدا</option>
              <option value="newest">تازه‌ترین ابتدا</option>
            </select>
          </Label>
        </CardContent>
      </Card>

      {mutationError && (
        <Alert className="mb-5" variant="destructive">
          <AlertDescription>
            {errorMessage(
              mutationError,
              "تغییر مسئول Support Request ناموفق بود.",
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="space-y-3" aria-label="صف درخواست‌های پشتیبانی">
          {queueItems.map((supportRequest) => (
            <button
              className={`border-border min-h-24 w-full rounded-xl border p-4 text-start ${supportRequest.id === selected?.id ? "border-primary bg-primary/5" : "bg-card"}`}
              key={supportRequest.id}
              onClick={() => setSelectedId(supportRequest.id)}
              type="button"
            >
              <span className="mb-2 flex items-center justify-between gap-2 font-semibold">
                {requestTitle(supportRequest)}
                <Badge>
                  {statusLabels[supportRequest.status ?? "open"] ??
                    supportRequest.status}
                </Badge>
              </span>
              <span className="text-muted-foreground block text-xs">
                {intakeKindLabels[supportRequest.intake_kind]}
              </span>
              {supportRequest.priority === "urgent" && (
                <Badge className="mt-2" variant="destructive">
                  فوری
                </Badge>
              )}
              <span className="mt-2 flex items-center gap-2 text-xs">
                <UserRound className="size-3" aria-hidden="true" />
                {supportRequest.assignee_email ?? "بدون مسئول"}
              </span>
              {supportRequest.assigned_at && (
                <span className="text-muted-foreground mt-1 block text-xs">
                  سن واگذاری: {assignmentAge(supportRequest.assigned_at)}
                </span>
              )}
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
              <CardTitle>{requestTitle(selected)}</CardTitle>
              <p className="text-muted-foreground text-sm">{selected.email}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="bg-muted rounded-lg p-4">
                  <dt>Intake Kind</dt>
                  <dd className="mt-1 font-semibold">
                    {intakeKindLabels[selected.intake_kind]}
                  </dd>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <dt>Support Classification</dt>
                  <dd className="mt-1 font-semibold">
                    {supportClassificationLabels[
                      selected.classification ?? "unclassified"
                    ] ?? selected.classification}
                  </dd>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <dt>اولویت</dt>
                  <dd className="mt-1 font-semibold">
                    {priorityLabels[selected.priority ?? "normal"]}
                  </dd>
                </div>
                {(selected.escalation_destination ||
                  selected.required_capability) && (
                  <div className="bg-muted rounded-lg p-4">
                    <dt>مسیر تخصصی</dt>
                    <dd className="mt-1 font-semibold">
                      {selected.escalation_destination ||
                        selected.required_capability}
                    </dd>
                  </div>
                )}
                <div className="bg-muted rounded-lg p-4 sm:col-span-2">
                  <dt>متن درخواست</dt>
                  <dd className="mt-1 font-semibold whitespace-pre-wrap">
                    {selected.message}
                  </dd>
                </div>
                {selected.assigned_at && (
                  <div className="bg-muted rounded-lg p-4 sm:col-span-2">
                    <dt>زمان واگذاری</dt>
                    <dd className="mt-1 flex flex-wrap items-center gap-2 font-semibold">
                      <Clock3 className="size-4" aria-hidden="true" />
                      <time
                        aria-label="زمان واگذاری ثبت‌شده"
                        dateTime={selected.assigned_at}
                      >
                        {new Date(selected.assigned_at).toLocaleString("fa-IR")}
                      </time>
                      <span className="text-muted-foreground font-normal">
                        ({assignmentAge(selected.assigned_at)} پیش)
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              {(selected.status === "open" ||
                selected.status === "escalated") && (
                <div className="flex justify-end">
                  <Button
                    disabled={claim.isPending}
                    onClick={() => claim.mutate()}
                  >
                    پذیرفتن درخواست
                  </Button>
                </div>
              )}
              {selected.status === "in_progress" &&
                selected.assignee_id === currentUser.data?.id && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      disabled={release.isPending}
                      onClick={() => release.mutate()}
                    >
                      آزاد کردن درخواست
                    </Button>
                  </div>
                )}

              <SupportTriagePanel
                canManageQueue={Boolean(
                  currentUser.data?.operator_capabilities.includes(
                    "manage_operator_queues",
                  ),
                )}
                isPending={triage.isPending || reassign.isPending}
                onReassign={(input) => reassign.mutate(input)}
                onTriage={(input) => triage.mutate(input)}
                supportRequest={selected}
              />

              <SupportResolutionPanel
                isAssignee={selected.assignee_id === currentUser.data?.id}
                isPending={operationalMutationPending}
                onAddNote={(input) => addNote.mutate(input)}
                onRecordExternalContact={(input) =>
                  recordExternalContact.mutate(input)
                }
                onRecordIdentityVerification={(input) =>
                  recordIdentityVerification.mutate(input)
                }
                onRecordPrivacyAction={(input) =>
                  recordPrivacyAction.mutate(input)
                }
                onReopen={(input) => reopen.mutate(input)}
                onResolve={(input) => resolve.mutate(input)}
                supportRequest={selected}
              />

              <section aria-labelledby="support-history-title">
                <h2 id="support-history-title" className="font-semibold">
                  تاریخچه عملیاتی
                </h2>
                <ol className="mt-3 space-y-3">
                  {(selected.history ?? []).map((event) => (
                    <li
                      className="border-border rounded-lg border p-3 text-sm"
                      key={event.id}
                    >
                      <p className="font-medium">
                        {eventLabels[event.event_type]}
                      </p>
                      <p className="text-muted-foreground mt-1">
                        {event.actor_email} · {statusLabels[event.prior_state]}{" "}
                        ← {statusLabels[event.new_state]}
                      </p>
                      <time
                        aria-label="زمان رویداد"
                        className="text-muted-foreground mt-1 block text-xs"
                        dateTime={event.created_at}
                      >
                        {new Date(event.created_at).toLocaleString("fa-IR")}
                      </time>
                      {event.reason && <p className="mt-1">{event.reason}</p>}
                      {event.resolution_category && (
                        <p className="mt-1">{event.resolution_category}</p>
                      )}
                      {event.resolution_summary && (
                        <p className="mt-1 whitespace-pre-wrap">
                          {event.resolution_summary}
                        </p>
                      )}
                    </li>
                  ))}
                  {(selected.history ?? []).length === 0 && (
                    <li className="text-muted-foreground text-sm">
                      هنوز رویدادی ثبت نشده است.
                    </li>
                  )}
                </ol>
              </section>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-none">
            <CardContent className="text-muted-foreground py-10 text-center">
              یک Support Request را برای مشاهده جزئیات انتخاب کنید.
            </CardContent>
          </Card>
        )}
      </div>
    </PageMain>
  );
}
