import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  propertyMatchSuggestionDetailQuery,
  propertyMatchSuggestionsQuery,
} from "@/features/catalog-curation/queries";
import {
  updateQueueFilter,
  updateQueuePage,
} from "@/features/catalog-curation/url-state";
import { PropertyMatchReview } from "./PropertyMatchReview";

const bandLabels = {
  likely: "محتمل",
  possible: "ممکن",
  below_threshold: "زیر آستانه",
};

type ListingPair = {
  left: { listing_id: string; source: string };
  right: { listing_id: string; source: string };
};

function isListingReference(
  value: unknown,
): value is { listing_id: string; source: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "listing_id" in value &&
    typeof value.listing_id === "string" &&
    "source" in value &&
    typeof value.source === "string"
  );
}

function isListingPair(value: unknown): value is ListingPair {
  return (
    typeof value === "object" &&
    value !== null &&
    "left" in value &&
    isListingReference(value.left) &&
    "right" in value &&
    isListingReference(value.right)
  );
}

function listingPairs(comparison: {
  signals: Array<{ key: string; compared_values: Record<string, unknown> }>;
}): ListingPair[] {
  const pairs = comparison.signals.find((signal) => signal.key === "images")
    ?.compared_values.matched_pairs;
  if (!Array.isArray(pairs)) return [];
  return (pairs as unknown[]).filter(isListingPair);
}

