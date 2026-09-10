import { CandidateEvidence } from "./CandidateEvidence";
import { Fragment, useState } from "react";
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
}: {
  run: components["schemas"]["ExtractionRun"];
  proposalId: string;
  canApprove: boolean;
}) {
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(
    null,
  );
  const confirmed = confirmedRevision === run.revision;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const approval = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/source-proposals/{proposal_id}/runs/{run_id}/approve/",
        {
          params: { path: { proposal_id: proposalId, run_id: run.id } },
          body: { reviewed_revision: run.revision, confirmed: true },
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
  const candidates = run.candidates ?? [];
  const pending = candidates.filter(readyForRunPublication);
  const filtered = candidates.filter(
    (candidate) =>
      (filter === "all" || runResultGroup(candidate) === filter) &&
      normalizeListingSearch(
        `${candidate.title} ${candidate.external_url}`,
      ).includes(normalizeListingSearch(search)),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  return (
    <section className="grid gap-4" aria-label="بررسی نتایج استخراج">
      <div>
        <h4 className="font-semibold">آگهی‌های این نوبت استخراج</h4>
        <p className="text-muted-foreground mt-2 text-sm">
          وضعیت هر آگهی را ببینید. برای مشاهده شواهد، جزئیات ردیف را باز کنید؛
          اصلاح اطلاعات در پرونده آگهی انجام می‌شود.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="فیلتر نتایج استخراج">
        {[["all", "همه نتایج"], ...Object.entries(runResultLabels)].map(
          ([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value!);
                setPage(0);
              }}
            >
              {label} ·{" "}
              {(value === "all"
                ? candidates.length
                : candidates.filter(
                    (candidate) => runResultGroup(candidate) === value,
                  ).length
              ).toLocaleString("fa-IR")}
            </Button>
          ),
        )}
      </div>
      <div className="grid max-w-md gap-2">
        <Label htmlFor={`result-search-${run.id}`}>
          جست‌وجوی عنوان یا نشانی آگهی
        </Label>
        <Input
          id={`result-search-${run.id}`}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </div>
      <p role="status" className="text-muted-foreground text-sm">
        {filtered.length.toLocaleString("fa-IR")} نتیجه مطابق فیلتر ·{" "}
        {pending.length.toLocaleString("fa-IR")} نتیجه آماده تأیید در کل این
        نوبت
      </p>
      {!visible.length ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm">
          {candidates.length
            ? "نتیجه‌ای مطابق جست‌وجو یا فیلتر پیدا نشد."
            : run.state === "running" || run.state === "queued"
              ? "استخراج هنوز تمام نشده است. نتایج با ثبت پیشرفت نمایش داده می‌شوند."
              : "آگهی‌ای در این نوبت استخراج ثبت نشده است."}
        </p>
      ) : (
        <div
          role="region"
          aria-label="جدول آگهی‌های استخراج‌شده"
          tabIndex={0}
          className="overflow-x-auto rounded-xl border"
        >
          <table className="w-full min-w-192 text-start text-sm">
            <caption className="sr-only">
              آگهی‌های این نوبت استخراج؛ مبلغ‌ها به تومان
            </caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {[
                  "آگهی",
                  "وضعیت",
                  "متراژ",
                  "رهن / اجاره ماهانه (تومان)",
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
              {visible.map((candidate) => {
                const group = runResultGroup(candidate);
                const messages = Object.values(
                  candidate.validation_errors ?? {},
                ).flatMap((value) =>
                  Array.isArray(value) ? value.map(String) : [String(value)],
                );
                return (
                  <Fragment key={candidate.id}>
                    <tr className="border-t align-top">
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
                      </th>
                      <td className="max-w-64 p-3">
                        <Badge
                          variant={
                            group === "issues" ? "destructive" : "secondary"
                          }
                        >
                          {candidate.superseded
                            ? "جایگزین شده"
                            : candidate.exclusion_reason
                              ? "محدودیت انتشار"
                              : candidate.state === "rejected"
                                ? "رد شده"
                                : candidate.state === "cancelled"
                                  ? "لغو شده"
                                  : runResultLabels[group]}
                        </Badge>
                        {messages[0] && (
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
                      <td className="p-3 whitespace-nowrap">
                        {candidate.area_sqm?.toLocaleString("fa-IR") ??
                          "نامشخص"}{" "}
                        متر
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <p>{rentalAmount(candidate.deposit_rial)}</p>
                        <p className="text-muted-foreground mt-2">
                          {rentalAmount(candidate.monthly_rent_rial)}
                        </p>
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-expanded={expanded === candidate.id}
                          aria-controls={`result-${candidate.id}`}
                          onClick={() =>
                            setExpanded(
                              expanded === candidate.id ? null : candidate.id,
                            )
                          }
                        >
                          جزئیات
                        </Button>
                        <Link
                          className="text-primary mt-3 block text-xs underline"
                          to={`/operator/external-listings?proposal=${proposalId}&candidate=${candidate.id}`}
                        >
                          پرونده آگهی
                        </Link>
                      </td>
                    </tr>
                    {expanded === candidate.id && (
                      <tr
                        id={`result-${candidate.id}`}
                        className="bg-muted/20 border-t"
                      >
                        <td colSpan={5} className="p-4">
                          <div className="grid gap-3">
                            <p className="font-medium">
                              جزئیات {candidate.title || "آگهی"}
                            </p>
                            {candidate.superseded && (
                              <p>با نتیجه استخراج تازه جایگزین شده است.</p>
                            )}
                            {candidate.exclusion_hold &&
                              !candidate.exclusion_reason && (
                                <p>
                                  محدودیت برداشته شده؛ انتشار این نتیجه نیازمند
                                  تأیید صریح است.
                                </p>
                              )}
                            {messages.map((message, index) => (
                              <p key={index} className="text-sm">
                                {message}
                              </p>
                            ))}
                            <CandidateEvidence
                              candidate={candidate}
                              showValidation={false}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 20 && (
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
      {!canApprove && pending.length > 0 && (
        <p className="text-muted-foreground rounded-xl border p-3 text-sm">
          انتشار از این نوبت در دسترس نیست. به مسئولیت منبع، پردازش فعال و
          درخواست جاری نیاز دارید.
        </p>
      )}
      {run.state !== "complete" && (
        <p className="text-muted-foreground text-sm">
          انتشار گروهی پس از پایان موفق استخراج در دسترس قرار می‌گیرد.
        </p>
      )}
      {canApprove && run.state === "complete" && pending.length > 0 && (
        <div className="bg-primary/5 grid gap-3 rounded-xl border p-4">
          <h5 className="font-semibold">تأیید انتشار این نوبت</h5>
          <p className="text-sm">
            این اقدام همه {pending.length.toLocaleString("fa-IR")} نتیجه آماده
            تأیید در این نوبت را شامل می‌شود، حتی ردیف‌های خارج از فیلتر یا صفحه
            فعلی. اعتبار نتایج هنگام انتشار دوباره بررسی می‌شود.
          </p>
          <label className="flex items-center gap-2">
            <Input
              type="checkbox"
              className="size-4"
              checked={confirmed}
              onChange={(event) =>
                setConfirmedRevision(event.target.checked ? run.revision : null)
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
