import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Play, ShieldBan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { apiError, errorMessage } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import type { OperatorSourceProposal } from "./queries";

type Control = components["schemas"]["SourceCrawlControlRequest"];
const intervals = [
  [0, "فقط دستی"],
  [1, "هر ساعت"],
  [6, "هر ۶ ساعت"],
  [12, "هر ۱۲ ساعت"],
  [24, "روزانه"],
  [72, "هر ۳ روز"],
  [168, "هفتگی"],
] as const;

export function SourceCrawlPanel({
  proposal,
  onUpdate,
  onExclusions,
}: {
  proposal: OperatorSourceProposal;
  onUpdate: (proposal: OperatorSourceProposal) => void;
  onExclusions: () => void;
}) {
  const source = proposal.assignment!.source;
  const [url, setUrl] = useState(proposal.website_url ?? "");
  const [schedule, setSchedule] = useState<{
    interval: (typeof intervals)[number][0];
    revision: number;
  } | null>(null);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (body: Control) => {
      const { data, error } = await api.POST(
        "/api/v1/operator/source-proposals/{proposal_id}/crawl/",
        {
          params: { path: { proposal_id: proposal.id } },
          body,
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: (updated, body) => {
      if (body.action === "schedule") setSchedule(null);
      onUpdate(updated);
      void client.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
    },
    onError: (_error, body) => {
      if (body.action === "schedule") setSchedule(null);
      void client.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
    },
  });
  return (
    <section
      aria-label="دریافت صفحات و زمان‌بندی"
      className="grid gap-5 rounded-xl border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">دریافت صفحات و زمان‌بندی</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            همین حالا اطلاعات را تازه کنید یا دریافت منظم از نشانی اصلی وب‌سایت
            را تنظیم کنید.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onExclusions}>
          <ShieldBan aria-hidden="true" />
          مدیریت صفحات مسدود
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <form
          className="grid content-start gap-3"
          aria-label="اجرای دستی استخراج"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({ action: "run", url });
          }}
        >
          <h4 className="flex items-center gap-2 font-medium">
            <Play className="size-4" aria-hidden="true" />
            اجرای دستی
          </h4>
          <Label htmlFor="crawl-entry-url">نشانی شروع دریافت</Label>
          <Input
            id="crawl-entry-url"
            type="url"
            dir="ltr"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={mutation.isPending || source.processing_paused}
          />
          <p className="text-muted-foreground text-sm">
            برای بررسی صفحات بیشتر، نشانی یک دسته یا صفحه دیگر از همین دامنه را
            وارد کنید. حدود پروفایل و صفحات مسدود در هر اجرا رعایت می‌شوند.
          </p>
          <Button
            disabled={
              mutation.isPending || source.processing_paused || !url.trim()
            }
          >
            <Play aria-hidden="true" />
            {mutation.isPending && mutation.variables.action === "run"
              ? "در حال ثبت درخواست…"
              : "دریافت و به‌روزرسانی اکنون"}
          </Button>
          <p className="text-muted-foreground text-xs">
            درخواست مشابه در صف یا در حال اجرا دوباره ساخته نمی‌شود. اجرای دستی،
            زمان دریافت بعدی را تغییر نمی‌دهد.
          </p>
          {source.processing_paused && (
            <p role="status" className="text-sm">
              برای اجرای دستی، ابتدا پردازش منبع را از سر بگیرید.
            </p>
          )}
        </form>
        <form
          className="grid content-start gap-3"
          aria-label="برنامه دریافت خودکار"
          onSubmit={(event) => {
            event.preventDefault();
            if (!schedule) return;
            mutation.mutate({
              action: "schedule",
              interval_hours: schedule.interval,
              reviewed_schedule_revision: schedule.revision,
            });
          }}
        >
          <h4 className="flex items-center gap-2 font-medium">
            <CalendarClock className="size-4" aria-hidden="true" />
            برنامه دریافت خودکار
          </h4>
          <Label htmlFor="crawl-interval">فاصله دریافت اطلاعات</Label>
          <select
            id="crawl-interval"
            className="bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={schedule?.interval ?? source.crawl_interval_hours ?? 0}
            disabled={mutation.isPending}
            onChange={(event) => {
              const interval = intervals.find(
                ([value]) => value === Number(event.target.value),
              )![0];
              setSchedule({
                interval,
                revision: schedule?.revision ?? source.crawl_schedule_revision,
              });
              mutation.reset();
            }}
          >
            {intervals.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-sm">
            اولین نوبت پس از فاصله انتخاب‌شده از زمان ذخیره است. در حالت توقف،
            برنامه اجرا نمی‌شود. انتشار نتایج از روش انتشار ذخیره‌شده پیروی
            می‌کند.
          </p>
          <Button
            variant="outline"
            disabled={
              mutation.isPending ||
              schedule === null ||
              schedule.interval === (source.crawl_interval_hours ?? 0)
            }
          >
            {mutation.isPending && mutation.variables.action === "schedule"
              ? "در حال ذخیره…"
              : "ذخیره برنامه دریافت"}
          </Button>
        </form>
      </div>
      {mutation.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage(
            mutation.error,
            "ثبت درخواست ممکن نشد؛ دوباره تلاش کنید.",
          )}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="bg-primary/5 rounded-lg p-3 text-sm">
          {mutation.variables.action === "run"
            ? "درخواست در صف دریافت است؛ پیشرفت و نتایج در وضعیت پردازش نمایش داده می‌شود."
            : "برنامه دریافت ذخیره شد."}
        </p>
      )}
    </section>
  );
}
