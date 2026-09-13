import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Layers3, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  groupedPropertiesQuery,
  groupedPropertyDetailQuery,
} from "@/features/catalog-curation/queries";
import type { components } from "@/lib/api/schema";
import { api } from "@/lib/api/client";

type GroupSummary = components["schemas"]["GroupedPropertySummary"];
type GroupPair = components["schemas"]["GroupConsistencyPair"];
type PartitionPreview = components["schemas"]["PropertyPartitionPreview"];
type PartitionListing = components["schemas"]["PropertyPartitionListing"];

const factLabels: Record<string, string> = {
  city_id: "شهر",
  district_id: "منطقه",
  neighborhood_id: "محله",
  property_type: "نوع ملک",
  area_sqm: "متراژ",
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
  latitude: "عرض جغرافیایی دقیق",
  longitude: "طول جغرافیایی دقیق",
  operator_location_notes: "یادداشت مکان",
  provenance_note: "یادداشت شواهد",
};

const attentionLabels: Record<GroupSummary["attention_status"], string> = {
  needs_attention: "نیازمند توجه",
  recent_change: "تغییر گروه اخیر",
  stable: "گروه پایدار",
  not_measured: "هنوز سنجیده نشده",
};

function displayFact(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  return JSON.stringify(value);
}

function editableFact(value: unknown) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) {
    return `${value as string | number | boolean}`;
  }
  return JSON.stringify(value);
}

function ListingEvidence({ listing }: { listing: PartitionListing }) {
  return (
    <article className="space-y-2 rounded-md border p-2 text-sm">
      <p className="font-medium">
        {listing.source.name} · {listing.source_reference || "بدون شناسه"}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">وضعیت</dt>
        <dd>{listing.state}</dd>
        <dt className="text-muted-foreground">مسیر منبع</dt>
        <dd className="break-all" dir="ltr">
          {listing.external_url || "—"}
        </dd>
        <dt className="text-muted-foreground">تماس مستقیم</dt>
        <dd dir="ltr">{listing.direct_phone || "—"}</dd>
        <dt className="text-muted-foreground">شرایط اجاره</dt>
        <dd>{displayFact(listing.rental_terms)}</dd>
        <dt className="text-muted-foreground">ادعاهای منبع</dt>
        <dd>{displayFact(listing.source_claims)}</dd>
        <dt className="text-muted-foreground">منشا شواهد</dt>
        <dd>{listing.provenance_note || "—"}</dd>
      </dl>
    </article>
  );
}

function PairSummary({
  title,
  pair,
}: {
  title: string;
  pair: GroupPair | null;
}) {
  return (
    <div className="rounded-xl border p-3">
      <p className="font-medium">{title}</p>
      {pair ? (
        <p className="text-muted-foreground mt-1 text-sm">
          {pair.score?.toLocaleString("fa-IR") ?? "—"} از ۱۰۰ · آگهی‌های{" "}
          <span dir="ltr">{pair.listing_ids.join(" / ")}</span>
        </p>
      ) : (
        <p className="text-muted-foreground mt-1 text-sm">
          جفت سنجیده‌شده‌ای وجود ندارد.
        </p>
      )}
    </div>
  );
}

