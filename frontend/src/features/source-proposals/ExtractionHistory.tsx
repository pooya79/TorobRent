import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import { PublicationOutcomes } from "./PublicationOutcomes";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { discoveryStopLabels } from "./discovery-labels";
import { ExtractionRunReview } from "./ExtractionRunReview";
import { readyForRunPublication } from "./run-results";
import type { components } from "@/lib/api/schema";

const stateLabels: Record<string, string> = {
  queued: "در صف",
  running: "در حال استخراج",
  complete: "پایان یافته",
  failed: "ناموفق",
  cancelled: "لغوشده",
};

export function ExtractionHistory({
  requests,
  review,
  remote = false,
}: {
  remote?: boolean;
  review?: { proposalId: string; canApprove: boolean };
  requests: components["schemas"]["ExtractionRequest"][];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = [...requests].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const selected =
    sorted.find((request) => request.id === selectedId) ??
    sorted.find(
      (request) =>
        request.is_current !== false &&
        request.state === "complete" &&
        (request.run?.ready_count ??
          request.run?.candidates?.filter(readyForRunPublication).length ??
          0) > 0,
    ) ??
    sorted.find((request) => request.is_current !== false) ??
    sorted[0];
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const technical = useQuery({
    queryKey: [
      "operator-source-proposals",
      review?.proposalId,
      "run-details",
      selected?.run?.id,
    ],
    enabled: remote && technicalOpen && Boolean(selected?.run && review),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/source-proposals/{proposal_id}/runs/{run_id}/",
        {
          params: {
            path: {
              proposal_id: review!.proposalId,
              run_id: selected!.run!.id,
            },
          },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
  });
  const technicalRun = remote ? technical.data?.run : selected?.run;
  const number = (value: number | undefined | null) =>
    value == null ? "—" : value.toLocaleString("fa-IR");
  return (
    <section className="grid gap-5" aria-label="درخواست‌های اخیر استخراج">
      <div>
        <h3 className="font-semibold">نوبت‌های اخیر استخراج</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          هر ردیف یک بار پردازش سایت است. یک نوبت را انتخاب کنید تا آگهی‌های آن
          را در جدول پایین بررسی کنید. آمار هر نوبت مستقل است و ممکن است آگهی‌ها
          در چند نوبت تکرار شده باشند.
        </p>
      </div>
      {!requests.length ? (
        <p className="rounded-xl border border-dashed p-8 text-center">
          هنوز درخواست استخراجی ثبت نشده است.
        </p>
      ) : (
        <div
          role="region"
          aria-label="جدول نوبت‌های استخراج"
          tabIndex={0}
          className="overflow-x-auto rounded-xl border"
        >
          <table className="w-full min-w-192 text-sm">
            <caption className="sr-only">
              نوبت‌های اخیر استخراج، از تازه به قدیمی
            </caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {[
                  "نشانی و زمان",
                  "وضعیت اجرا",
                  "آگهی استخراج‌شده",
                  "انتشار موفق",
                  "نتیجه انتشار",
                  "آماده تأیید",
                  "بررسی",
                ].map((label) => (
                  <th
                    scope="col"
                    key={label}
                    className="p-3 text-start font-medium"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((request) => (
                <tr
                  key={request.id}
                  className={`border-t align-top ${selected?.id === request.id ? "bg-primary/5" : ""}`}
                >
                  <th
                    scope="row"
                    className="max-w-80 min-w-56 p-3 text-start font-normal"
                  >
                    <p dir="ltr" className="break-all">
                      {request.canonical_url}
                    </p>
                    <time
                      dateTime={request.created_at}
                      className="text-muted-foreground mt-2 block text-xs"
                    >
                      {new Date(request.created_at).toLocaleString("fa-IR")}
                    </time>
                  </th>
                  <td className="p-3">
                    <Badge
                      variant={
                        request.state === "failed" ? "destructive" : "secondary"
                      }
                    >
                      {stateLabels[request.state]}
                    </Badge>
                    {request.is_current === false && (
                      <p className="text-muted-foreground mt-2 text-xs">
                        سابقه؛ بدون مجوز انتشار
                      </p>
                    )}
                  </td>
                  <td className="p-3 tabular-nums">
                    {number(request.run?.extracted)}
                  </td>
                  <td className="p-3 tabular-nums">
                    {number(request.run?.published)}
                  </td>
                  <td className="min-w-64 p-3">
                    {request.run ? (
                      <PublicationOutcomes run={request.run} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 tabular-nums">
                    {request.is_current === false
                      ? "—"
                      : number(
                          request.run?.ready_count ??
                            request.run?.candidates?.filter(
                              readyForRunPublication,
                            ).length,
                        )}
                  </td>
                  <td className="p-3">
                    <Button
                      size="sm"
                      variant={
                        selected?.id === request.id ? "default" : "outline"
                      }
                      aria-pressed={selected?.id === request.id}
                      aria-controls="selected-extraction-results"
                      onClick={() => setSelectedId(request.id)}
                    >
                      {selected?.id === request.id
                        ? "در حال نمایش"
                        : "نمایش آگهی‌ها"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <div
          id="selected-extraction-results"
          onFocusCapture={() => setSelectedId(selected.id)}
          className="grid gap-4 rounded-xl border p-4 sm:p-5"
        >
          {selected.is_current === false && (
            <p className="bg-muted rounded-lg p-3 text-sm">
              سابقه استخراج؛ مجوز انتشار این نتایج پایان یافته است.
            </p>
          )}
          {selected.run?.errors?.length ? (
            <div
              role="status"
              className="border-destructive/30 rounded-lg border p-3"
            >
              <p className="font-medium">این نوبت خطای ثبت‌شده دارد</p>
              <p className="text-sm">
                {selected.run.errors[selected.run.errors.length - 1]?.detail}
              </p>
            </div>
          ) : null}
          <details
            className="text-sm"
            onToggle={(e) => setTechnicalOpen(e.currentTarget.open)}
          >
            <summary className="text-muted-foreground cursor-pointer">
              جزئیات فنی این نوبت و صفحات کنارگذاشته‌شده
            </summary>
            <div className="mt-3 grid gap-3">
              {selected.target_detail_pages != null && (
                <p>
                  هدف: {number(selected.target_detail_pages)} آگهی اجاره؛ سقف
                  بررسی: {number(selected.max_pages)} صفحه
                </p>
              )}
              {technicalRun && (
                <>
                  <p>
                    تعداد تلاش: {number(technicalRun.attempts)} · صفحه
                    بررسی‌شده: {number(technicalRun.attempted_pages)}
                  </p>
                  {technicalRun.discovery_stop_reason && (
                    <p>
                      {discoveryStopLabels[technicalRun.discovery_stop_reason]}
                    </p>
                  )}
                  {(technicalRun.skipped_pages ?? []).map((page) => (
                    <p key={page.url}>
                      کنار گذاشته شده: <bdi>{page.url}</bdi> · {page.reason}
                    </p>
                  ))}
                  {technicalRun.errors?.map((error, index) => (
                    <p key={index}>
                      {error.transient ? "خطای موقت: " : ""}
                      {error.detail}
                    </p>
                  ))}
                </>
              )}
            </div>
          </details>
          {selected.run && review ? (
            <ExtractionRunReview
              key={selected.run.id}
              run={selected.run}
              remote={remote}
              {...review}
              canApprove={review.canApprove && selected.is_current !== false}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              این درخواست هنوز نتیجه استخراجی ندارد. وضعیت پس از شروع پردازش
              به‌روز می‌شود.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