function SuggestionDetail({
  suggestionId,
  onBack,
}: {
  suggestionId: string;
  onBack: () => void;
}) {
  const detail = useQuery(propertyMatchSuggestionDetailQuery(suggestionId));
  const matchedListingPairs = detail.data
    ? listingPairs(detail.data.comparison)
    : [];
  const contradictions =
    detail.data?.comparison.signals.filter((signal) =>
      ["contradiction", "blocker"].includes(signal.classification),
    ) ?? [];
  const indirectListingIds = new Set(
    detail.data?.comparison.indirect_listing_ids ?? [],
  );
  const indirectListings =
    detail.data?.comparison.properties
      .flatMap((property) => property.listings)
      .filter((listing) => indirectListingIds.has(listing.id)) ?? [];
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
          {matchedListingPairs.length > 0 ||
          contradictions.length > 0 ||
          detail.data.comparison.approved_connections.length > 0 ||
          detail.data.comparison.indirect_listing_ids.length > 0 ? (
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>شواهد ترکیبی گروه‌ها</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {matchedListingPairs.length > 0 ? (
                  <div>
                    <p className="font-medium">قوی‌ترین جفت‌های پشتیبان</p>
                    <ul className="mt-2 space-y-1">
                      {matchedListingPairs.map((pair) => (
                        <li
                          key={`${pair.left.listing_id}:${pair.right.listing_id}`}
                        >
                          {pair.left.source} و {pair.right.source}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {contradictions.length > 0 ? (
                  <div>
                    <p className="font-medium">تناقض‌های مرتبط</p>
                    <ul className="mt-2 space-y-1">
                      {contradictions.map((signal) => (
                        <li key={signal.key}>{signal.label}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {detail.data.comparison.approved_connections.length > 0 ? (
                  <p>
                    پیوندهای تأییدشده:{" "}
                    {detail.data.comparison.approved_connections.length.toLocaleString(
                      "fa-IR",
                    )}
                  </p>
                ) : null}
                {indirectListings.length > 0 ? (
                  <div>
                    <p className="font-medium">آگهی‌های متصل غیرمستقیم</p>
                    <ul className="mt-2 space-y-1">
                      {indirectListings.map((listing) => (
                        <li key={listing.id}>
                          {listing.source.name} · {listing.source_reference}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="text-muted-foreground">
                  نبود شواهد مستقیم به معنی تناقض نیست و هیچ پیوندی بدون تصمیم
                  اپراتور تأیید نمی‌شود.
                </p>
              </CardContent>
            </Card>
          ) : null}
          <PropertyMatchReview
            key={`${detail.data.id}:${detail.data.comparison.revision}`}
            comparison={detail.data.comparison}
            suggestionId={detail.data.id}
            onRefresh={() => void detail.refetch()}
          />
        </>
      ) : null}
    </div>
  );
}

export function PropertyMatchSuggestions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = searchParams.get("s_q") ?? "";
  const [draftState, setDraftState] = useState({ query, value: query });
  const draft = draftState.query === query ? draftState.value : query;
  const page = Math.max(1, Number(searchParams.get("s_page")) || 1);
  const band = (searchParams.get("s_band") ?? "likely") as
    "likely" | "possible" | "below_threshold" | "all";
  const claim = (searchParams.get("s_claim") ?? "unclaimed") as
    "unclaimed" | "claimed" | "mine" | "all";
  const state = (searchParams.get("s_state") ?? "pending") as
    "pending" | "approved" | "rejected" | "snoozed" | "superseded" | "all";
  const age = (searchParams.get("s_age") ?? "all") as
    "all" | "older_than_24_hours" | "older_than_7_days";
  const ownWork = (searchParams.get("s_own") ?? "all") as
    "all" | "clear" | "conflict";
  const ordering = (searchParams.get("s_order") ?? "confidence") as
    "confidence" | "oldest" | "newest_evidence" | "status";
  const suggestions = useQuery(
    propertyMatchSuggestionsQuery({
      page,
      q: query,
      band,
      claim,
      state,
      age,
      ownWork,
      ordering,
    }),
  );

  function updateFilter(key: string, value: string) {
    setSearchParams((current) =>
      updateQueueFilter(current, key, value, "s_page"),
    );
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateFilter("s_q", draft.trim());
  }

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
      <form onSubmit={submitSearch} role="search" className="flex gap-2">
        <input
          type="search"
          className="border-input bg-background h-10 min-w-0 flex-1 rounded-md border px-3"
          aria-label="جست‌وجوی پیشنهادها"
          placeholder="شناسه ملک، آگهی، منبع، محله یا شناسه منبع"
          value={draft}
          onChange={(event) =>
            setDraftState({ query, value: event.target.value })
          }
        />
        <Button type="submit">جست‌وجوی پیشنهادها</Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm">
          نوار اطمینان
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={band}
            onChange={(event) => updateFilter("s_band", event.target.value)}
          >
            <option value="likely">محتمل</option>
            <option value="possible">ممکن</option>
            <option value="below_threshold">زیر آستانه</option>
            <option value="all">همه</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          مسئول بررسی
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={claim}
            onChange={(event) => updateFilter("s_claim", event.target.value)}
          >
            <option value="unclaimed">بدون مسئول</option>
            <option value="claimed">دارای مسئول</option>
            <option value="mine">واگذارشده به من</option>
            <option value="all">همه</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          چرخه پیشنهاد
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={state}
            onChange={(event) => updateFilter("s_state", event.target.value)}
          >
            <option value="pending">در انتظار</option>
            <option value="snoozed">به تعویق افتاده</option>
            <option value="rejected">ردشده</option>
            <option value="approved">تأییدشده</option>
            <option value="superseded">جایگزین‌شده</option>
            <option value="all">همه</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          سن پیشنهاد
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={age}
            onChange={(event) => updateFilter("s_age", event.target.value)}
          >
            <option value="all">همه</option>
            <option value="older_than_24_hours">بیش از ۲۴ ساعت</option>
            <option value="older_than_7_days">بیش از ۷ روز</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          تعارض کار خود
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={ownWork}
            onChange={(event) => updateFilter("s_own", event.target.value)}
          >
            <option value="all">همه</option>
            <option value="clear">بدون تعارض</option>
            <option value="conflict">دارای تعارض</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          مرتب‌سازی
          <select
            className="border-input bg-background h-10 rounded-md border px-3"
            value={ordering}
            onChange={(event) => updateFilter("s_order", event.target.value)}
          >
            <option value="confidence">بیشترین اطمینان</option>
            <option value="oldest">قدیمی‌ترین</option>
            <option value="newest_evidence">جدیدترین شواهد</option>
            <option value="status">وضعیت مرتبط</option>
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
            onClick={() =>
              setSearchParams((current) =>
                updateQueuePage(current, "s_page", page - 1),
              )
            }
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
            onClick={() =>
              setSearchParams((current) =>
                updateQueuePage(current, "s_page", page + 1),
              )
            }
          >
            صفحه بعد
          </Button>
        </div>
      ) : null}
    </div>
  );
}
