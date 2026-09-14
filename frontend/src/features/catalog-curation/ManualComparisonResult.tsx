import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ClipboardCheck,
  FileSearch,
  ListChecks,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { components } from "@/lib/api/schema";
import { PropertyMatchReview } from "./PropertyMatchReview";

type Comparison = components["schemas"]["PropertyComparison"];
type SearchProperty = components["schemas"]["CatalogCurationPropertySearch"];
type MatchSignal = components["schemas"]["MatchSignal"];
type PropertyEvidence =
  components["schemas"]["CatalogCurationPropertyEvidence"];

type ImageReference = {
  image_id: string;
  listing_id: string;
  source: string;
  thumbnail_url: string | null;
};

type ImagePair = {
  left: ImageReference;
  right: ImageReference;
  method?: "sha256" | "normalized_pixels" | "dhash";
  perceptual_distance: number | null;
  is_generic?: boolean;
};

const evidenceLabels: Record<string, string> = {
  left: "ملک اول",
  right: "ملک دوم",
  difference: "اختلاف",
  distance_m: "فاصله (متر)",
  city: "شهر",
  district: "منطقه",
  neighborhood: "محله",
  property_type: "نوع ملک",
  area_sqm: "مساحت (متر مربع)",
  room_count: "تعداد اتاق",
  construction_year: "سال ساخت",
  floor: "طبقه",
  total_floors: "تعداد طبقات",
  units_per_floor: "واحد در طبقه",
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
  heating: "گرمایش",
  cooling: "سرمایش",
};

const imageMethodLabels = {
  sha256: "SHA-256",
  normalized_pixels: "Normalized pixels",
  dhash: "dHash",
} as const;

const classificationLabels: Record<MatchSignal["classification"], string> = {
  support: "همسو",
  contradiction: "ناسازگار",
  neutral: "خنثی",
  blocker: "مانع قطعی",
};

const bandLabels = {
  likely: "محتمل",
  possible: "ممکن",
  below_threshold: "پایین‌تر از آستانه",
} as const;

function evidenceValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString("fa-IR");
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  return JSON.stringify(value);
}

function EvidenceThumbnail({ image }: { image: ImageReference }) {
  return (
    <figure className="min-w-0">
      {image.thumbnail_url ? (
        <img
          src={image.thumbnail_url}
          alt={`تصویر ${image.source}`}
          className="aspect-[4/3] w-full rounded-lg border object-cover"
        />
      ) : (
        <div
          className="bg-muted aspect-[4/3] rounded-lg border"
          aria-hidden="true"
        />
      )}
      <figcaption className="text-muted-foreground mt-1 truncate text-xs">
        {image.source}
      </figcaption>
    </figure>
  );
}

