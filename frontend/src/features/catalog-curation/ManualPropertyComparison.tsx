import { ManualComparisonResult } from "./ManualComparisonResult";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, GitCompareArrows, Search } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

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
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">شناسه داخلی ملک</summary>
          <p className="mt-2 break-all" dir="ltr">
            {property.id}
          </p>
        </details>
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

export function ManualPropertyComparison() {
  const [reviewVersion, setReviewVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SearchProperty[]>([]);
  const [comparisonIds, setComparisonIds] = useState<readonly string[] | null>(
    null,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isComparing = comparisonIds !== null;
  useEffect(() => {
    if (!isComparing) return;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: "start" });
  }, [isComparing]);
  const search = useQuery(catalogCurationSearchQuery(searchTerm, page));
  const comparison = useQuery(propertyComparisonQuery(comparisonIds));

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSelected([]);
    setComparisonIds(null);
    setPage(1);
    setSearchTerm(draft.trim());
  }

  function toggleProperty(property: SearchProperty) {
    setComparisonIds(null);
    setSelected((current) =>
      current.some((item) => item.id === property.id)
        ? current.filter((item) => item.id !== property.id)
        : current.length < 2
          ? [...current, property]
          : current,
    );
  }

  return (
    <section id="manual-comparison" aria-labelledby="manual-comparison-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="manual-comparison-title"
            ref={headingRef}
            tabIndex={-1}
            className="scroll-mt-24 text-2xl font-semibold outline-none"
          >
            {isComparing ? "نتیجه مقایسه ملک‌ها" : "مقایسه دستی ملک‌ها"}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {isComparing
              ? "ابتدا خلاصه را بخوانید؛ جزئیات شواهد و ثبت تصمیم در بخش‌های جداگانه در دسترس‌اند."
              : "با شناسه ملک، شناسه آگهی، منبع، محله یا شناسه منبع جست‌وجو کنید."}
          </p>
        </div>
        {isComparing ? (
          <Button variant="outline" onClick={() => setComparisonIds(null)}>
            <ArrowRight aria-hidden="true" />
            بازگشت به انتخاب ملک‌ها
          </Button>
        ) : (
          <Badge variant="outline">
            {selected.length.toLocaleString("fa-IR")} از ۲ انتخاب شده
          </Badge>
        )}
      </div>

      {!isComparing ? (
        <>
          <form
            onSubmit={submitSearch}
            role="search"
            className="mb-6 flex gap-2"
          >
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

          {searchTerm === null ? (
            <div className="bg-muted/30 rounded-2xl border border-dashed px-6 py-12 text-center">
              <Search
                className="text-primary mx-auto mb-4 size-8"
                aria-hidden="true"
              />
              <h3 className="font-semibold">دو ملک را پیدا و مقایسه کنید</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-7">
                ۱. جست‌وجوی مشخصات ملک · ۲. انتخاب دو نتیجه · ۳. بررسی شواهد
              </p>
            </div>
          ) : null}
          {search.data?.results.length === 0 ? (
            <p
              role="status"
              className="text-muted-foreground rounded-xl border border-dashed p-10 text-center"
            >
              ملکی با این مشخصات پیدا نشد. عبارت دیگری را امتحان کنید.
            </p>
          ) : null}
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
                    selected={selected.some((item) => item.id === property.id)}
                    selectionFull={selected.length === 2}
                    onToggle={() => toggleProperty(property)}
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

          <div className="bg-background/95 sticky bottom-4 z-10 my-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 shadow-lg backdrop-blur">
            <p className="text-sm">
              {selected.length === 2
                ? "هر دو ملک انتخاب شده‌اند؛ شواهد را مقایسه کنید."
                : "برای شروع مقایسه، دو ملک انتخاب کنید."}
            </p>
            <Button
              type="button"
              size="lg"
              disabled={selected.length !== 2}
              onClick={() =>
                setComparisonIds(selected.map((property) => property.id))
              }
            >
              <GitCompareArrows aria-hidden="true" />
              مقایسه دو ملک
            </Button>
          </div>
        </>
      ) : null}
      {comparison.isPending && comparisonIds ? (
        <p role="status">در حال سنجش شواهد…</p>
      ) : null}
      {isComparing && comparison.isError ? (
        <Alert variant="destructive">
          <AlertTitle>مقایسه انجام نشد</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              disabled={comparison.isFetching}
              onClick={() => void comparison.refetch()}
            >
              تلاش دوباره برای مقایسه
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {isComparing && comparison.data ? (
        <ManualComparisonResult
          key={comparisonIds.join(":")}
          comparison={comparison.data}
          selected={selected}
          reviewVersion={reviewVersion}
          onRefresh={() => {
            void comparison
              .refetch()
              .then(() => setReviewVersion((value) => value + 1));
          }}
        />
      ) : null}
    </section>
  );
}
