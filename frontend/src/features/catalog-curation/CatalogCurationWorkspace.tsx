import { PropertyMatchReview } from "./PropertyMatchReview";
import { PropertyMatchSuggestions } from "./PropertyMatchSuggestions";
import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows, Layers3, Search, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  catalogCurationSearchQuery,
  propertyComparisonQuery,
} from "@/features/catalog-curation/queries";
import type { components } from "@/lib/api/schema";
import { cn } from "@/lib/utils";

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
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function PropertyResult({
  property,
  selected,
  selectionFull,
  onToggle,
}: {
  property: SearchProperty;
  selected: boolean;
  selectionFull: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className={cn("gap-3 shadow-none", selected && "border-primary")}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{property.title}</CardTitle>
          <Badge variant="secondary">
            {property.area_sqm?.toLocaleString("fa-IR") ?? "—"} متر
          </Badge>
        </div>
        <p className="text-muted-foreground text-xs break-all" dir="ltr">
          {property.id}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {property.city ?? "—"}، {property.neighborhood ?? "—"} ·{" "}
          {property.listings.length.toLocaleString("fa-IR")} آگهی جاری
        </p>
        {property.listings.map((listing) => (
          <p key={listing.id} className="bg-muted rounded-lg px-3 py-2 text-xs">
            {listing.source.name} ·{" "}
            {listing.source_reference || "بدون شناسه منبع"}
          </p>
        ))}
        <Button
          type="button"
          variant={selected ? "secondary" : "outline"}
          className="w-full"
          disabled={!selected && selectionFull}
          onClick={onToggle}
        >
          {selected ? "حذف از مقایسه" : "انتخاب برای مقایسه"}
        </Button>
      </CardContent>
    </Card>
  );
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
    <li className="grid gap-2 border-b py-4 last:border-0 sm:grid-cols-[1fr_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{signal.label}</span>
          <Badge
            variant={
              signal.classification === "blocker" ? "destructive" : "secondary"
            }
          >
            {classificationLabels[signal.classification]}
          </Badge>
        </div>
        {signal.key === "images" ? (
          <ImageEvidence values={signal.compared_values} />
        ) : (
          <p className="text-muted-foreground mt-2 text-xs" dir="ltr">
            {JSON.stringify(signal.compared_values)}
          </p>
        )}
      </div>
      <strong className="tabular-nums" dir="ltr">
        {signal.contribution > 0 ? "+" : ""}
        {contribution}
      </strong>
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
        <p className="text-muted-foreground text-xs break-all" dir="ltr">
          {property.id}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {Object.entries(property.normalized_facts).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground" dir="ltr">
                {key}
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

export function CatalogCurationWorkspace() {
  const [reviewVersion, setReviewVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparisonIds, setComparisonIds] = useState<readonly string[] | null>(
    null,
  );
  const search = useQuery(catalogCurationSearchQuery(searchTerm, page));
  const comparison = useQuery(propertyComparisonQuery(comparisonIds));

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSelected([]);
    setComparisonIds(null);
    setPage(1);
    setSearchTerm(draft.trim());
  }

  function toggleProperty(propertyId: string) {
    setComparisonIds(null);
    setSelected((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : current.length < 2
          ? [...current, propertyId]
          : current,
    );
  }

  return (
    <PageMain className="max-w-7xl">
      <header className="mb-6">
        <p className="text-primary mb-2 flex items-center gap-2 text-sm font-medium">
          <Layers3 className="size-4" aria-hidden="true" />
          ساماندهی کاتالوگ
        </p>
        <h1 className="text-3xl font-semibold">مقایسه هویت ملک‌ها</h1>
        <p className="text-muted-foreground mt-3 max-w-3xl leading-7">
          شواهد هویتی دو ملک جاری را کنار هم ببینید. باز کردن مقایسه فقط خواندنی
          است؛ برای گروه‌بندی، بررسی را شروع و تصمیم خود را تأیید کنید.
        </p>
      </header>

      <nav
        className="mb-8 flex flex-wrap gap-2"
        aria-label="بخش‌های ساماندهی کاتالوگ"
      >
        <Button asChild variant="secondary">
          <a href="#suggestions">
            <Sparkles aria-hidden="true" />
            پیشنهادها
          </a>
        </Button>
        <Button asChild variant="ghost">
          <a href="#grouped-properties">
            <Layers3 aria-hidden="true" />
            ملک‌های گروه‌بندی‌شده
          </a>
        </Button>
        <Button asChild>
          <a href="#manual-comparison">
            <GitCompareArrows aria-hidden="true" />
            مقایسه دستی
          </a>
        </Button>
      </nav>

      <section
        id="suggestions"
        className="mb-8 scroll-mt-24 rounded-2xl border p-5"
      >
        <PropertyMatchSuggestions />
      </section>

      <div className="mb-8" aria-label="مسیرهای آینده">
        <section
          id="grouped-properties"
          className="scroll-mt-24 rounded-2xl border p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">ملک‌های گروه‌بندی‌شده</h2>
            <Badge variant="secondary">به‌زودی</Badge>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            مرور گروه‌های فعلی در نسخه بعدی فعال می‌شود.
          </p>
        </section>
      </div>

      <section id="manual-comparison" aria-labelledby="manual-comparison-title">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="manual-comparison-title" className="text-2xl font-semibold">
              مقایسه دستی ملک‌ها
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              با شناسه ملک، شناسه آگهی، منبع، محله یا شناسه منبع جست‌وجو کنید.
            </p>
          </div>
          <Badge variant="outline">
            {selected.length.toLocaleString("fa-IR")} از ۲ انتخاب شده
          </Badge>
        </div>

        <form onSubmit={submitSearch} role="search" className="mb-6 flex gap-2">
          <Input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="شناسه یا مشخصات ملک"
            aria-label="جست‌وجوی ملک جاری"
          />
          <Button type="submit">
            <Search aria-hidden="true" />
            جست‌وجو
          </Button>
        </form>

        {search.isPending && searchTerm !== null ? (
          <p role="status">در حال جست‌وجو…</p>
        ) : null}
        {search.isError ? (
          <Alert variant="destructive">
            <AlertTitle>جست‌وجو انجام نشد</AlertTitle>
            <AlertDescription>دوباره تلاش کنید.</AlertDescription>
          </Alert>
        ) : null}
        {search.data ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {search.data.results.map((property) => (
                <PropertyResult
                  key={property.id}
                  property={property}
                  selected={selected.includes(property.id)}
                  selectionFull={selected.length === 2}
                  onToggle={() => toggleProperty(property.id)}
                />
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={!search.data.previous}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                صفحه قبل
              </Button>
              <span className="text-muted-foreground text-sm">
                صفحه {page.toLocaleString("fa-IR")} ·{" "}
                {search.data.count.toLocaleString("fa-IR")} نتیجه
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={!search.data.next}
                onClick={() => setPage((current) => current + 1)}
              >
                صفحه بعد
              </Button>
            </div>
          </>
        ) : null}

        <div className="my-6 flex justify-end">
          <Button
            type="button"
            size="lg"
            disabled={selected.length !== 2}
            onClick={() => setComparisonIds([...selected])}
          >
            <GitCompareArrows aria-hidden="true" />
            مقایسه دو ملک
          </Button>
        </div>

        {comparison.isPending && comparisonIds ? (
          <p role="status">در حال سنجش شواهد…</p>
        ) : null}
        {comparison.isError ? (
          <Alert variant="destructive">
            <AlertTitle>مقایسه انجام نشد</AlertTitle>
            <AlertDescription>ملک‌ها را دوباره انتخاب کنید.</AlertDescription>
          </Alert>
        ) : null}
        {comparison.data ? (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {comparison.data.properties.map((property, index) => (
                <PropertyEvidenceCard
                  key={property.id}
                  property={property}
                  position={index + 1}
                />
              ))}
            </div>
            {comparison.data.decision_fields && (
              <PropertyMatchReview
                key={`${comparison.data.revision}-${reviewVersion}`}
                comparison={comparison.data}
                onRefresh={() => {
                  void comparison
                    .refetch()
                    .then(() => setReviewVersion((value) => value + 1));
                }}
              />
            )}
            <Card className="overflow-hidden">
              <CardHeader className="bg-muted/50">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-muted-foreground text-sm">
                      Match Confidence
                    </p>
                    <CardTitle className="mt-1 text-3xl">
                      {comparison.data.score.toLocaleString("fa-IR")} از ۱۰۰
                    </CardTitle>
                  </div>
                  <Badge className="text-sm">
                    {bandLabels[comparison.data.band]}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  احتمال کالیبره‌شده نیست
                </p>
                <p className="text-muted-foreground text-xs" dir="ltr">
                  نسخه امتیازدهی: {comparison.data.scoring_version}
                </p>
              </CardHeader>
              <CardContent>
                <ul aria-label="سیگنال‌های امتیاز تطبیق">
                  {comparison.data.signals.map((signal) => (
                    <SignalRow key={signal.key} signal={signal} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </section>
    </PageMain>
  );
}
