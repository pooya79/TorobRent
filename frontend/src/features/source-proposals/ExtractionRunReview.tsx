import { useCaseRecords } from "./CaseRecords";
import { candidateValidationMessages } from "./candidate-validation";
import { useState } from "react";
import { Link } from "react-router";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  normalizeListingSearch,
  rentalAmount,
} from "./external-listing-workflow";
import {
  readyForRunPublication,
  runResultGroup,
  runResultLabels,
  runResultStatus,
} from "./run-results";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import {
  operatorSourceProposalsQueryOptions,
  operatorExternalListingCandidatesQueryOptions,
} from "./queries";
import type { components } from "@/lib/api/schema";

export function ExtractionRunReview({
  run,
  proposalId,
  canApprove,
  properties,
  remote = false,
}: {
  remote?: boolean;
  run?: components["schemas"]["ExtractionRun"];
  proposalId: string;
  canApprove: boolean;
  properties?: components["schemas"]["ExternalListingCandidate"][];
}) {
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(
    null,
  );
  const confirmed = confirmedRevision === run?.revision;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "all" | "ready" | "issues" | "published" | "archived"
  >("all");
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();
  const approval = useMutation({
    mutationFn: async () => {
      if (!run) throw new Error("نوبت استخراج انتخاب نشده است.");
      const { data, error } = await api.POST(
        "/api/v1/operator/source-proposals/{proposal_id}/runs/{run_id}/approve/",
        {
          params: { path: { proposal_id: proposalId, run_id: run?.id } },
          body: { reviewed_revision: run?.revision, confirmed: true },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onError: () => setConfirmedRevision(null),
    onSuccess: async () => {
      setConfirmedRevision(null);
      await Promise.all(
        [
          operatorSourceProposalsQueryOptions,
          operatorExternalListingCandidatesQueryOptions,
        ].map((options) =>
          queryClient.invalidateQueries({ queryKey: options.queryKey }),
        ),
      );
    },
  });
  const records = useCaseRecords("results", proposalId, page, search, {
    enabled: remote,
    status: filter,
    run: run?.id,
  });
  const candidates = remote
    ? (records.data?.results ?? []).map((c) => ({
        ...c,
        media: [],
        history: [],
      }))
    : (properties ?? run?.candidates ?? []);
  const pending = candidates.filter(readyForRunPublication);
  const filtered = remote
    ? candidates
    : candidates.filter(
        (candidate) =>
          (filter === "all" || runResultGroup(candidate) === filter) &&
          normalizeListingSearch(
            `${candidate.title} ${candidate.external_url}`,
          ).includes(normalizeListingSearch(search)),
      );
  const total = remote ? (records.data?.count ?? 0) : filtered.length;
  const pendingCount =
    remote && run ? (run.ready_count ?? pending.length) : pending.length;
  const lastPage = Math.max(0, Math.ceil(total / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = remote
    ? filtered
    : filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  return (
    <section className="grid gap-4" aria-label="بررسی نتایج استخراج">
      {!properties && (
        <div>
          <h4 className="font-semibold">آگهی‌های این نوبت استخراج</h4>
          <p className="text-muted-foreground mt-2 text-sm">
            برای مشاهده مشخصات و تصمیم درباره یک ملک، ردیف آن را باز کنید.
            انتشار گروهی در پایین جدول است.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2" aria-label="فیلتر نتایج استخراج">
        {[["all", "همه نتایج"], ...Object.entries(runResultLabels)].map(
          ([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value as typeof filter);
                setPage(0);
              }}
            >
              {label}
              {!remote && (
                <>
                  {" "}
                  ·{" "}
                  {(value === "all"
                    ? candidates.length
                    : candidates.filter(
                        (candidate) => runResultGroup(candidate) === value,
                      ).length
                  ).toLocaleString("fa-IR")}
                </>
              )}
            </Button>
          ),
        )}
      </div>
      <div className="grid max-w-md gap-2">
        <Label htmlFor={`result-search-${run?.id}`}>
          جست‌وجوی عنوان یا نشانی آگهی
        </Label>
        <Input
          id={`result-search-${run?.id}`}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </div>
      <p role="status" className="text-muted-foreground text-sm">
        {total.toLocaleString("fa-IR")} نتیجه مطابق فیلتر ·{" "}
        {pendingCount.toLocaleString("fa-IR")}{" "}
        {properties ? "ملک آماده تأیید" : "نتیجه آماده تأیید در کل این نوبت"}
      </p>
      {remote && records.isPending && <p role="status">در حال بارگذاری…</p>}
      {remote && records.isError && (
        <p role="alert">
          بارگذاری نتایج ناموفق بود.{" "}
          <Button onClick={() => void records.refetch()}>تلاش دوباره</Button>
        </p>
      )}
      {!visible.length ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm">
          {candidates.length
            ? "نتیجه‌ای مطابق جست‌وجو یا فیلتر پیدا نشد."
            : run?.state === "running" || run?.state === "queued"
              ? "استخراج هنوز تمام نشده است. نتایج با ثبت پیشرفت نمایش داده می‌شوند."
              : properties
                ? "هنوز ملکی از این وب‌سایت استخراج نشده است. وضعیت دریافت صفحات را در بخش پردازش و انتشار ببینید."
                : "آگهی‌ای در این نوبت استخراج ثبت نشده است."}
        </p>
      ) : (
        <div
          role="region"
          aria-label="جدول آگهی‌های استخراج‌شده"
          tabIndex={0}
          className="overflow-x-auto rounded-xl border"
        >
          <table className="w-full text-start text-sm sm:min-w-192">
            <caption className="sr-only">
              {properties
                ? "ملک‌های وب‌سایت؛ مبلغ‌ها به تومان"
                : "آگهی‌های این نوبت استخراج؛ مبلغ‌ها به تومان"}
            </caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {[
                  "آگهی",
                  "وضعیت",
                  "متراژ",
                  "رهن / اجاره ماهانه (تومان)",
                  "بررسی",
                ].map((label, index) => (
                  <th
                    scope="col"
                    key={label}
                    className={`${index > 0 && index < 4 ? "hidden sm:table-cell" : ""} p-3 text-start font-medium`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((candidate) => {
                const group = runResultGroup(candidate);
                const messages = candidateValidationMessages(candidate);
                return (
                  <tr key={candidate.id} className="border-t align-top">
                    <th
                      scope="row"
                      className="max-w-80 p-3 text-start font-normal"
                    >
                      <p className="font-medium">
                        {candidate.title || "بدون عنوان"}
                      </p>
                      <a
                        href={candidate.external_url}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="text-muted-foreground mt-2 block text-start break-all underline underline-offset-4"
                      >
                        {candidate.external_url}
                      </a>
                      <p className="mt-2 text-xs sm:hidden">
                        {runResultStatus(candidate)}
                      </p>
                    </th>
                    <td className="hidden max-w-64 p-3 sm:table-cell">
                      <Badge
                        variant={
                          group === "issues" ? "destructive" : "secondary"
                        }
                      >
                        {runResultStatus(candidate)}
                      </Badge>
                      {messages[0] && group === "issues" && (
                        <p className="text-muted-foreground mt-2 text-xs">
                          {messages[0]}
                        </p>
                      )}
                      {candidate.exclusion_reason && (
                        <p className="mt-2 text-xs">
                          {candidate.exclusion_reason}
                        </p>
                      )}
                    </td>
                    <td className="hidden p-3 whitespace-nowrap sm:table-cell">
                      {candidate.area_sqm?.toLocaleString("fa-IR") ?? "نامشخص"}{" "}
                      متر
                    </td>
                    <td className="hidden p-3 whitespace-nowrap sm:table-cell">
                      <p>{rentalAmount(candidate.deposit_rial)}</p>
                      <p className="text-muted-foreground mt-2">
                        {rentalAmount(candidate.monthly_rent_rial)}
                      </p>
                    </td>
                    <td className="p-3">
                      <Button
                        asChild
                        size="sm"
                        variant={group === "issues" ? "default" : "outline"}
                      >
                        <Link
                          to={`/operator/source-proposals/${proposalId}?candidate=${candidate.id}#exceptions`}
                        >
                          {group === "published" || group === "archived"
                            ? "مشاهده ملک"
                            : "بررسی آگهی"}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > 20 && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            صفحه قبل
          </Button>
          <span className="text-sm">
            صفحه {(currentPage + 1).toLocaleString("fa-IR")} از{" "}
            {(lastPage + 1).toLocaleString("fa-IR")}
          </span>
          <Button
            variant="outline"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            صفحه بعد
          </Button>
        </div>
      )}
      {run && !canApprove && pendingCount > 0 && (
        <p className="text-muted-foreground rounded-xl border p-3 text-sm">
          انتشار از این نوبت در دسترس نیست. به مسئولیت منبع، پردازش فعال و
          درخواست جاری نیاز دارید.
        </p>
      )}
      {run && run.state !== "complete" && (
        <p className="text-muted-foreground text-sm">
          انتشار گروهی پس از پایان موفق استخراج در دسترس قرار می‌گیرد.
        </p>
      )}
      {run && canApprove && run.state === "complete" && pendingCount > 0 && (
        <div className="bg-primary/5 grid gap-3 rounded-xl border p-4">
          <h5 className="font-semibold">تأیید انتشار این نوبت</h5>
          <p className="text-sm">
            این اقدام همه {pendingCount.toLocaleString("fa-IR")} نتیجه آماده
            تأیید در این نوبت را شامل می‌شود، حتی ردیف‌های خارج از فیلتر یا صفحه
            فعلی. اعتبار نتایج هنگام انتشار دوباره بررسی می‌شود.
          </p>
          <label className="flex items-center gap-2">
            <Input
              type="checkbox"
              className="size-4"
              checked={confirmed}
              onChange={(event) =>
                setConfirmedRevision(
                  event.target.checked ? run?.revision : null,
                )
              }
            />
            نتایج را بررسی و انتشار همه موارد آماده تأیید این نوبت را تأیید
            می‌کنم
          </label>
          <Button
            disabled={!confirmed || approval.isPending}
            onClick={() => approval.mutate()}
          >
            انتشار همه نتایج معتبر
          </Button>
        </div>
      )}
      {approval.isError && (
        <p role="alert">
          {approval.error.message} نتایج را دوباره بارگیری کنید.
        </p>
      )}
      {approval.isSuccess && <p role="status">نتایج معتبر منتشر شد.</p>}
    </section>
  );
}
