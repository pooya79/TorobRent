import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  propertyMatchSuggestionDetailQuery,
  propertyMatchSuggestionsQuery,
} from "@/features/catalog-curation/queries";
import { PropertyMatchReview } from "./PropertyMatchReview";

const bandLabels = {
  likely: "محتمل",
  possible: "ممکن",
  below_threshold: "زیر آستانه",
};

function SuggestionDetail({
  suggestionId,
  onBack,
}: {
  suggestionId: string;
  onBack: () => void;
}) {
  const detail = useQuery(propertyMatchSuggestionDetailQuery(suggestionId));
  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowRight aria-hidden="true" />
        بازگشت به صف
      </Button>
      {detail.isPending ? <p role="status">در حال دریافت شواهد…</p> : null}
      {detail.isError ? (
        <Alert variant="destructive">
          <AlertTitle>جزئیات پیشنهاد دریافت نشد</AlertTitle>
          <AlertDescription>دوباره تلاش کنید.</AlertDescription>
        </Alert>
      ) : null}
      {detail.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {detail.data.properties.map((property) => (
              <Card key={property.id} className="gap-2 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">{property.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">
                  {property.city ?? "—"}، {property.neighborhood ?? "—"} ·{" "}
                  {property.area_sqm?.toLocaleString("fa-IR") ?? "—"} متر
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="shadow-none">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>شواهد فعلی</CardTitle>
                <Badge>
                  {detail.data.score.toLocaleString("fa-IR")} از ۱۰۰
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {detail.data.evidence_summary.map((evidence) => (
                  <li
                    key={`${evidence.label}:${evidence.classification}`}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                  >
                    <span>{evidence.label}</span>
                    <span className="tabular-nums" dir="ltr">
                      {evidence.contribution > 0 ? "+" : ""}
                      {evidence.contribution.toLocaleString("fa-IR")}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <PropertyMatchReview
            comparison={detail.data.comparison}
            suggestionId={suggestionId}
            onRefresh={() => void detail.refetch()}
          />
        </>
      ) : null}
    </div>
  );
}

export function PropertyMatchSuggestions() {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [band, setBand] = useState<"likely" | "possible" | "all">("likely");
  const [claim, setClaim] = useState<"unclaimed" | "claimed" | "all">(
    "unclaimed",
  );
  const [ordering, setOrdering] = useState<
    "confidence" | "oldest" | "newest_evidence"
  >("confidence");
  const suggestions = useQuery(
    propertyMatchSuggestionsQuery(page, band, claim, ordering),
  );

  if (selectedId) {
    return (
      <SuggestionDetail
        suggestionId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <Sparkles className="text-primary size-5" aria-hidden="true" />
            پیشنهادها
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            به‌طور پیش‌فرض، تطبیق‌های محتمل و بدون مسئول از بیشترین اطمینان
            نمایش داده می‌شوند.
          </p>
        </div>
        {suggestions.data ? (
          <Badge variant="secondary">
            {suggestions.data.count.toLocaleString("fa-IR")} پیشنهاد
          </Badge>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          نوار اطمینان
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={band}
            onChange={(event) => {
              setBand(event.target.value as typeof band);
              setPage(1);
            }}
          >
            <option value="likely">محتمل</option>
            <option value="possible">ممکن</option>
            <option value="all">همه</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          مسئول بررسی
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={claim}
            onChange={(event) => {
              setClaim(event.target.value as typeof claim);
              setPage(1);
            }}
          >
            <option value="unclaimed">بدون مسئول</option>
            <option value="claimed">دارای مسئول</option>
            <option value="all">همه</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          مرتب‌سازی
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={ordering}
            onChange={(event) => {
              setOrdering(event.target.value as typeof ordering);
              setPage(1);
            }}
          >
            <option value="confidence">بیشترین اطمینان</option>
            <option value="oldest">قدیمی‌ترین</option>
            <option value="newest_evidence">جدیدترین شواهد</option>
          </select>
        </label>
      </div>
      {suggestions.isPending ? (
        <p role="status">در حال دریافت پیشنهادها…</p>
      ) : null}
      {suggestions.isError ? (
        <Alert variant="destructive">
          <AlertTitle>صف پیشنهادها دریافت نشد</AlertTitle>
          <AlertDescription>دوباره تلاش کنید.</AlertDescription>
        </Alert>
      ) : null}
      {suggestions.data?.results.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border p-6 text-center">
          پیشنهاد محتمل و بدون مسئولی وجود ندارد.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {suggestions.data?.results.map((suggestion) => (
          <Card key={suggestion.id} className="gap-3 shadow-none">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  {suggestion.properties.map((property) => (
                    <CardTitle
                      key={property.id}
                      className="mb-1 text-base last:mb-0"
                    >
                      {property.title}
                    </CardTitle>
                  ))}
                </div>
                <Badge>{suggestion.score.toLocaleString("fa-IR")} از ۱۰۰</Badge>
              </div>
              <p className="text-muted-foreground text-xs">
                {bandLabels[suggestion.band]} · قدیمی‌ترین مورد ابتدا در امتیاز
                برابر
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="flex flex-wrap gap-2">
                {suggestion.evidence_summary.slice(0, 3).map((evidence) => (
                  <li key={`${evidence.label}:${evidence.classification}`}>
                    <Badge variant="outline">{evidence.label}</Badge>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setSelectedId(suggestion.id)}
              >
                مشاهده جزئیات
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {suggestions.data ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            aria-label="صفحه قبل پیشنهادها"
            disabled={!suggestions.data.previous}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            صفحه قبل
          </Button>
          <span className="text-muted-foreground text-sm">
            صفحه {page.toLocaleString("fa-IR")}
          </span>
          <Button
            type="button"
            variant="outline"
            aria-label="صفحه بعد پیشنهادها"
            disabled={!suggestions.data.next}
            onClick={() => setPage((current) => current + 1)}
          >
            صفحه بعد
          </Button>
        </div>
      ) : null}
    </div>
  );
}
