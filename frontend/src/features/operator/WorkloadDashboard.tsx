import { useState } from "react";
import {
  ArrowLeft,
  BellRing,
  CheckCheck,
  Clock3,
  Inbox,
  UserRound,
} from "lucide-react";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import type { SubmissionWorkloadSummary } from "@/features/submissions/queries";
import type { SupportWorkloadSummary } from "@/features/support/queries";
import { cn } from "@/lib/utils";

export type WorkloadQueue = {
  label: string;
  to: string;
  data?: SubmissionWorkloadSummary | SupportWorkloadSummary;
  isPending: boolean;
  isError: boolean;
};

const format = (value: number) => value.toLocaleString("fa-IR");

export function WorkloadDashboard({ queues }: { queues: WorkloadQueue[] }) {
  const [view, setView] = useState<"assignment" | "aging">("assignment");
  if (queues.length === 0) return null;

  const complete = queues.every(
    (queue) => queue.data && !queue.isError && !queue.isPending,
  );
  const pending = queues.some((queue) => queue.isPending);
  const available = queues.filter(
    (queue) => queue.data && !queue.isError && !queue.isPending,
  );
  const total = (
    key: "unclaimed_count" | "assigned_to_me_count" | "aging_count",
  ) =>
    complete
      ? format(
          available.reduce((sum, queue) => sum + (queue.data?.[key] ?? 0), 0),
        )
      : "—";
  const maximum = Math.max(
    1,
    ...available.flatMap(({ data }) =>
      data
        ? view === "assignment"
          ? [data.unclaimed_count, data.assigned_to_me_count]
          : [data.aging_count]
        : [],
    ),
  );
  const priorities = available
    .flatMap(({ data, label, to }) => {
      if (!data) return [];
      return [
        ...("urgent_count" in data && data.urgent_count > 0
          ? [
              {
                label: "درخواست فوری",
                detail: label,
                count: data.urgent_count,
                to,
                urgent: true,
              },
            ]
          : []),
        ...(data.aging_count > 0
          ? [
              {
                label: `انتظار بیش از ${format(data.aging_after_hours)} ساعت`,
                detail: label,
                count: data.aging_count,
                to,
                urgent: false,
              },
            ]
          : []),
      ];
    })
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.count - a.count);

  return (
    <section className="mb-10 space-y-5" aria-label="تحلیل حجم کار">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            label: "در انتظار مسئول",
            value: total("unclaimed_count"),
            caption: "آماده پذیرش و شروع رسیدگی",
            icon: Inbox,
            color: "bg-info-soft text-info",
          },
          {
            label: "واگذارشده به من",
            value: total("assigned_to_me_count"),
            caption: "کارهایی که مسئول رسیدگی آن هستید",
            icon: UserRound,
            color: "bg-blush text-primary",
          },
          {
            label: "انتظار طولانی",
            value: total("aging_count"),
            caption: "عبور از زمان انتظار تعیین‌شده هر صف",
            icon: Clock3,
            color: "bg-sand text-foreground",
          },
        ].map(({ label, value, caption, icon: Icon, color }) => (
          <Card
            key={label}
            className="flex flex-col gap-5 rounded-2xl p-5 shadow-none sm:p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm font-medium">
                {label}
              </span>
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-xl",
                  color,
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
              </span>
            </div>
            <div className="text-4xl font-semibold tracking-tight tabular-nums">
              {value}
            </div>
            <p className="text-muted-foreground text-xs leading-6">{caption}</p>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground text-xs leading-6" role="status">
        {complete
          ? "آمار مربوط به صف‌های زیر است؛ موارد با انتظار طولانی می‌توانند در شمارش واگذاری هم باشند."
          : pending
            ? "در حال دریافت آمار صف‌ها…"
            : "آمار کامل در دسترس نیست؛ جمع کل تا دریافت همه صف‌ها نمایش داده نمی‌شود."}
      </p>
      <div className="grid items-stretch gap-5 lg:grid-cols-5">
        <Card className="flex flex-col gap-0 overflow-hidden rounded-2xl py-0 shadow-none lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b p-5 sm:p-6">
            <div>
              <h2 className="font-semibold">نبض صف‌ها</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                مقایسه حجم کار در همین لحظه
              </p>
            </div>
            <div
              className="bg-muted/60 flex rounded-lg p-1"
              role="group"
              aria-label="نوع نمودار"
            >
              {(
                [
                  { value: "assignment", label: "واگذاری" },
                  { value: "aging", label: "زمان انتظار" },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                  className={cn(
                    "focus-visible:outline-ring min-h-9 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                    view === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-7 p-5 sm:p-6">
            <div className="text-muted-foreground flex flex-wrap gap-5 text-xs">
              <span className="flex items-center gap-2">
                <span className="bg-info size-2.5 rounded-full" />
                {view === "assignment" ? "در انتظار مسئول" : "انتظار طولانی"}
              </span>
              {view === "assignment" && (
                <span className="flex items-center gap-2">
                  <span className="bg-primary size-2.5 rounded-full" />
                  واگذارشده به من
                </span>
              )}
            </div>
            {queues.map(({ label, to, data, isPending, isError }) => (
              <div key={to} className="space-y-3">
                <Link
                  to={to}
                  aria-label={`مشاهده صف ${label}`}
                  className="group hover:text-info flex items-center justify-between gap-3 text-sm font-medium"
                >
                  {label}
                  <ArrowLeft
                    className="text-muted-foreground size-4 transition-transform group-hover:-translate-x-1"
                    aria-hidden="true"
                  />
                </Link>
                {isPending ? (
                  <p className="text-muted-foreground text-xs">
                    در حال دریافت…
                  </p>
                ) : isError || !data ? (
                  <p className="text-destructive text-xs">
                    آمار این صف در دسترس نیست.
                  </p>
                ) : (
                  <div
                    className="space-y-2.5"
                    role="img"
                    aria-label={`${label}: ${view === "assignment" ? `${format(data.unclaimed_count)} در انتظار مسئول، ${format(data.assigned_to_me_count)} واگذارشده به من` : `${format(data.aging_count)} مورد با انتظار بیش از ${format(data.aging_after_hours)} ساعت`}`}
                  >
                    {(view === "assignment"
                      ? [data.unclaimed_count, data.assigned_to_me_count]
                      : [data.aging_count]
                    ).map((value, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3"
                        aria-hidden="true"
                      >
                        <div className="bg-muted/50 h-3 flex-1 overflow-hidden rounded-full">
                          <div
                            className={cn(
                              "h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500",
                              index === 0 ? "bg-info" : "bg-primary",
                            )}
                            style={{ width: `${(value / maximum) * 100}%` }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-end text-sm font-semibold tabular-nums">
                          {format(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <p className="text-muted-foreground border-t pt-4 text-xs leading-6">
              {view === "assignment"
                ? "این نمودار کارهای بدون مسئول و کارهای شما را نشان می‌دهد؛ واگذاری به دیگر اپراتورها در آن نیست."
                : "زمان انتظار هر صف جداگانه تعیین می‌شود؛ تعداد دقیق و آستانه هر صف در خلاصه آن آمده است."}
            </p>
          </div>
        </Card>
        <Card className="flex flex-col gap-0 rounded-2xl py-0 shadow-none lg:col-span-2">
          <div className="flex items-center gap-3 border-b p-5 sm:p-6">
            <span className="bg-blush text-primary flex size-10 items-center justify-center rounded-xl">
              <BellRing className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">اولویت رسیدگی</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                از اینجا شروع کنید
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
            {priorities.map(({ label, detail, count, to, urgent }) => (
              <Link
                key={`${to}-${label}`}
                to={to}
                className="group hover:bg-muted/40 flex items-center gap-3 rounded-xl border p-3 transition-colors"
              >
                <span
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-lg text-lg font-semibold tabular-nums",
                    urgent
                      ? "bg-blush text-primary"
                      : "bg-sand text-foreground",
                  )}
                >
                  {format(count)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {detail}
                  </span>
                </span>
                <ArrowLeft
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              </Link>
            ))}
            {priorities.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center py-7 text-center">
                <CheckCheck
                  className="text-info mb-3 size-8"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium">
                  {complete
                    ? "مورد فوری یا با انتظار طولانی ندارید"
                    : "اولویت‌ها پس از دریافت آمار مشخص می‌شوند"}
                </p>
                <p className="text-muted-foreground mt-2 text-xs leading-6">
                  {complete
                    ? "برای ادامه، کارهای در انتظار مسئول را بررسی کنید."
                    : "می‌توانید از بخش‌های پایین وارد صف کارها شوید."}
                </p>
              </div>
            )}
            {priorities.length > 0 && (
              <p className="text-muted-foreground mt-auto pt-3 text-xs leading-6">
                موارد فوری پیش از موارد با انتظار طولانی نمایش داده می‌شوند. یک
                درخواست ممکن است در هر دو گروه باشد.
              </p>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
