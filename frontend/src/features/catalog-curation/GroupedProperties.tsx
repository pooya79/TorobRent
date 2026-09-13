import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Layers3, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  groupedPropertiesQuery,
  groupedPropertyDetailQuery,
} from "@/features/catalog-curation/queries";
import type { components } from "@/lib/api/schema";

type GroupSummary = components["schemas"]["GroupedPropertySummary"];
type GroupPair = components["schemas"]["GroupConsistencyPair"];

const attentionLabels: Record<GroupSummary["attention_status"], string> = {
  needs_attention: "نیازمند توجه",
  recent_change: "تغییر گروه اخیر",
  stable: "گروه پایدار",
  not_measured: "هنوز سنجیده نشده",
};

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
