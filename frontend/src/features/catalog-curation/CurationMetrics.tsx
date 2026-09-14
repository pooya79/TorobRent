import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { catalogCurationMetricsQuery } from "./queries";
const bandLabels = {
  likely: "محتمل",
  possible: "ممکن",
  below_threshold: "پایین‌تر از آستانه",
};
export function CurationMetrics() {
  const metrics = useQuery(catalogCurationMetricsQuery());
  return (
    <>
      {metrics.data ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            [
              "کل پیشنهادها",
              metrics.data.suggestion_count.toLocaleString("fa-IR"),
            ],
            [
              "در انتظار بررسی",
              metrics.data.pending_count.toLocaleString("fa-IR"),
            ],
            [
              "سن قدیمی‌ترین پیشنهاد",
              metrics.data.oldest_suggestion_age_hours == null
                ? "—"
                : `${Math.round(metrics.data.oldest_suggestion_age_hours).toLocaleString("fa-IR")} ساعت`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="bg-muted/30 rounded-2xl border p-5">
              <p className="text-muted-foreground text-sm">{label}</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums">
                {value}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <section
        className="rounded-2xl border p-5"
        aria-labelledby="metrics-title"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="metrics-title" className="text-2xl font-semibold">
              معیارهای عملیاتی
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              نرخ تصمیم‌ها فقط برای ارزیابی نسخه امتیازدهی است و وزن‌ها یا
              آستانه‌ها را تغییر نمی‌دهد.
            </p>
          </div>
          {metrics.data ? (
            <Badge variant="secondary">
              {metrics.data.pending_count.toLocaleString("fa-IR")} پیشنهاد در
              انتظار
            </Badge>
          ) : null}
        </div>
        {metrics.isPending ? <p role="status">در حال دریافت معیارها…</p> : null}
        {metrics.isError ? (
          <Alert variant="destructive">
            <AlertTitle>معیارهای عملیاتی دریافت نشد</AlertTitle>
            <AlertDescription>
              <Button
                variant="outline"
                disabled={metrics.isFetching}
                onClick={() => void metrics.refetch()}
              >
                تلاش دوباره
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {metrics.data ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <caption className="sr-only">
                معیارها بر پایه نوار اطمینان و نسخه امتیازدهی
              </caption>
              <thead>
                <tr className="bg-muted/50 text-muted-foreground border-b text-start">
                  <th className="p-4 text-start">نوار اطمینان</th>
                  <th className="p-4 text-start">نسخه</th>
                  <th className="p-4 text-start">تعداد</th>
                  <th className="p-4 text-start">قدیمی‌ترین (ساعت)</th>
                  <th className="p-4 text-start">پذیرش</th>
                  <th className="p-4 text-start">رد</th>
                </tr>
              </thead>
              <tbody>
                {metrics.data.breakdowns.map((item) => (
                  <tr
                    key={`${item.band}:${item.scoring_version}`}
                    className="border-b last:border-0"
                  >
                    <td className="p-4">
                      {bandLabels[item.band as keyof typeof bandLabels] ??
                        item.band}
                    </td>
                    <td className="p-4" dir="ltr">
                      {item.scoring_version}
                    </td>
                    <td className="p-4">
                      {item.suggestion_count.toLocaleString("fa-IR")}
                    </td>
                    <td className="p-4">
                      {Math.round(item.oldest_age_hours).toLocaleString(
                        "fa-IR",
                      )}
                    </td>
                    <td className="p-4">
                      {Math.round(item.acceptance_rate * 100).toLocaleString(
                        "fa-IR",
                      )}
                      ٪
                    </td>
                    <td className="p-4">
                      {Math.round(item.rejection_rate * 100).toLocaleString(
                        "fa-IR",
                      )}
                      ٪
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
