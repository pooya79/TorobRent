import { Fragment, useId, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
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
  const [expandedFields, setExpandedFields] = useState<string[]>([]);
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
    ...Object.keys(fields),
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
              <div
                className="overflow-x-auto rounded-xl border"
                role="region"
                aria-label={`جدول ${group.title}`}
                tabIndex={0}
              >
                <table className="w-full min-w-[900px] table-fixed text-start text-sm">
                  <caption className="bg-muted/30 border-b px-4 py-3 text-start font-semibold">
                    {group.title}
                  </caption>
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      {selection && (
                        <th scope="col" className="w-16 px-3 py-3 text-start">
                          اصلاح
                        </th>
                      )}
                      <th scope="col" className="w-32 px-4 py-3 text-start">
                        فیلد
                      </th>
                      <th scope="col" className="w-32 px-4 py-3 text-start">
                        وضعیت
                      </th>
                      <th scope="col" className="w-1/4 px-4 py-3 text-start">
                        مقدار استخراج‌شده
                      </th>
                      <th scope="col" className="px-4 py-3 text-start">
                        شاهد از متن صفحه
                      </th>
                      <th scope="col" className="w-56 px-4 py-3 text-start">
                        قواعد و جزئیات
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
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
                      const expanded = expandedFields.includes(field);
                      const detailsId = `${id}-details-${field}`;
                      return (
                        <Fragment key={field}>
                          <tr
                            aria-label={label}
                            className="hover:bg-muted/30 even:bg-muted/10 align-top"
                          >
                            {selection && (
                              <td className="px-3 py-4">
                                {fields[field] && (
                                  <input
                                    type="checkbox"
                                    aria-label={`انتخاب ${label} برای اصلاح`}
                                    className="accent-primary size-4"
                                    checked={selection.fields.includes(field)}
                                    disabled={
                                      selection.disabled ||
                                      (selection.fields.length >= 4 &&
                                        !selection.fields.includes(field))
                                    }
                                    onChange={(event) =>
                                      selection.toggle(
                                        field,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                )}
                              </td>
                            )}
                            <th
                              scope="row"
                              className="px-4 py-4 text-start font-medium"
                            >
                              {label}
                            </th>
                            <td className="px-4 py-4">
                              <Badge
                                variant="outline"
                                className={
                                  conflicts.length
                                    ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                                    : missing
                                      ? "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
                                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                                }
                              >
                                {conflicts.length
                                  ? "نیازمند توجه"
                                  : missing
                                    ? "استخراج نشده"
                                    : "استخراج‌شده"}
                              </Badge>
                            </td>
                            <td className="px-4 py-4 leading-7 break-words">
                              <p dir="auto">{displayField(field, value)}</p>
                              {conflicts.length > 0 ? (
                                <p className="mt-2 text-amber-800 dark:text-amber-300">
                                  مقادیر متعارض:{" "}
                                  {conflicts
                                    .map((item) => displayField(field, item))
                                    .join("، ")}
                                </p>
                              ) : missing ? (
                                <p className="text-muted-foreground mt-2 text-xs">
                                  مقداری استخراج نشده؛ نبود اطلاعات در صفحه از
                                  این نتیجه قابل تشخیص نیست.
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-4 leading-7 break-words">
                              {snippets.length ? (
                                snippets.slice(0, 2).map((snippet) => (
                                  <blockquote
                                    key={snippet}
                                    className="border-s-2 ps-3"
                                  >
                                    {snippet.length > 240
                                      ? `${snippet.slice(0, 240)}…`
                                      : snippet}
                                  </blockquote>
                                ))
                              ) : (
                                <span className="text-muted-foreground">
                                  شاهد متنی در دسترس نیست.
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-expanded={expanded}
                                aria-controls={detailsId}
                                onClick={() =>
                                  setExpandedFields((current) =>
                                    expanded
                                      ? current.filter((name) => name !== field)
                                      : [...current, field],
                                  )
                                }
                              >
                                جزئیات فنی {label}
                                <ChevronDown
                                  aria-hidden="true"
                                  className={
                                    expanded ? "size-4 rotate-180" : "size-4"
                                  }
                                />
                              </Button>
                            </td>
                          </tr>
                          <tr
                            hidden={!expanded}
                            id={detailsId}
                            aria-label={`جزئیات ${label}`}
                          >
                            <td
                              colSpan={selection ? 6 : 5}
                              className="bg-sky-500/5 p-5"
                            >
                              {expanded && (
                                <div className="grid gap-5 lg:grid-cols-2">
                                  <section
                                    className="bg-background min-w-0 rounded-xl border p-4"
                                    aria-label={`قواعد ${label}`}
                                  >
                                    <h5 className="mb-4 font-semibold">
                                      قواعد استخراج {label}
                                    </h5>
                                    <ProfileRule
                                      rule={
                                        (
                                          version.rules as Record<
                                            string,
                                            unknown
                                          >
                                        )[field]
                                      }
                                    />
                                  </section>
                                  <section
                                    className="bg-background min-w-0 rounded-xl border p-4"
                                    aria-label={`شواهد ${label}`}
                                  >
                                    <h5 className="mb-4 font-semibold">
                                      شواهد کامل و محل استخراج
                                    </h5>
                                    {evidence.length ? (
                                      <div className="space-y-4">
                                        {evidence.map((item, index) => (
                                          <div
                                            key={index}
                                            className="space-y-2 border-b pb-4 last:border-0 last:pb-0"
                                          >
                                            <p
                                              dir="auto"
                                              className="bg-muted/50 rounded-md px-3 py-2 font-mono text-xs break-all"
                                            >
                                              {item.source_locator}
                                            </p>
                                            <blockquote
                                              dir="auto"
                                              className="border-s-2 ps-3 leading-7 break-words"
                                            >
                                              {item.evidence_snippet}
                                            </blockquote>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-muted-foreground">
                                        شاهد متنی در دسترس نیست.
                                      </p>
                                    )}
                                  </section>
                                </div>
                              )}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        },
      )}
    </section>
  );
}
