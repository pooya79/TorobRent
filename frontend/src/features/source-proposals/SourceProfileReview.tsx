import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { propertyTypeLabels } from "@/features/catalog/property-taxonomy";
import { errorMessage } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import {
  approveSourceProfile,
  editSourceProfile,
  repairSourceProfile,
  type OperatorSourceProposal,
} from "./queries";

import { CandidateMedia } from "./CandidateMedia";

type Version = components["schemas"]["SourceProfileVersion"];
const fields: Record<string, string> = {
  city: "شهر",
  district: "منطقه",
  neighborhood: "محله",
  property_type: "نوع ملک",
  floor_area_sqm: "متراژ",
  bedroom_count: "اتاق خواب",
  deposit_rial: "ودیعه",
  monthly_rent_rial: "اجاره ماهانه",
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
  is_negotiable: "قابل مذاکره",
  is_convertible: "قابل تبدیل",
  title: "عنوان",
  description: "توضیحات",
  source_reference: "شناسه آگهی",
  source_url: "نشانی آگهی",
  published_at: "زمان انتشار",
  availability_confirmed_at: "تأیید موجود بودن",
  latitude: "عرض جغرافیایی",
  longitude: "طول جغرافیایی",
  source_location_text: "متن موقعیت",
  image_urls: "نشانی تصاویر",
};
const coreFields = Object.keys(fields).slice(0, 8);
const selectClass = "border-input bg-background rounded-md border p-2 text-sm";
function display(value: unknown): string {
  const labels: Record<string, string> = {
    ...propertyTypeLabels,
    unknown: "نامشخص",
    present: "دارد",
    absent: "ندارد",
  };
  if (typeof value === "string") return labels[value] ?? value;
  if (typeof value === "number") return value.toLocaleString("fa-IR");
  return JSON.stringify(value) ?? "—";
}

function displayField(field: string, value: unknown): string {
  if (
    ["deposit_rial", "monthly_rent_rial"].includes(field) &&
    typeof value === "number"
  ) {
    return `${(value / 10).toLocaleString("fa-IR")} تومان`;
  }
  return display(value);
}

