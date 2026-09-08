import { useState } from "react";
import { ChartNoAxesCombined, History, Wallet, Banknote } from "lucide-react";
import type { components } from "@/lib/api/schema";

type Listing = components["schemas"]["PropertyDetail"]["listings"][number];
const number = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

export function PropertyPriceHistory({ listings }: { listings: Listing[] }) {
  const [selectedId, setSelectedId] = useState(listings[0]?.id ?? "");
  const selected =
    listings.find((listing) => listing.id === selectedId) ?? listings[0];
  const observations = [...(selected?.price_history ?? [])].sort(
    (a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at),
  );
  return (
    <section
      aria-labelledby="price-history-title"
      className="bg-card rounded-2xl border p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2
            id="price-history-title"
            className="flex items-center gap-2 text-xl font-bold"
          >
            <ChartNoAxesCombined
              className="text-primary size-5"
              aria-hidden="true"
            />
            روند ودیعه و اجاره
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-7">
            تغییرات قیمت پیشنهادی هر آگهی، از زمان ثبت در ترب‌رنت
          </p>
        </div>
        {listings.length > 1 && (
          <select
            aria-label="منبع تاریخچه قیمت"
            className="bg-background border-input min-h-11 max-w-full rounded-lg border px-3 text-sm"
            value={selected?.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {listings.map((listing, index) => (
              <option key={listing.id} value={listing.id}>
                آگهی {number(index + 1)} · {listing.source.display_name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(
          [
            {
              field: "deposit_toman",
              label: "ودیعه",
              Icon: Wallet,
              color: "text-primary",
            },
            {
              field: "monthly_rent_toman",
              label: "اجاره ماهانه",
              Icon: Banknote,
              color: "text-[light-dark(#0369a1,#38bdf8)]",
            },
          ] as const
        ).map(({ field, label, Icon, color }) => {
          const values = observations.map((point) => point[field]);
          const max = Math.max(...values, 1);
          const start = observations[0];
          const end = observations.at(-1);
          const duration =
            start && end
              ? Date.parse(end.recorded_at) - Date.parse(start.recorded_at)
              : 0;
          const points = observations.map((point) => ({
            x:
              duration > 0 && start
                ? 20 +
                  ((Date.parse(point.recorded_at) -
                    Date.parse(start.recorded_at)) /
                    duration) *
                    280
                : 160,
            y: 120 - (point[field] / max) * 90,
            point,
          }));
          const path = points
            .map((point, index) =>
              index === 0
                ? `M ${point.x} ${point.y}`
                : `H ${point.x} V ${point.y}`,
            )
            .join(" ");
          return (
            <div
              key={field}
              className="bg-muted/30 min-w-0 rounded-xl border p-4"
            >
              <div
                className={`flex items-center gap-2 text-sm font-semibold ${color}`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </div>
              <p className="mt-3 text-xl font-bold tabular-nums">
                {selected ? number(selected.rental_terms[field]) : "—"}
                <span className="text-muted-foreground ms-2 text-xs font-normal">
                  تومان
                </span>
              </p>
              {observations.length > 1 ? (
                <>
                  <svg
                    viewBox="0 0 320 144"
                    role="img"
                    aria-label={`نمودار ${label}؛ مقیاس مستقل از صفر تا ${number(max)} تومان`}
                    className={`mt-3 w-full ${color}`}
                  >
                    {[30, 75, 120].map((y) => (
                      <line
                        key={y}
                        x1="20"
                        x2="300"
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        opacity="0.12"
                        strokeDasharray="4 5"
                      />
                    ))}
                    <path
                      d={`${path} V 120 H 20 Z`}
                      fill="currentColor"
                      opacity="0.06"
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                    />
                    {points.map(({ x, y, point }) => (
                      <circle
                        key={point.recorded_at}
                        cx={x}
                        cy={y}
                        r="4"
                        fill="currentColor"
                      >
                        <title>
                          {`${date(point.recorded_at)}: ${number(point[field])} تومان`}
                        </title>
                      </circle>
                    ))}
                  </svg>
                  <div
                    className="text-muted-foreground flex justify-between gap-2 text-[11px]"
                    dir="ltr"
                  >
                    <span dir="rtl">{start && date(start.recorded_at)}</span>
                    <span dir="rtl">{end && date(end.recorded_at)}</span>
                  </div>
                  <p className="text-muted-foreground mt-3 text-xs">
                    مقیاس: صفر تا {number(max)} تومان
                  </p>
                </>
              ) : (
                <div className="text-muted-foreground mt-5 flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed text-xs">
                  <History className="size-4" aria-hidden="true" />
                  در انتظار سابقه بیشتر
                </div>
              )}
            </div>
          );
        })}
      </div>
      {observations.length < 2 ? (
        <p className="text-muted-foreground mt-4 text-sm leading-7">
          هنوز سابقه کافی برای نمایش نمودار این آگهی وجود ندارد. قیمت‌های قبلی
          تخمین زده نمی‌شوند؛ تغییرات بعدی ودیعه و اجاره در این بخش نمایش داده
          می‌شوند.
        </p>
      ) : (
        <details className="mt-5 text-sm">
          <summary className="text-muted-foreground min-h-11 cursor-pointer py-3">
            مشاهده تاریخچه قیمت به تفکیک تاریخ
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs sm:text-sm">
              <caption className="text-muted-foreground pb-3 text-start">
                مبالغ به تومان؛ مقیاس نمودار ودیعه و اجاره مستقل است.
              </caption>
              <thead>
                <tr className="border-b">
                  <th className="py-3 text-start">تاریخ ثبت</th>
                  <th className="text-start">ودیعه</th>
                  <th className="text-start">اجاره ماهانه</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((point) => (
                  <tr key={point.recorded_at} className="border-b">
                    <td className="py-3">{date(point.recorded_at)}</td>
                    <td>{number(point.deposit_toman)}</td>
                    <td>{number(point.monthly_rent_toman)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
