import type { components } from "@/lib/api/schema";

type Run = components["schemas"]["ExtractionRun"];

export function PublicationOutcomes({ run }: { run: Run }) {
  const outcomes = run.publication_outcomes;
  const unclassified = outcomes?.unclassified ?? run.published;
  const hasBreakdown =
    outcomes && (unclassified === 0 || unclassified < run.published);
  return (
    <div className="grid gap-2 text-sm">
      <dl className="flex flex-wrap gap-x-5 gap-y-2" aria-label="نتیجه انتشار">
        {(
          [
            ["آگهی جدید", outcomes?.new],
            ["به‌روزرسانی‌شده", outcomes?.updated],
            ["بدون تغییر", outcomes?.unchanged],
          ] as const
        ).map(([label, count]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">
              {!hasBreakdown || count == null
                ? "—"
                : count.toLocaleString("fa-IR")}
            </dd>
          </div>
        ))}
      </dl>
      {unclassified > 0 && (
        <p className="text-muted-foreground text-xs">
          تفکیک نتیجه برای {unclassified.toLocaleString("fa-IR")} انتشار قدیمی
          ثبت نشده است.
        </p>
      )}
    </div>
  );
}