export function SourceProfileReview({
  proposal,
  claimed,
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  claimed: boolean;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const versions = proposal.profile_versions ?? [];
  const latest = versions[0];
  const parent = versions.find((version) => version.id === latest?.parent);
  if (!latest)
    return proposal.discovery?.evidence.profile_failure ? (
      <p role="status">{proposal.discovery.evidence.profile_failure}</p>
    ) : null;
  return (
    <section className="grid min-w-0 gap-4" aria-label="بررسی پروفایل منبع">
      <ProfileEvidence version={latest} />
      {parent && (
        <details>
          <summary>تغییر قواعد نسبت به نسخه پیشین</summary>
          {Object.keys({
            ...(parent.rules as Record<string, unknown>),
            ...(latest.rules as Record<string, unknown>),
          })
            .filter(
              (field) =>
                JSON.stringify(
                  (parent.rules as Record<string, unknown>)[field],
                ) !==
                JSON.stringify(
                  (latest.rules as Record<string, unknown>)[field],
                ),
            )
            .map((field) => (
              <div key={field}>
                <h4>{fields[field] ?? field}</h4>
                <p>پیش از اصلاح</p>
                <pre dir="ltr" className="overflow-x-auto text-xs">
                  {JSON.stringify(
                    (parent.rules as Record<string, unknown>)[field],
                    null,
                    2,
                  ) ?? "—"}
                </pre>
                <p>پس از اصلاح</p>
                <pre dir="ltr" className="overflow-x-auto text-xs">
                  {JSON.stringify(
                    (latest.rules as Record<string, unknown>)[field],
                    null,
                    2,
                  ) ?? "—"}
                </pre>
              </div>
            ))}
        </details>
      )}
      {claimed &&
        proposal.discovery_stage === "complete" &&
        latest.reservation === proposal.discovery?.id &&
        latest.status === "proposed" && (
          <ProfileEditor
            key={latest.id}
            proposal={proposal}
            version={latest}
            onUpdate={onUpdate}
          />
        )}
      {(proposal.profile_repairs ?? []).length > 0 && (
        <div className="grid gap-3" aria-label="تاریخچه اصلاح هوشمند">
          <h4 className="font-medium">تاریخچه اصلاح هوشمند</h4>
          {proposal.profile_repairs.map((repair) => (
            <div key={repair.id} className="rounded-md border p-3 text-sm">
              <p>
                {repair.selected_fields
                  .map((field: string) => fields[field] ?? field)
                  .join("، ")}
              </p>
              <p role="status">{repair.detail}</p>
              <details>
                <summary>جزئیات درخواست</summary>
                <p dir="ltr" className="break-all">
                  {repair.model} · {repair.started_at}
                </p>
                <pre dir="ltr" className="overflow-x-auto text-xs">
                  {JSON.stringify(repair, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
      {versions.length > 1 && (
        <details>
          <summary>تاریخچه نسخه‌های پروفایل</summary>
          {versions.slice(1).map((version) => (
            <ProfileEvidence key={version.id} version={version} />
          ))}
        </details>
      )}
    </section>
  );
}

function ProfileEvidence({ version }: { version: Version }) {
  return (
    <div className="grid min-w-0 gap-3">
      <h3 className="font-semibold">
        پروفایل منبع — نسخه {version.number.toLocaleString("fa-IR")}
      </h3>
      <p className="text-muted-foreground text-sm">
        {version.provenance === "llm"
          ? "اصلاح هوشمند"
          : version.provenance === "manual"
            ? "اصلاح دستی"
            : "پیشنهاد کشف"}{" "}
        · {version.created_by_label || "سامانه"}
      </p>
      {version.decision_reason && <p>{version.decision_reason}</p>}
      <p>
        {version.validation.approval_enabled
          ? "اعتبارسنجی هشت فیلد اصلی موفق بود."
          : "فیلدهای اصلی هنوز آماده تأیید نیستند."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <caption className="text-start font-medium">
            پوشش فیلدها در صفحات کنارگذاشته‌شده برای اعتبارسنجی
          </caption>
          <thead>
            <tr>
              <th className="text-start">فیلد</th>
              <th>پوشش</th>
              <th>تعارض</th>
              <th>نتیجه</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(version.validation.fields).map(
              ([field, report]) => (
                <tr key={field}>
                  <th className="py-1 text-start font-normal">
                    {fields[field] ?? field}
                    {coreFields.includes(field) ? " (اصلی)" : " (اختیاری)"}
                  </th>
                  <td className="text-center">
                    {Math.round(report.coverage * 100).toLocaleString("fa-IR")}٪
                  </td>
                  <td className="text-center">
                    {report.conflicts.toLocaleString("fa-IR")}
                  </td>
                  <td className="text-center">
                    {report.passed ? "موفق" : "نیازمند بررسی"}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <details>
        <summary>صفحات آموزش و اعتبارسنجی</summary>
        <p>آموزش</p>
        {version.validation.training_page_urls.map((url) => (
          <p className="break-all" dir="ltr" key={url}>
            {url}
          </p>
        ))}
        <p>اعتبارسنجی مستقل</p>
        {version.validation.held_out_page_urls.map((url) => (
          <p className="break-all" dir="ltr" key={url}>
            {url}
          </p>
        ))}
      </details>
      <details>
        <summary>قواعد این نسخه</summary>
        <pre dir="ltr" className="overflow-x-auto text-xs">
          {JSON.stringify(version.rules, null, 2)}
        </pre>
      </details>
      <div>
        <h4 className="font-medium">نمونه‌های استخراج و شواهد فیلدها</h4>
        {version.samples.map((sample, sampleIndex) => (
          <details key={sample.canonical_url} open={sampleIndex === 0}>
            <summary className="break-all" dir="ltr">
              {sample.canonical_url}
            </summary>
            <CandidateMedia
              images={
                version.media_candidates?.find(
                  (candidate) =>
                    candidate.external_url === sample.canonical_url,
                )?.media ?? []
              }
            />
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(sample.normalized).map(([field, value]) => (
                <div key={field}>
                  <dt className="font-medium">{fields[field] ?? field}</dt>
                  <dd className="break-words">{displayField(field, value)}</dd>
                </div>
              ))}
            </dl>
            {Object.entries(sample.conflicts).map(([field, values]) => (
              <p key={field}>
                تعارض {fields[field] ?? field}:{" "}
                {values.map((value) => displayField(field, value)).join("، ")}
              </p>
            ))}
            <details open={Object.keys(sample.conflicts).length > 0}>
              <summary>شواهد فیلدها</summary>
              {Object.entries(sample.evidence).map(([field, evidence]) => (
                <div key={field} className="my-2 text-sm">
                  <h5>{fields[field] ?? field}</h5>
                  {evidence.map((item, i) => (
                    <p key={i} className="break-words">
                      {item.evidence_snippet}{" "}
                      <span dir="ltr">({item.source_locator})</span>
                    </p>
                  ))}
                </div>
              ))}
            </details>
          </details>
        ))}
      </div>
      {Array.isArray(version.exclusions) && version.exclusions.length > 0 && (
        <div>
          <h4>ساختارهای کنارگذاشته‌شده</h4>
          {version.exclusions.map((url, i) => (
            <p key={i} className="break-all" dir="ltr">
              {display(url)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileEditor({
  proposal,
  version,
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  version: Version;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [field, setField] = useState("city");
  const [kind, setKind] = useState("css");
  const [locator, setLocator] = useState("");
  const [attribute, setAttribute] = useState("");
  const [currency, setCurrency] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<"" | "approval_required" | "automatic">("");
  const transform = [
    "floor_area_sqm",
    "bedroom_count",
    "construction_year",
    "floor",
    "total_floors",
    "units_per_floor",
  ].includes(field)
    ? "integer"
    : ["deposit_rial", "monthly_rent_rial"].includes(field)
      ? "money_rial"
      : field === "property_type"
        ? "property_type"
        : ["parking", "elevator", "storage", "balcony", "furnished"].includes(
              field,
            )
          ? "feature"
          : field === "image_urls"
            ? "url_list"
            : "text";
  const common = {
    reviewed_revision: proposal.revision,
    reviewed_profile_version: version.id,
  };
  const edit = useMutation({
    mutationFn: () => {
      const rule = {
        kind,
        transform,
        [kind === "css" ? "selector" : "path"]: locator,
        ...(kind === "css" && attribute ? { attribute } : {}),
        ...(currency ? { currency_hint: currency } : {}),
      };
      return editSourceProfile(proposal.id, {
        ...common,
        rules: { ...(version.rules as Record<string, unknown>), [field]: rule },
      });
    },
    onSuccess: onUpdate,
  });
  const approve = useMutation({
    mutationFn: () => {
      if (!mode) throw new Error("روش بررسی نتایج را انتخاب کنید.");
      return approveSourceProfile(proposal.id, {
        ...common,
        confirmed,
        review_mode: mode,
      });
    },
    onSuccess: onUpdate,
  });
  const repair = useMutation({
    mutationFn: () =>
      repairSourceProfile(proposal.id, {
        ...common,
        request_id: requestId,
        selected_fields: selectedFields,
      }),
    retry: false,
    onSuccess: (updated) => {
      setRequestId(crypto.randomUUID());
      onUpdate(updated);
    },
  });
  const busy = edit.isPending || approve.isPending || repair.isPending;
  const pendingRepair = proposal.profile_repairs?.some(
    (attempt) => attempt.parent === version.id && attempt.outcome === "pending",
  );
  return (
    <div className="grid gap-4">
      <fieldset
        disabled={busy || pendingRepair}
        className="grid gap-3 rounded-md border p-3"
      >
        <legend className="px-1 font-medium">
          اصلاح هوشمند فیلدهای انتخاب‌شده
        </legend>
        <p className="text-sm">
          یک تا چهار فیلد را انتخاب کنید. فقط شواهد محدود و بدون شماره تماس برای
          مدل ارسال می‌شود. هر اصلاح موفق نسخه تازه‌ای می‌سازد که نیازمند بررسی
          شماست.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(fields).map(([name, label]) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`اصلاح هوشمند ${label}`}
                checked={selectedFields.includes(name)}
                disabled={
                  selectedFields.length >= 4 && !selectedFields.includes(name)
                }
                onChange={(event) => {
                  setSelectedFields((current) =>
                    event.target.checked
                      ? [...current, name]
                      : current.filter((field) => field !== name),
                  );
                  setRequestId(crypto.randomUUID());
                }}
              />
              {label}
            </label>
          ))}
        </div>
        <Button
          type="button"
          disabled={!selectedFields.length || busy || pendingRepair}
          onClick={() => repair.mutate()}
        >
          {repair.isPending ? "در حال اصلاح…" : "درخواست اصلاح هوشمند"}
        </Button>
      </fieldset>
      {repair.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(
              repair.error,
              "اصلاح انجام نشد؛ پرونده را تازه کنید.",
            )}
          </AlertDescription>
        </Alert>
      )}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          edit.mutate();
        }}
      >
        <p>
          اصلاح یک فیلد، قواعد جایگزین همان فیلد را عوض می‌کند و نسخه تازه‌ای
          برای اعتبارسنجی می‌سازد.
        </p>
        <Label htmlFor={`field-${version.id}`}>فیلد مورد اصلاح</Label>
        <select
          id={`field-${version.id}`}
          className={selectClass}
          value={field}
          onChange={(event) => setField(event.target.value)}
        >
          {Object.entries(fields).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Label htmlFor={`kind-${version.id}`}>منبع مقدار</Label>
        <select
          id={`kind-${version.id}`}
          className={selectClass}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setLocator("");
          }}
        >
          <option value="css">عنصر صفحه</option>
          <option value="json">داده ساخت‌یافته JSON-LD</option>
        </select>
        <Label htmlFor={`locator-${version.id}`}>
          {kind === "css" ? "مسیر عنصر" : "مسیر داده"}
        </Label>
        <Input
          id={`locator-${version.id}`}
          dir="ltr"
          value={locator}
          maxLength={300}
          onChange={(event) => setLocator(event.target.value)}
          placeholder={kind === "css" ? ".area" : "$.floorSize.value"}
        />
        {kind === "css" && (
          <>
            <Label htmlFor={`attribute-${version.id}`}>
              ویژگی عنصر (اختیاری)
            </Label>
            <Input
              id={`attribute-${version.id}`}
              dir="ltr"
              value={attribute}
              onChange={(event) => setAttribute(event.target.value)}
              placeholder="content"
            />
          </>
        )}
        {transform === "money_rial" && (
          <>
            <Label htmlFor={`currency-${version.id}`}>واحد مبلغ</Label>
            <select
              id={`currency-${version.id}`}
              className={selectClass}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="">از متن</option>
              <option value="تومان">تومان</option>
              <option value="ریال">ریال</option>
            </select>
          </>
        )}
        <Button disabled={busy || !locator.trim()} type="submit">
          ثبت نسخه و اعتبارسنجی
        </Button>
      </form>
      <Label htmlFor={`mode-${version.id}`}>روش بررسی نتایج</Label>
      <select
        id={`mode-${version.id}`}
        className={selectClass}
        value={mode}
        onChange={(event) => setMode(event.target.value as typeof mode)}
      >
        <option value="" disabled>
          روش بررسی را انتخاب کنید
        </option>
        <option value="approval_required">نیازمند تأیید اپراتور</option>
        <option value="automatic">انتشار خودکار نتایج معتبر</option>
      </select>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم.
      </label>
      <Button
        disabled={
          busy || !mode || !confirmed || !version.validation.approval_enabled
        }
        onClick={() => approve.mutate()}
      >
        تأیید پروفایل و تخصیص منبع
      </Button>
      {(edit.error || approve.error) && (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(edit.error ?? approve.error, "ثبت پروفایل ممکن نشد.")}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
