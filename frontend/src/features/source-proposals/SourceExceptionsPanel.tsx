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
          {pages.map((page) => (
            <article key={page.id} className="grid gap-2 border-t pt-2">
              <a
                href={page.canonical_url}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="break-all underline"
              >
                {page.canonical_url}
              </a>
              <p>{page.exclusion_reason || page.detail}</p>
              {page.first_occurrence && (
                <p>اولین رخداد: {date(page.first_occurrence)}</p>
              )}
              <p>آخرین تلاش: {date(page.last_attempt_at)}</p>
              {canRetry && !page.exclusion_reason && (
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate([page.id])}
                >
                  استخراج دوباره صفحه
                </Button>
              )}
              <details>
                <summary>تاریخچه تلاش‌ها</summary>
                <ol className="grid gap-2 p-2">
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
            </article>
          ))}
        </section>
      ))}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      {mutation.isSuccess && (
        <p role="status">درخواست استخراج دوباره ثبت شد.</p>
      )}
    </section>
  );
}
