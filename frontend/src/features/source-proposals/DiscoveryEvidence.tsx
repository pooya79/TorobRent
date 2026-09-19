import { Badge } from "@/components/ui/badge";
import type { OperatorSourceProposal } from "./queries";
import {
  classificationLabels,
  discoveryStageLabels,
  discoveryStopLabels,
} from "./discovery-labels";

export function DiscoveryEvidence({
  proposal,
}: {
  proposal: OperatorSourceProposal;
}) {
  const discovery = proposal.discovery;
  const evidence = discovery?.evidence;
  const structures = evidence?.structures ?? [];
  const dominant = structures.find((structure) => structure.selected);
  const otherCoverage = structures
    .filter((structure) => !structure.selected)
    .reduce((total, structure) => total + structure.coverage, 0);
  const metrics = [
    ["صفحات بررسی‌شده", evidence?.page_count ?? 0],
    ["آگهی اجاره", evidence?.detail_page_count ?? 0],
    ["خارج از پوشش", evidence?.exclusions?.length ?? 0],
    ["ساختار شناسایی‌شده", structures.length],
  ] as const;
  return (
    <section
      aria-label="نتیجه کشف صفحات"
      className="flex h-144 flex-col gap-4 rounded-xl border p-4 sm:p-5"
    >
      <div>
        <h3 className="font-semibold">
          {discoveryStageLabels[proposal.discovery_stage ?? "awaiting_url"]}
        </h3>
        <p className="text-muted-foreground mt-2 min-h-10 text-xs leading-5">
          {evidence?.stop_reason
            ? (discoveryStopLabels[evidence.stop_reason] ??
              "بررسی صفحات پایان یافته است.")
            : "پس از دریافت صفحات، خلاصه بررسی در این بخش نمایش داده می‌شود."}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        {metrics.map(([label, value]) => (
          <div key={label} className="bg-muted/40 rounded-lg border px-3 py-2">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {value.toLocaleString("fa-IR")}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-2 gap-3" aria-label="پوشش ساختارها">
        {[
          ["ساختار غالب", dominant?.coverage ?? 0],
          ["ساختارهای دیگر", otherCoverage],
        ].map(([label, coverage]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="text-muted-foreground inline text-xs">{label}</p>
            {label === "ساختار غالب" && (
              <span className="text-muted-foreground ms-1 text-[10px]">
                (قالب رایج چیدمان آگهی‌ها)
              </span>
            )}
            <p className="mt-1 text-lg font-semibold">
              {(Number(coverage) * 100).toLocaleString("fa-IR", {
                maximumFractionDigits: 1,
              })}
              ٪
            </p>
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className={
                  label === "ساختار غالب"
                    ? "h-full rounded-full bg-emerald-500"
                    : "h-full rounded-full bg-violet-500"
                }
                style={{
                  width: `${Math.min(100, Math.max(0, Number(coverage) * 100))}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5" aria-label="کلاس‌های صفحات">
        {Object.entries(classificationLabels).map(([kind, label]) => (
          <div
            key={kind}
            className="flex items-center justify-between gap-1 text-xs"
          >
            <span>{label}</span>
            <Badge variant="secondary" className="px-2 tabular-nums">
              {(evidence?.classifications?.[kind] ?? 0).toLocaleString("fa-IR")}
            </Badge>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-auto border-t pt-3 text-xs leading-5">
        <p>
          حدود بررسی: {discovery?.max_pages?.toLocaleString("fa-IR") ?? "—"}{" "}
          صفحه · هدف:{" "}
          {discovery?.target_detail_pages?.toLocaleString("fa-IR") ?? "—"} آگهی
        </p>
        {discovery && (
          <p>
            پایان رزرو: {new Date(discovery.expires_at).toLocaleString("fa-IR")}
          </p>
        )}
        <p className="text-foreground">
          جزئیات صفحات، نمونه‌ها و موارد خارج از پوشش در جدول پایین است.
        </p>
        {!!evidence?.failures?.length && (
          <p className="text-destructive">
            {evidence.failures.length.toLocaleString("fa-IR")} خطای ثبت‌شده؛
            موارد دارای نشانی در جدول مشخص شده‌اند.
          </p>
        )}
      </div>
    </section>
  );
}
