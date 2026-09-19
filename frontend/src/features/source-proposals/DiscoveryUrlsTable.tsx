import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OperatorSourceProposal } from "./queries";
import { discoveryDescription } from "./discovery-description";
import { classificationLabels } from "./discovery-labels";

const classColors: Record<string, string> = {
  rental_listing: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rental_index: "border-sky-200 bg-sky-50 text-sky-800",
  other_property: "border-violet-200 bg-violet-50 text-violet-800",
  irrelevant: "border-slate-200 bg-slate-100 text-slate-700",
  blocked: "border-amber-200 bg-amber-50 text-amber-800",
  fetch_error: "border-rose-200 bg-rose-50 text-rose-800",
};
const pageSize = 25;

export function DiscoveryUrlsTable({
  proposal,
}: {
  proposal: OperatorSourceProposal;
}) {
  const [search, setSearch] = useState("");
  const [freshness, setFreshness] = useState("all");
  const [classification, setClassification] = useState("all");
  const [page, setPage] = useState(0);
  const evidence = proposal.discovery?.evidence;
  const rows = (proposal.discovery?.pages ?? []).map((row) => {
    const structure = row.is_current
      ? evidence?.structures?.find((group) => group.page_urls.includes(row.url))
      : undefined;
    const excluded = row.is_current && evidence?.exclusions?.includes(row.url);
    const sample =
      row.is_current && evidence?.samples?.some((item) => item.url === row.url);
    return {
      ...row,
      description: [
        discoveryDescription(row.classification, row.description),
        excluded
          ? "این صفحه خارج از پوشش روش استخراج انتخاب‌شده است."
          : structure?.supported_page_urls.includes(row.url)
            ? "ساختار این صفحه تحت پوشش روش استخراج است."
            : "",
      ]
        .filter(Boolean)
        .join(" "),
      coverage: excluded
        ? "خارج از پوشش"
        : structure?.supported_page_urls.includes(row.url)
          ? "تحت پوشش"
          : null,
      sample,
    };
  });
  const currentCount = rows.filter((row) => row.is_current).length;
  const filtered = rows.filter(
    (row) =>
      (freshness === "all" || row.is_current === (freshness === "new")) &&
      (classification === "all" || row.classification === classification) &&
      `${row.url} ${row.description} ${classificationLabels[row.classification] ?? row.classification}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const visiblePage = Math.min(page, lastPage);

  return (
    <section
      aria-label="نشانی‌های کشف‌شده"
      className="min-w-0 overflow-hidden rounded-xl border"
    >
      <div className="grid gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">نشانی‌های کشف‌شده</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              جدید: در آخرین اجرای کشف دیده شده؛ قدیمی: فقط در اجراهای قبلی دیده
              شده. قدیمی بودن به معنی حذف صفحه نیست.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {rows.length.toLocaleString("fa-IR")} نشانی
            </Badge>
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-emerald-800"
            >
              {currentCount.toLocaleString("fa-IR")} جدید
            </Badge>
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-800"
            >
              {(rows.length - currentCount).toLocaleString("fa-IR")} قدیمی
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-60 flex-1">
            <Search
              aria-hidden="true"
              className="text-muted-foreground absolute start-3 top-3 size-4"
            />
            <Input
              aria-label="جست‌وجوی نشانی‌ها"
              placeholder="جست‌وجو در نشانی و توضیحات…"
              className="ps-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <select
            aria-label="فیلتر تازگی نشانی"
            className="bg-background rounded-md border px-3 py-2 text-sm"
            value={freshness}
            onChange={(event) => {
              setFreshness(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">همه اجراها</option>
            <option value="new">جدید · آخرین اجرا</option>
            <option value="old">قدیمی · اجراهای قبلی</option>
          </select>
          <select
            aria-label="فیلتر کلاس صفحه"
            className="bg-background rounded-md border px-3 py-2 text-sm"
            value={classification}
            onChange={(event) => {
              setClassification(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">همه کلاس‌ها</option>
            {Object.entries(classificationLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-225 text-start text-sm">
          <thead className="bg-muted/60 text-muted-foreground border-y">
            <tr>
              {[
                "نشانی صفحه",
                "کلاس صفحه",
                "تازگی",
                "آخرین دریافت",
                "HTTP",
                "توضیحات",
              ].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-4 py-3 text-start font-medium"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered
              .slice(visiblePage * pageSize, (visiblePage + 1) * pageSize)
              .map((row) => (
                <tr
                  key={row.url}
                  className="hover:bg-muted/30 align-top transition-colors"
                >
                  <td className="max-w-80 min-w-60 px-4 py-4">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      dir="ltr"
                      className="text-primary flex items-start gap-2 break-all underline-offset-4 hover:underline"
                    >
                      {row.url}
                      <ExternalLink
                        aria-hidden="true"
                        className="mt-1 size-3.5 shrink-0"
                      />
                    </a>
                    {(row.coverage || row.sample) && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {row.coverage && (
                          <Badge
                            variant="outline"
                            className={
                              row.coverage === "تحت پوشش"
                                ? "border-sky-200 bg-sky-50 text-sky-800"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                            }
                          >
                            {row.coverage}
                          </Badge>
                        )}
                        {row.sample && (
                          <Badge
                            variant="outline"
                            className="border-violet-200 bg-violet-50 text-violet-800"
                          >
                            نمونه نماینده
                          </Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <Badge
                      variant="outline"
                      className={`whitespace-nowrap ${classColors[row.classification] ?? classColors.irrelevant}`}
                    >
                      {classificationLabels[row.classification] ??
                        row.classification}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    <Badge
                      variant="outline"
                      className={
                        row.is_current
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }
                    >
                      {row.is_current ? "جدید" : "قدیمی"}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    {row.last_fetched_at ? (
                      <time dateTime={row.last_fetched_at}>
                        {new Date(row.last_fetched_at).toLocaleString("fa-IR")}
                      </time>
                    ) : (
                      <span className="text-muted-foreground">ثبت نشده</span>
                    )}
                  </td>
                  <td className="px-4 py-4 font-mono">
                    {row.http_status ?? "—"}
                  </td>
                  <td className="text-muted-foreground min-w-64 px-4 py-4 leading-6">
                    <span dir="auto">{row.description}</span>
                  </td>
                </tr>
              ))}
            {!filtered.length && (
              <tr>
                <td
                  colSpan={6}
                  className="text-muted-foreground px-4 py-10 text-center"
                >
                  {rows.length
                    ? "نشانی مطابق فیلترها پیدا نشد."
                    : "هنوز نشانی‌ای ثبت نشده است؛ پس از دریافت صفحات، نتایج اینجا نمایش داده می‌شوند."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
        <p className="text-muted-foreground text-xs">
          {filtered.length.toLocaleString("fa-IR")} نتیجه · اطلاعات اجراهای
          قدیمی ممکن است کامل نباشد.
        </p>
        {lastPage > 0 && (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visiblePage === 0}
              onClick={() => setPage(visiblePage - 1)}
            >
              قبلی
            </Button>
            <span className="text-xs">
              {(visiblePage + 1).toLocaleString("fa-IR")} /{" "}
              {(lastPage + 1).toLocaleString("fa-IR")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visiblePage === lastPage}
              onClick={() => setPage(visiblePage + 1)}
            >
              بعدی
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