function PartitionPanel({
  propertyId,
  listings,
}: {
  propertyId: string;
  listings: components["schemas"]["CatalogCurationListingEvidence"][];
}) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<PartitionPreview | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [destinationMode, setDestinationMode] = useState<"restore" | "new">(
    "new",
  );
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [newFacts, setNewFacts] = useState<Record<string, unknown>>({});
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  const [imagesConfirmed, setImagesConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [completed, setCompleted] = useState(false);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/catalog-curation/grouped-properties/{property_id}/partitions/preview/",
        {
          params: { path: { property_id: propertyId } },
          body: { listing_ids: selectedIds },
        },
      );
      if (error || !data) throw new Error("Could not preview partition");
      return data;
    },
    onSuccess(data) {
      setPreview(data);
      setClaimId(null);
      const restored = data.restoration_options[0]?.id ?? null;
      setDestinationMode(restored ? "restore" : "new");
      setDestinationId(restored);
      setImageIds([]);
      setNewFacts({ ...data.new_property_defaults });
      setFactsConfirmed(false);
      setImagesConfirmed(false);
      setCompleted(false);
    },
  });
  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("A preview is required");
      const { data, error } = await api.POST(
        "/api/v1/operator/catalog-curation/grouped-properties/{property_id}/partitions/claim/",
        {
          params: { path: { property_id: propertyId } },
          body: {
            listing_ids: preview.selected_listing_ids,
            revision: preview.revision,
          },
        },
      );
      if (error || !data?.claim) throw new Error("Could not claim partition");
      return data;
    },
    onSuccess(data) {
      setPreview(data);
      setClaimId(String(data.claim?.id));
    },
  });
  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!preview || !claimId) throw new Error("A claim is required");
      const { data, error } = await api.POST(
        "/api/v1/operator/catalog-curation/grouped-properties/{property_id}/partitions/confirm/",
        {
          params: { path: { property_id: propertyId } },
          body: {
            listing_ids: preview.selected_listing_ids,
            revision: preview.revision,
            claim_id: claimId,
            destination_mode: destinationMode,
            destination_property_id:
              destinationMode === "restore" ? destinationId : null,
            normalized_facts: destinationMode === "new" ? newFacts : {},
            image_ids: imageIds,
            facts_confirmed: factsConfirmed,
            images_confirmed: imagesConfirmed,
            reason,
          },
        },
      );
      if (error || !data) throw new Error("Could not confirm partition");
      return data;
    },
    onSuccess() {
      setCompleted(true);
      void queryClient.invalidateQueries({
        queryKey: ["catalog-curation", "grouped-properties"],
      });
    },
  });

  const toggleListing = (id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
    );
    setPreview(null);
    setClaimId(null);
  };
  const invalidSelection =
    selectedIds.length === 0 || selectedIds.length === listings.length;

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">تفکیک آگهی‌های اشتباه</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          یک یا چند آگهی، اما نه همه گروه، را برای ملک جداشده انتخاب کنید.
        </p>
        <div className="space-y-2">
          {listings.map((listing) => {
            const label = `انتخاب آگهی ${listing.source.name} ${listing.source_reference || "بدون شناسه"}`;
            return (
              <div
                key={listing.id}
                className="flex items-center gap-2 rounded-lg border p-3"
              >
                <Checkbox
                  id={`partition-${listing.id}`}
                  aria-label={label}
                  checked={selectedIds.includes(listing.id)}
                  onCheckedChange={(value) =>
                    toggleListing(listing.id, value === true)
                  }
                />
                <Label htmlFor={`partition-${listing.id}`}>
                  {listing.source.name} ·{" "}
                  {listing.source_reference || "بدون شناسه"}
                </Label>
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={invalidSelection || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          پیش‌نمایش تفکیک
        </Button>
        {previewMutation.isError ? (
          <Alert variant="destructive">
            <AlertTitle>پیش‌نمایش آماده نشد</AlertTitle>
            <AlertDescription>
              شواهد را تازه کنید و دوباره تلاش کنید.
            </AlertDescription>
          </Alert>
        ) : null}
        {preview ? (
          <div className="space-y-4 rounded-xl border p-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                {preview.selected_listings.length.toLocaleString("fa-IR")} آگهی
                جدا می‌شود.
              </p>
              <p>
                {preview.remaining_listings.length.toLocaleString("fa-IR")} آگهی
                باقی می‌ماند.
              </p>
              <p>
                {preview.favorites.surviving_count.toLocaleString("fa-IR")}{" "}
                علاقه‌مندی روی ملک باقی می‌ماند.
              </p>
              <p>
                {preview.pending_suggestions.length.toLocaleString("fa-IR")}{" "}
                پیشنهاد در انتظار تحت تاثیر است.
              </p>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                {preview.approved_connections.length.toLocaleString("fa-IR")}{" "}
                پیوند در گراف اتصال بازبینی شد.
              </p>
              <p>
                {preview.grouping_history.length.toLocaleString("fa-IR")} رویداد
                گروه‌بندی در شواهد ثبت است.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">آگهی‌های جداشونده</p>
                {preview.selected_listings.map((listing) => (
                  <ListingEvidence key={listing.id} listing={listing} />
                ))}
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">آگهی‌های باقی‌مانده</p>
                {preview.remaining_listings.map((listing) => (
                  <ListingEvidence key={listing.id} listing={listing} />
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">گراف اتصال</p>
                {preview.approved_connections.length ? (
                  preview.approved_connections.map((connection) => (
                    <p
                      key={connection.decision_id}
                      className="text-xs break-all"
                      dir="ltr"
                    >
                      {connection.left_property_id} →{" "}
                      {connection.right_property_id}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground text-xs">
                    بدون پیوند تاییدشده
                  </p>
                )}
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">سابقه گروه‌بندی</p>
                {preview.grouping_history.length ? (
                  preview.grouping_history.map((event) => (
                    <p key={event.id} className="text-xs">
                      {event.action} · {event.reason || "بدون دلیل"}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground text-xs">بدون سابقه</p>
                )}
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">پیشنهادهای در انتظار</p>
                {preview.pending_suggestions.length ? (
                  preview.pending_suggestions.map((suggestion, index) => (
                    <p key={index} className="text-xs break-all" dir="ltr">
                      {JSON.stringify(suggestion)}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground text-xs">بدون پیشنهاد</p>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {preview.resulting_properties.map((result) => (
                <div key={result.role} className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-medium">
                    {result.role === "surviving"
                      ? "ملک باقی‌مانده"
                      : "ملک جداشده"}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {Object.entries(result.normalized_facts).map(
                      ([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-muted-foreground">{key}</dt>
                          <dd>{displayFact(value)}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                </div>
              ))}
            </div>
            <RadioGroup
              value={
                destinationMode === "restore"
                  ? `restore:${destinationId}`
                  : "new"
              }
              onValueChange={(value) => {
                setDestinationMode(value === "new" ? "new" : "restore");
                setDestinationId(
                  value === "new" ? null : value.slice("restore:".length),
                );
              }}
            >
              {preview.restoration_options.map((option) => (
                <div key={option.id} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={`restore:${option.id}`}
                    id={`restore-${option.id}`}
                  />
                  <Label htmlFor={`restore-${option.id}`}>
                    بازیابی ملک تاریخی {option.id}
                  </Label>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <RadioGroupItem value="new" id="partition-new-property" />
                <Label htmlFor="partition-new-property">
                  ساخت ملک تازه با واقعیت‌های نمایش‌داده‌شده
                </Label>
              </div>
            </RadioGroup>
            {destinationMode === "new" ? (
              <div className="rounded-lg border p-3">
                <p className="mb-3 text-sm font-medium">واقعیت‌های ملک تازه</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(newFacts).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <Label htmlFor={`partition-fact-${key}`}>
                        {factLabels[key] ?? key}
                      </Label>
                      <Input
                        id={`partition-fact-${key}`}
                        value={editableFact(value)}
                        onChange={(event) =>
                          setNewFacts((current) => ({
                            ...current,
                            [key]: event.target.value || null,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {preview.property_images.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border p-2"
              >
                <Checkbox
                  id={`partition-image-${item.id}`}
                  checked={imageIds.includes(item.id)}
                  onCheckedChange={(value) =>
                    setImageIds((current) =>
                      value === true
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                <img
                  src={item.url}
                  alt={`تصویر پیشنهادی ملک ${item.id}`}
                  className="h-20 w-28 rounded-md object-cover"
                />
                <Label htmlFor={`partition-image-${item.id}`}>
                  انتخاب تصویر ملک {item.id}
                </Label>
              </div>
            ))}
            {!claimId ? (
              <Button
                type="button"
                disabled={claimMutation.isPending}
                onClick={() => claimMutation.mutate()}
              >
                شروع بررسی تفکیک
              </Button>
            ) : (
              <div className="space-y-3">
                <Label htmlFor="partition-reason">دلیل اختیاری</Label>
                <textarea
                  id="partition-reason"
                  className="border-input min-h-20 w-full rounded-md border bg-transparent p-3"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="partition-facts-confirmed"
                    checked={factsConfirmed}
                    onCheckedChange={(value) =>
                      setFactsConfirmed(value === true)
                    }
                  />
                  <Label htmlFor="partition-facts-confirmed">
                    واقعیت‌های ملک جداشده را تأیید می‌کنم
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="partition-images-confirmed"
                    checked={imagesConfirmed}
                    onCheckedChange={(value) =>
                      setImagesConfirmed(value === true)
                    }
                  />
                  <Label htmlFor="partition-images-confirmed">
                    تصاویر ملک جداشده را تأیید می‌کنم
                  </Label>
                </div>
                <Button
                  type="button"
                  disabled={
                    !factsConfirmed ||
                    !imagesConfirmed ||
                    confirmMutation.isPending ||
                    (destinationMode === "restore" && !destinationId)
                  }
                  onClick={() => confirmMutation.mutate()}
                >
                  تأیید تفکیک
                </Button>
              </div>
            )}
            {claimMutation.isError || confirmMutation.isError ? (
              <Alert variant="destructive">
                <AlertTitle>تفکیک ثبت نشد</AlertTitle>
                <AlertDescription>
                  بررسی منقضی یا شواهد تغییر کرده است.
                </AlertDescription>
              </Alert>
            ) : null}
            {completed ? (
              <Alert>
                <AlertTitle>تفکیک ثبت شد.</AlertTitle>
                <AlertDescription>
                  نتایج عمومی و سابقه گروه‌بندی به‌روز شدند.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GroupDetail({
  propertyId,
  onBack,
}: {
  propertyId: string;
  onBack: () => void;
}) {
  const detail = useQuery(groupedPropertyDetailQuery(propertyId));
  const missingCount =
    detail.data?.measurement?.pair_measurements.filter(
      (pair) => pair.status === "missing_evidence",
    ).length ?? 0;
  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowRight aria-hidden="true" />
        بازگشت به گروه‌ها
      </Button>
      {detail.isPending ? <p role="status">در حال دریافت سنجش گروه…</p> : null}
      {detail.isError ? (
        <Alert variant="destructive">
          <AlertTitle>جزئیات گروه دریافت نشد</AlertTitle>
          <AlertDescription>دوباره تلاش کنید.</AlertDescription>
        </Alert>
      ) : null}
      {detail.data ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">{detail.data.title}</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {detail.data.listing_count.toLocaleString("fa-IR")} آگهی با همه
                وضعیت‌های فعالیت
              </p>
            </div>
            <Badge
              variant={
                detail.data.needs_attention ? "destructive" : "secondary"
              }
            >
              {attentionLabels[detail.data.attention_status]}
            </Badge>
          </div>
          {detail.data.measurement ? (
            <>
              <p className="text-muted-foreground text-sm" dir="ltr">
                نسخه سنجش: {detail.data.measurement.scoring_version}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <PairSummary
                  title="قوی‌ترین جفت سنجیده‌شده"
                  pair={detail.data.measurement.strongest_pair}
                />
                <PairSummary
                  title="ضعیف‌ترین جفت سنجیده‌شده"
                  pair={detail.data.measurement.weakest_pair}
                />
              </div>
              <Card className="shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">تناقض‌های صریح</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-3 text-sm">
                    {detail.data.measurement.needs_attention
                      ? "دست‌کم یک تناقض قابل اتکا نیازمند توجه است."
                      : "هیچ تناقض قابل اتکایی ثبت نشده است."}
                  </p>
                  {detail.data.measurement.explicit_contradictions.length ? (
                    <ul className="space-y-2">
                      {detail.data.measurement.explicit_contradictions.map(
                        (item, index) => (
                          <li
                            key={`${String(item.key)}:${index}`}
                            className="rounded-lg border p-3"
                          >
                            {String(item.label ?? item.key)}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      تناقض صریحی ثبت نشده است.
                    </p>
                  )}
                </CardContent>
              </Card>
              {missingCount ? (
                <Alert>
                  <AlertTitle>شواهد ناقص</AlertTitle>
                  <AlertDescription>
                    شواهد این جفت موجود نیست؛ نبود شواهد به معنی تناقض نیست.{" "}
                    {missingCount.toLocaleString("fa-IR")} جفت بدون شواهد مستقیم
                    است.
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          ) : (
            <Alert>
              <AlertTitle>سنجش جاری موجود نیست</AlertTitle>
              <AlertDescription>
                این گروه هنوز با نسخه فعلی امتیازدهی سنجیده نشده است.
              </AlertDescription>
            </Alert>
          )}
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">شواهد محدودشده گروه</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="tabular-nums" dir="ltr">
                {detail.data.property.exact_location.latitude ?? "—"},{" "}
                {detail.data.property.exact_location.longitude ?? "—"}
              </p>
              {detail.data.property.exact_location.operator_notes ? (
                <p>{detail.data.property.exact_location.operator_notes}</p>
              ) : null}
              <ul className="space-y-2">
                {detail.data.property.listings.map((listing) => (
                  <li key={listing.id} className="rounded-lg border p-3">
                    {listing.source.name} ·{" "}
                    {listing.source_reference || "بدون شناسه منبع"}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">گراف اتصال</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {detail.data.approved_connections.length.toLocaleString(
                    "fa-IR",
                  )}{" "}
                  پیوند تأییدشده
                </p>
                <p>
                  {detail.data.indirect_only_connections.length.toLocaleString(
                    "fa-IR",
                  )}{" "}
                  اتصال فقط غیرمستقیم
                </p>
                {detail.data.approved_connections.map((connection) => (
                  <p
                    key={connection.decision_id}
                    className="text-xs break-all"
                    dir="ltr"
                  >
                    {connection.left_property_id} →{" "}
                    {connection.right_property_id}
                  </p>
                ))}
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">تاریخچه گروه‌بندی</CardTitle>
              </CardHeader>
              <CardContent>
                {detail.data.grouping_history.length ? (
                  <ul className="space-y-2 text-sm">
                    {detail.data.grouping_history.map((event) => (
                      <li key={event.id}>{event.reason || event.action}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    سابقه ثبت‌شده‌ای در دسترس نیست.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          <PartitionPanel
            propertyId={propertyId}
            listings={detail.data.property.listings}
          />
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>این نتیجه فقط برای بازرسی است</AlertTitle>
            <AlertDescription>
              سنجش سازگاری هیچ آگهی را خودکار گروه‌بندی یا جدا نمی‌کند.
            </AlertDescription>
          </Alert>
        </>
      ) : null}
    </div>
  );
}

export function GroupedProperties() {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = useQuery(groupedPropertiesQuery(page));

  if (selectedId) {
    return (
      <GroupDetail propertyId={selectedId} onBack={() => setSelectedId(null)} />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <Layers3 className="text-primary size-5" aria-hidden="true" />
            ملک‌های گروه‌بندی‌شده
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            همه گروه‌ها، مستقل از منشأ گروه‌بندی و وضعیت آگهی، نمایش داده
            می‌شوند.
          </p>
        </div>
        {groups.data ? (
          <Badge variant="secondary">
            {groups.data.count.toLocaleString("fa-IR")} گروه
          </Badge>
        ) : null}
      </div>
      {groups.isPending ? <p role="status">در حال دریافت گروه‌ها…</p> : null}
      {groups.isError ? (
        <Alert variant="destructive">
          <AlertTitle>گروه‌ها دریافت نشدند</AlertTitle>
          <AlertDescription>دوباره تلاش کنید.</AlertDescription>
        </Alert>
      ) : null}
      {groups.data?.results.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border p-6 text-center">
          ملک گروه‌بندی‌شده‌ای وجود ندارد.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.data?.results.map((group) => (
          <Card key={group.id} className="gap-3 shadow-none">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{group.title}</CardTitle>
                <Badge
                  variant={group.needs_attention ? "destructive" : "secondary"}
                >
                  {attentionLabels[group.attention_status]}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{group.listing_count.toLocaleString("fa-IR")} آگهی</p>
              <p className="text-muted-foreground">
                وضعیت‌ها: {group.listing_states.join("، ")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setSelectedId(group.id)}
              >
                بررسی سازگاری
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {groups.data ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!groups.data.previous}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            صفحه قبل گروه‌ها
          </Button>
          <span className="text-muted-foreground text-sm">
            صفحه {page.toLocaleString("fa-IR")}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={!groups.data.next}
            onClick={() => setPage((value) => value + 1)}
          >
            صفحه بعد گروه‌ها
          </Button>
        </div>
      ) : null}
    </div>
  );
}
