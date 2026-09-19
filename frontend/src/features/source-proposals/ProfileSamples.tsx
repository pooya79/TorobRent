import { useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { components } from "@/lib/api/schema";
import { CandidateMedia } from "./CandidateMedia";
import { ProfileRule } from "./ProfileRule";
import { fields, displayField } from "./profile-presentation";

type Version = components["schemas"]["SourceProfileVersion"];
export type RepairSelection = {
  fields: string[];
  disabled: boolean;
  toggle: (field: string, checked: boolean) => void;
};
const groups = [
  {
    title: "مشخصات ملک",
    fields: [
      "title",
      "property_type",
      "floor_area_sqm",
      "bedroom_count",
      "construction_year",
      "floor",
      "total_floors",
      "units_per_floor",
      "description",
    ],
  },
  {
    title: "موقعیت",
    fields: [
      "city",
      "district",
      "neighborhood",
      "source_location_text",
      "latitude",
      "longitude",
    ],
  },
  {
    title: "مبالغ و شرایط",
    fields: [
      "deposit_rial",
      "monthly_rent_rial",
      "is_negotiable",
      "is_convertible",
    ],
  },
  {
    title: "امکانات",
    fields: [
      "parking",
      "elevator",
      "storage",
      "balcony",
      "furnished",
      "heating",
      "cooling",
    ],
  },
  {
    title: "اطلاعات آگهی",
    fields: [
      "source_reference",
      "source_url",
      "published_at",
      "availability_confirmed_at",
      "image_urls",
    ],
  },
];

export function ProfileSamples({
  version,
  selection,
}: {
  version: Version;
  selection?: RepairSelection;
}) {
  const id = useId();
  const [showAllFields, setShowAllFields] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState(
    version.samples[0]?.canonical_url ?? "",
  );
  const sample =
    version.samples.find((item) => item.canonical_url === selectedUrl) ??
    version.samples[0];
  const problemCount = version.samples.filter(
    (item) =>
      item.unresolved.length > 0 ||
      Object.keys(item.conflicts).length > 0 ||
      item.structural_drift,
  ).length;
  if (!sample)
    return (
      <div
        role="status"
        className="bg-muted/30 rounded-xl border p-5 text-sm leading-7"
      >
        نمونه‌ای برای نمایش در این نسخه موجود نیست. برای دریافت نمونه‌های تازه،
        بررسی استخراج را از بخش نشانی و کشف آغاز کنید. نبود نمونه به معنی درستی
        قواعد نیست.
      </div>
    );
  const visibleFields = new Set([
    ...(showAllFields ? Object.keys(fields) : []),
    ...Object.keys(sample.normalized),
    ...sample.unresolved,
    ...Object.keys(sample.conflicts),
    ...Object.keys(sample.evidence),
    ...Object.keys(version.rules as Record<string, unknown>),
  ]);
  const unknownFields = [...visibleFields].filter((field) => !fields[field]);
  return (
    <section className="grid min-w-0 gap-5" aria-label="نمونه‌های استخراج">
      <div className="bg-muted/30 grid gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">اطلاعات خوانده‌شده از صفحات</h3>
          <span className="text-muted-foreground text-sm">
            {problemCount.toLocaleString("fa-IR")} از{" "}
            {version.samples.length.toLocaleString("fa-IR")} نمونه با فیلد
            حل‌نشده، تعارض یا تغییر ساختار
          </span>
        </div>
        <Label htmlFor={id}>صفحه نمونه</Label>
        <select
          id={id}
          className="border-input bg-background w-full min-w-0 rounded-md border p-3 text-sm"
          value={sample.canonical_url}
          onChange={(e) => setSelectedUrl(e.target.value)}
        >
          {version.samples.map((item, index) => (
            <option key={item.canonical_url} value={item.canonical_url}>
              نمونه {(index + 1).toLocaleString("fa-IR")} ·{" "}
              {typeof item.normalized.title === "string"
                ? item.normalized.title
                : item.canonical_url}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="outline">
            {version.validation.held_out_page_urls.includes(
              sample.canonical_url,
            )
              ? "اعتبارسنجی مستقل"
              : version.validation.training_page_urls.includes(
                    sample.canonical_url,
                  )
                ? "نمونه ساخت قواعد"
                : "نمونه استخراج"}
          </Badge>
          {/^https?:\/\//i.test(sample.canonical_url) && (
            <Button asChild variant="outline" size="sm">
              <a
                href={sample.canonical_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                مشاهده صفحه اصلی <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          استخراج‌شده به معنی تأیید درستی اطلاعات نیست. مقدار را با متن صفحه
          اصلی مقایسه کنید.
        </p>
        {selection && (
          <p className="text-sm">
            فیلدهای نادرست یا جاافتاده را برای اصلاح انتخاب کنید؛ انتخاب‌ها با
            جابه‌جایی بین نمونه‌ها حفظ می‌شوند.
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={showAllFields}
          onClick={() => setShowAllFields(!showAllFields)}
        >
          {showAllFields
            ? "نمایش فیلدهای موجود و مشکلات ثبت‌شده"
            : "نمایش همه فیلدها"}
        </Button>
        {sample.structural_drift && (
          <p role="status">
            ساختار این صفحه با ساختار مورد انتظار تفاوت دارد؛ نتایج را بررسی
            کنید.
          </p>
        )}
      </div>
      <CandidateMedia
        images={
          version.media_candidates?.find(
            (candidate) => candidate.external_url === sample.canonical_url,
          )?.media ?? []
        }
      />
      {[...groups, { title: "سایر اطلاعات", fields: unknownFields }].map(
        (group) => {
          const shown = group.fields.filter((field) =>
            visibleFields.has(field),
          );
          if (!shown.length) return null;
          return (
            <section
              key={group.title}
              className="grid gap-3"
              aria-label={group.title}
            >
              <h4 className="font-semibold">{group.title}</h4>
              {shown.map((field) => {
                const value = sample.normalized[field];
                const conflicts = sample.conflicts[field] ?? [];
                const missing =
                  sample.unresolved.includes(field) ||
                  value == null ||
                  value === "" ||
                  value === "unknown" ||
                  (Array.isArray(value) && value.length === 0);
                const evidence = sample.evidence[field] ?? [];
                const snippets = [
                  ...new Set(
                    evidence
                      .map((item) => item.evidence_snippet)
                      .filter(
                        (snippet) => snippet && !/^\s*[[{]/.test(snippet),
                      ),
                  ),
                ];
                const label = fields[field] ?? field;
                return (
                  <article
                    key={field}
                    aria-label={label}
                    className="min-w-0 rounded-xl border p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <h5 className="font-medium">{label}</h5>
                      <Badge variant="outline">
                        {conflicts.length
                          ? "نیازمند توجه"
                          : missing
                            ? "استخراج نشده"
                            : "استخراج‌شده"}
                      </Badge>
                    </div>
                    <div className="grid min-w-0 gap-4 md:grid-cols-2">
                      <div className="min-w-0">
                        <p className="text-muted-foreground mb-1 text-xs">
                          مقدار استخراج‌شده
                        </p>
                        <p className="text-sm leading-7 break-words">
                          {displayField(field, value)}
                        </p>
                        {conflicts.length > 0 ? (
                          <p className="mt-2 text-sm">
                            مقادیر متعارض:{" "}
                            {conflicts
                              .map((item) => displayField(field, item))
                              .join("، ")}
                          </p>
                        ) : missing ? (
                          <p className="text-muted-foreground mt-2 text-sm">
                            مقداری استخراج نشده؛ نبود اطلاعات در صفحه از این
                            نتیجه قابل تشخیص نیست.
                          </p>
                        ) : null}
                      </div>
                      <div className="bg-muted/30 min-w-0 rounded-lg p-3">
                        <p className="text-muted-foreground mb-2 text-xs">
                          شاهد از متن صفحه
                        </p>
                        {snippets.length ? (
                          snippets.slice(0, 2).map((snippet) => (
                            <blockquote
                              key={snippet}
                              className="border-s-2 ps-3 text-sm leading-7 break-words"
                            >
                              {snippet.length > 240
                                ? `${snippet.slice(0, 240)}…`
                                : snippet}
                            </blockquote>
                          ))
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            شاهد متنی در دسترس نیست.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t pt-3">
                      {selection && fields[field] && (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            aria-label={`انتخاب ${label} برای اصلاح`}
                            checked={selection.fields.includes(field)}
                            disabled={
                              selection.disabled ||
                              (selection.fields.length >= 4 &&
                                !selection.fields.includes(field))
                            }
                            onChange={(event) =>
                              selection.toggle(field, event.target.checked)
                            }
                          />
                          اصلاح این فیلد
                        </label>
                      )}
                      <details className="w-full min-w-0 text-sm">
                        <summary>جزئیات فنی {label}</summary>
                        <ProfileRule
                          rule={
                            (version.rules as Record<string, unknown>)[field]
                          }
                        />
                        {evidence.map((item, index) => (
                          <p key={index} dir="auto" className="mt-2 break-all">
                            {item.source_locator} — {item.evidence_snippet}
                          </p>
                        ))}
                      </details>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        },
      )}
    </section>
  );
}
