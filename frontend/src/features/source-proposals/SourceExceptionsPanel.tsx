import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import {
  operatorSourceProposalsQueryOptions,
  sourceProposalsQueryOptions,
} from "./queries";

type Exception = components["schemas"]["SourceExtractionException"];
const labels: Record<string, string> = {
  candidate_checks: "بررسی اطلاعات",
  open: "مشکل استخراج",
  resolved: "رفع شده",
  excluded: "کنار گذاشته شده",
  timeout: "مهلت دریافت صفحه",
  extraction_failed: "خطای استخراج",
};
const date = (value: string) => new Date(value).toLocaleString("fa-IR");

export function SourceExceptionsPanel({
  exceptions,
  proposalId,
  canRetry,
  operator = false,
}: {
  exceptions: Exception[];
  proposalId: string;
  canRetry: boolean;
  operator?: boolean;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await api.POST(
        operator
          ? "/api/v1/operator/source-proposals/{proposal_id}/exceptions/retry/"
          : "/api/v1/source-proposals/{proposal_id}/exceptions/retry/",
        {
          params: { path: { proposal_id: proposalId } },
          body: { exception_ids: ids },
        },
      );
      if (error || !data) throw apiError(error);
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: operator
          ? operatorSourceProposalsQueryOptions.queryKey
          : sourceProposalsQueryOptions.queryKey,
      });
    },
  });
  const groups = new Map<string, Exception[]>();
  for (const item of exceptions) {
    const key = item.state === "open" ? item.problem : item.state;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <section className="grid gap-3" aria-label="مشکلات استخراج منبع">
      <h4 className="font-semibold">مشکلات استخراج منبع</h4>
      <p>
        مشکلات باز:{" "}
        {exceptions
          .filter((item) => item.state === "open")
          .length.toLocaleString("fa-IR")}
      </p>
      <p>
        اصلاح دستی یک نتیجه، مشکل استخراج منبع را رفع نمی‌کند. پس از بررسی
        وب‌سایت، استخراج دوباره درخواست کنید. هر بار حداکثر ۲۰ صفحه را انتخاب
        می‌کنیم.
      </p>
      <p>
        {operator
          ? "خلاصه تغییرات مشکلات حداکثر روزی یک بار ارسال می‌شود. برای درخواست اقدام از نماینده، در گفت‌وگوی منبع پیام بفرستید."
          : "این فهرست برای بررسی صفحه‌های منبع است. درخواست اقدام فقط در گفت‌وگوی منبع و با پیام اپراتور مسئول مطرح می‌شود."}
      </p>
      {exceptions.length === 0 && <p>مشکلی ثبت نشده است.</p>}
      {[...groups].map(([problem, pages]) => (
        <section key={problem} className="grid gap-2 rounded-lg border p-3">
          <h5 className="font-semibold">
            {labels[problem] ?? "دریافت یا استخراج ناموفق"} ·{" "}
            {pages.length.toLocaleString("fa-IR")}
          </h5>
          {canRetry && pages.some((page) => !page.exclusion_reason) && (
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate(
                  pages
                    .filter((page) => !page.exclusion_reason)
                    .slice(0, 20)
                    .map((page) => page.id),
                )
              }
            >
              استخراج دوباره گروه
            </Button>
          )}
          <div
            role="region"
            aria-label={`جدول ${labels[problem] ?? "مشکلات صفحات"}`}
            tabIndex={0}
            className="overflow-x-auto rounded-lg border"
          >
            <table className="w-full min-w-160 text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {["صفحه", "مشکل یا نتیجه", "آخرین بررسی", "اقدام"].map(
                    (label) => (
                      <th
                        scope="col"
                        key={label}
                        className="p-3 text-start font-medium"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.id} className="border-t align-top">
                    <th
                      scope="row"
                      className="max-w-72 p-3 text-start font-normal"
                    >
                      <a
                        href={page.canonical_url}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="block text-start break-all underline"
                      >
                        {page.canonical_url}
                      </a>
                    </th>
                    <td className="max-w-72 p-3">
                      {page.exclusion_reason || page.detail}
                    </td>
                    <td className="p-3">
                      <time dateTime={page.last_attempt_at}>
                        {date(page.last_attempt_at)}
                      </time>
                      <details className="mt-3">
                        <summary className="text-muted-foreground cursor-pointer">
                          تاریخچه تلاش‌ها
                        </summary>
                        {page.first_occurrence && (
                          <p className="mt-2">
                            اولین رخداد: {date(page.first_occurrence)}
                          </p>
                        )}
                        <ol className="mt-2 grid gap-2">
                          {page.history.map((attempt) => (
                            <li key={`${attempt.run}-${attempt.attempt}`}>
                              {date(attempt.attempted_at)} · تلاش{" "}
                              {attempt.attempt.toLocaleString("fa-IR")} ·{" "}
                              {labels[attempt.state] ?? attempt.state} ·{" "}
                              {attempt.detail}
                              {!attempt.is_current &&
                                " · نتیجه قدیمی؛ وضعیت فعلی را تغییر نداده است"}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </td>
                    <td className="p-3">
                      {canRetry && !page.exclusion_reason ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate([page.id])}
                        >
                          استخراج دوباره صفحه
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">
                          {page.exclusion_reason
                            ? "خارج از محدوده پردازش"
                            : "فقط مشاهده"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      {mutation.isSuccess && (
        <p role="status">درخواست استخراج دوباره ثبت شد.</p>
      )}
    </section>
  );
}