function ImagePairRow({
  pair,
  contradiction = false,
}: {
  pair: ImagePair;
  contradiction?: boolean;
}) {
  const label = contradiction
    ? "ناسازگاری تصویری"
    : pair.method
      ? imageMethodLabels[pair.method]
      : "تطبیق تصویر";
  const distance =
    pair.perceptual_distance == null
      ? ""
      : ` · فاصله ${pair.perceptual_distance.toLocaleString("fa-IR")}`;
  return (
    <li className="rounded-xl border p-3">
      <p className="mb-3 text-sm font-medium">
        {label}
        {distance}
      </p>
      {pair.is_generic ? (
        <p className="text-muted-foreground mb-3 text-xs">
          تصویر عمومی؛ تقویت قاطع ندارد
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <EvidenceThumbnail image={pair.left} />
        <EvidenceThumbnail image={pair.right} />
      </div>
    </li>
  );
}

function ImageEvidence({ values }: { values: Record<string, unknown> }) {
  const matchedPairs = Array.isArray(values.matched_pairs)
    ? (values.matched_pairs as ImagePair[])
    : [];
  const contradictions = Array.isArray(values.contradictions)
    ? (values.contradictions as ImagePair[])
    : [];
  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-medium">جفت‌های مشابه</p>
        {matchedPairs.length ? (
          <ul className="space-y-3">
            {matchedPairs.map((pair) => (
              <ImagePairRow
                key={`${pair.left.image_id}:${pair.right.image_id}`}
                pair={pair}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">
            تصویر مشابهی یافت نشد.
          </p>
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">ناسازگاری‌ها</p>
        {contradictions.length ? (
          <ul className="space-y-3">
            {contradictions.map((pair) => (
              <ImagePairRow
                key={`${pair.left.image_id}:${pair.right.image_id}`}
                pair={pair}
                contradiction
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">
            ناسازگاری تصویری ثبت نشد.
          </p>
        )}
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: MatchSignal }) {
  const contribution = signal.contribution.toLocaleString("fa-IR");
  return (
    <li className="rounded-xl border">
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
          <span className="font-medium">{signal.label}</span>
          <Badge
            variant={
              signal.classification === "blocker" ||
              signal.classification === "contradiction"
                ? "destructive"
                : "secondary"
            }
          >
            {classificationLabels[signal.classification]}
          </Badge>
          <strong className="ms-auto tabular-nums" dir="ltr">
            {signal.contribution > 0 ? "+" : ""}
            {contribution}
          </strong>
        </summary>
        <div className="border-t p-4">
          {signal.key === "images" ? (
            <ImageEvidence values={signal.compared_values} />
          ) : (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(signal.compared_values).map(([key, value]) => (
                <div key={key} className="bg-muted/40 min-w-0 rounded-lg p-3">
                  <dt className="text-muted-foreground text-xs">
                    {evidenceLabels[key] ?? key.replaceAll("_", " ")}
                  </dt>
                  <dd className="mt-1 break-words" dir="auto">
                    {evidenceValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </details>
    </li>
  );
}

function PropertyEvidenceCard({
  property,
  position,
}: {
  property: PropertyEvidence;
  position: number;
}) {
  const exactLocation = property.exact_location;
  return (
    <Card className="gap-3 shadow-none">
      <CardHeader>
        <CardTitle className="text-base">
          ملک {position.toLocaleString("fa-IR")}
        </CardTitle>
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">شناسه داخلی ملک</summary>
          <p className="mt-2 break-all" dir="ltr">
            {property.id}
          </p>
        </details>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {Object.entries(property.normalized_facts).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">
                {evidenceLabels[key] ?? key.replaceAll("_", " ")}
              </dt>
              <dd>{evidenceValue(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="bg-muted/60 rounded-xl p-3">
          <p className="font-medium">مکان دقیق محدودشده</p>
          <p className="mt-1 tabular-nums" dir="ltr">
            {exactLocation.latitude ?? "—"}, {exactLocation.longitude ?? "—"}
          </p>
          {exactLocation.operator_notes ? (
            <p className="text-muted-foreground mt-2">
              {exactLocation.operator_notes}
            </p>
          ) : null}
        </div>
        {property.provenance_note ? (
          <p className="text-muted-foreground">{property.provenance_note}</p>
        ) : null}
        <ul className="space-y-2" aria-label={`آگهی‌های ملک ${position}`}>
          {property.listings.map((listing) => (
            <li key={listing.id} className="rounded-xl border p-3">
              <p className="font-medium">
                {listing.source.name} ·{" "}
                {listing.source_reference || "بدون شناسه منبع"}
              </p>
              {listing.provenance_note ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {listing.provenance_note}
                </p>
              ) : null}
              {listing.source_claims ? (
                <p className="text-muted-foreground mt-2 text-xs" dir="ltr">
                  {JSON.stringify(listing.source_claims)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const resultViews = [
  { id: "overview", label: "خلاصه مقایسه", icon: ListChecks },
  { id: "signals", label: "شواهد تطبیق", icon: FileSearch },
  { id: "sources", label: "مشخصات و منابع", icon: FileSearch },
  { id: "decision", label: "ثبت تصمیم", icon: ClipboardCheck },
] as const;
type ResultView = (typeof resultViews)[number]["id"];

export function ManualComparisonResult({
  comparison,
  selected,
  reviewVersion,
  onRefresh,
}: {
  comparison: Comparison;
  selected: SearchProperty[];
  reviewVersion: number;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<ResultView>("overview");
  const [decisionVisited, setDecisionVisited] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const conflicts = comparison.signals.filter(
    (signal) =>
      signal.classification === "contradiction" ||
      signal.classification === "blocker",
  );
  const fields = comparison.decision_fields ?? [];
  const conflictingFields = fields.filter((field) => field.conflicting);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [view]);
  function changeView(next: ResultView) {
    if (next === "decision") setDecisionVisited(true);
    setView(next);
  }
  return (
    <div className="space-y-5">
      {view === "overview" ? (
        <>
          <div className="bg-muted/30 grid gap-5 rounded-2xl border p-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="sm:border-e sm:pe-6">
              <p className="text-muted-foreground text-sm">اطمینان تطبیق</p>
              <p className="my-2 text-3xl font-semibold tabular-nums">
                {comparison.score.toLocaleString("fa-IR")} از ۱۰۰
              </p>
              <Badge
                variant={
                  comparison.band === "below_threshold"
                    ? "destructive"
                    : "secondary"
                }
              >
                {bandLabels[comparison.band]}
              </Badge>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">
                {conflicts.length
                  ? "پیش از تصمیم، ناسازگاری‌ها را بررسی کنید"
                  : "خلاصه شواهد دو ملک آماده است"}
              </h3>
              <p className="text-muted-foreground text-sm leading-7">
                {conflicts.length.toLocaleString("fa-IR")} نشانه ناسازگار ·{" "}
                {conflictingFields.length.toLocaleString("fa-IR")} مشخصه نیازمند
                انتخاب
              </p>
              <p className="text-muted-foreground text-xs">
                احتمال کالیبره‌شده نیست
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {comparison.properties.map((property, index) => {
              const summary = selected.find((item) => item.id === property.id);
              return (
                <div
                  key={property.id}
                  className="min-w-0 rounded-xl border p-4"
                >
                  <p className="text-primary mb-2 text-xs font-semibold">
                    ملک {(index + 1).toLocaleString("fa-IR")}
                  </p>
                  <p className="text-sm leading-7 font-semibold">
                    {summary?.title ??
                      `ملک ${(index + 1).toLocaleString("fa-IR")}`}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs leading-6">
                    {[summary?.city, summary?.neighborhood]
                      .filter(Boolean)
                      .join("، ") || "مکان نامشخص"}{" "}
                    · {summary?.area_sqm?.toLocaleString("fa-IR") ?? "—"} متر
                  </p>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <p className="min-w-0 text-sm leading-7">
            {selected.map((property) => property.title).join(" / ")}
          </p>
          <Badge
            variant={
              comparison.band === "below_threshold"
                ? "destructive"
                : "secondary"
            }
            className="shrink-0"
          >
            {comparison.score.toLocaleString("fa-IR")} از ۱۰۰ ·{" "}
            {bandLabels[comparison.band]}
          </Badge>
        </div>
      )}
      <nav
        aria-label="بخش‌های مقایسه"
        className="bg-background/95 sticky top-20 z-20 grid grid-cols-2 gap-2 rounded-xl border p-2 shadow-sm backdrop-blur sm:grid-cols-4 lg:top-4"
      >
        {resultViews.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            variant={view === id ? "secondary" : "ghost"}
            aria-current={view === id ? "page" : undefined}
            onClick={() => changeView(id)}
            className="h-auto min-h-11 whitespace-normal"
          >
            <Icon aria-hidden="true" />
            {label}
          </Button>
        ))}
      </nav>
      <div
        ref={panelRef}
        tabIndex={-1}
        className="min-w-0 outline-none"
        aria-label={resultViews.find((item) => item.id === view)?.label}
      >
        {view === "overview" ? (
          <div className="space-y-5">
            {comparison.band === "below_threshold" && !conflicts.length ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>اطمینان پایین به تطبیق</AlertTitle>
                <AlertDescription>
                  امتیاز زیر آستانه است. پیش از گروه‌بندی، شواهد هر دو ملک را
                  بررسی کنید.
                </AlertDescription>
              </Alert>
            ) : null}
            {conflicts.length ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>شواهد ناسازگار</AlertTitle>
                <AlertDescription>
                  <ul className="list-inside list-disc space-y-1">
                    {conflicts.map((signal) => (
                      <li key={signal.key}>{signal.label}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="rounded-xl border p-5">
              <h3 className="font-semibold">مشخصات نیازمند تصمیم</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-7">
                {conflictingFields.length
                  ? "مقادیر متفاوت را کنار هم ببینید؛ انتخاب نهایی در بخش ثبت تصمیم انجام می‌شود."
                  : "در مشخصات قابل انتخاب، تعارضی ثبت نشده است. پیش از گروه‌بندی، شواهد تطبیق را هم بررسی کنید."}
              </p>
              {conflictingFields.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">مقایسه مشخصات متعارض</caption>
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="p-3 text-start">مشخصه</th>
                        <th className="p-3 text-start">ملک ۱</th>
                        <th className="p-3 text-start">ملک ۲</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conflictingFields.map((field) => (
                        <tr key={field.key} className="border-t">
                          <th className="p-3 text-start font-medium">
                            {field.label}
                          </th>
                          {comparison.properties.map((property) => (
                            <td key={property.id} className="p-3">
                              {evidenceValue(field.display_values[property.id])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={() => changeView("signals")}>
                بررسی شواهد
              </Button>
              {comparison.decision_fields ? (
                <Button onClick={() => changeView("decision")}>
                  ادامه برای ثبت تصمیم
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {view === "signals" ? (
          <section className="space-y-4" aria-label="شواهد تطبیق">
            <div>
              <h3 className="font-semibold">جزئیات امتیاز تطبیق</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                برای دیدن مقادیر یا تصاویر، هر نشانه را باز کنید.
              </p>
            </div>
            <ul aria-label="سیگنال‌های امتیاز تطبیق" className="space-y-3">
              {comparison.signals.map((signal) => (
                <SignalRow key={signal.key} signal={signal} />
              ))}
            </ul>
            <p className="text-muted-foreground text-xs" dir="ltr">
              نسخه امتیازدهی: {comparison.scoring_version}
            </p>
          </section>
        ) : null}
        {view === "sources" ? (
          <section className="space-y-4" aria-label="مشخصات و منابع">
            <h3 className="font-semibold">شواهد کامل هر ملک</h3>
            {comparison.properties.map((property, index) => (
              <details key={property.id} className="rounded-xl border">
                <summary className="cursor-pointer p-4 text-sm font-medium">
                  جزئیات ملک {(index + 1).toLocaleString("fa-IR")} ·{" "}
                  {property.listings.length.toLocaleString("fa-IR")} آگهی
                </summary>
                <div className="border-t p-3">
                  <PropertyEvidenceCard
                    property={property}
                    position={index + 1}
                  />
                </div>
              </details>
            ))}
          </section>
        ) : null}
        {decisionVisited && comparison.decision_fields ? (
          <div hidden={view !== "decision"}>
            <PropertyMatchReview
              guided
              key={`${comparison.revision}-${reviewVersion}`}
              comparison={comparison}
              onRefresh={onRefresh}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
