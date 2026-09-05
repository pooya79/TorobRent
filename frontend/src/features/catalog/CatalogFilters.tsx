import type { FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MoneyRangeFields,
  moneyFilterNames,
  moneyInToman,
  compactToman,
} from "./MoneyRangeFields";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BEDROOM_COUNT_PARAMETER,
  bedroomCountQuickFilterLabels,
  LEGACY_BEDROOM_COUNT_PARAMETER,
} from "./bedroom-filter";
import type { CatalogFacetData } from "./facets";
import { LocationMultiSelect, type SelectedArea } from "./LocationMultiSelect";
import { normalizeNumericEntry, persianDigits } from "./numeric-entry";
import { propertyTypeLabels } from "./property-taxonomy";
import { selectedPropertyCategory } from "./property-type-selection";

export const filterLabels = {
  district: "منطقه",
  neighborhood: "محله",
  deposit_min_toman: "حداقل ودیعه",
  deposit_max_toman: "حداکثر ودیعه",
  monthly_rent_min_toman: "حداقل اجاره ماهانه",
  monthly_rent_max_toman: "حداکثر اجاره ماهانه",
  area_min: "حداقل متراژ",
  area_max: "حداکثر متراژ",
  construction_year_min: "حداقل سال ساخت",
  construction_year_max: "حداکثر سال ساخت",
  bedroom_count: "تعداد اتاق خواب",
  room_count: "تعداد اتاق خواب",
  property_type: "نوع ملک",
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
} as const;

export type FilterName = keyof typeof filterLabels;

export const filterChoiceLabels = {
  ...propertyTypeLabels,
  present: "ضروری",
  absent: "نباشد",
  ...bedroomCountQuickFilterLabels,
} as const;

const numericFilters = new Set<FilterName>([
  "deposit_min_toman",
  "deposit_max_toman",
  "monthly_rent_min_toman",
  "monthly_rent_max_toman",
  "area_min",
  "area_max",
  "construction_year_min",
  "construction_year_max",
  "bedroom_count",
]);

const formFilterNames = [
  "deposit_min_toman",
  "deposit_max_toman",
  "monthly_rent_min_toman",
  "monthly_rent_max_toman",
  "area_min",
  "area_max",
  "construction_year_min",
  "construction_year_max",
  "bedroom_count",
  "parking",
  "elevator",
  "storage",
  "balcony",
  "furnished",
] as const;

function paramsFromForm(form: HTMLFormElement, current: URLSearchParams) {
  const data = new FormData(form);
  const next = new URLSearchParams(current);
  for (const name of formFilterNames) {
    const entry = data.get(name);
    const rawValue = typeof entry === "string" ? entry.trim() : "";
    const field = form.elements.namedItem(name);
    const value =
      field instanceof HTMLInputElement && field.dataset.moneyUnit
        ? moneyInToman(rawValue, Number(field.dataset.moneyUnit))
        : numericFilters.has(name)
          ? normalizeNumericEntry(rawValue)
          : rawValue;
    if (value) next.set(name, value);
    else next.delete(name);
  }
  next.delete(LEGACY_BEDROOM_COUNT_PARAMETER);
  next.delete("page");
  return next;
}

function RangeFields({
  prefix,
  searchParams,
  minimum,
  maximum,
  unit,
}: {
  prefix: string;
  searchParams: URLSearchParams;
  minimum: FilterName;
  maximum: FilterName;
  unit: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">{unit}</legend>
      <div className="grid grid-cols-2 gap-3">
        {[minimum, maximum].map((name) => (
          <div className="space-y-2" key={name}>
            <Label htmlFor={`${prefix}-${name}`}>{filterLabels[name]}</Label>
            <Input
              id={`${prefix}-${name}`}
              name={name}
              inputMode="numeric"
              defaultValue={persianDigits(searchParams.get(name))}
              placeholder="بدون محدودیت"
              onBlur={(event) => {
                const value = Number(
                  normalizeNumericEntry(event.currentTarget.value),
                );
                if (
                  Number.isFinite(value) &&
                  event.currentTarget.value.trim()
                ) {
                  event.currentTarget.value = new Intl.NumberFormat(
                    "fa-IR",
                  ).format(value);
                }
              }}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function SegmentedChoices({
  name,
  label,
  value,
  choices,
  inline = false,
}: {
  name: string;
  label: string;
  value: string;
  inline?: boolean;
  choices: readonly { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <fieldset
      className={cn(
        "space-y-2",
        inline &&
          "min-[440px]:flex min-[440px]:items-center min-[440px]:justify-between min-[440px]:gap-3 min-[440px]:space-y-0",
      )}
    >
      <legend
        className={cn(
          "text-sm font-medium",
          inline && "min-[440px]:float-start",
        )}
      >
        {label}
      </legend>
      <div
        className={cn(
          "flex gap-1 rounded-xl",
          inline ? "bg-muted p-1" : "flex-wrap",
        )}
      >
        {choices.map((choice) => (
          <label
            key={choice.value || "any"}
            className={cn(
              "has-checked:text-primary has-focus-visible:ring-ring flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-center text-sm whitespace-nowrap has-focus-visible:ring-2 has-disabled:cursor-not-allowed has-disabled:opacity-50",
              inline
                ? "has-checked:bg-background has-checked:border-border border-transparent"
                : "has-checked:border-primary has-checked:bg-primary/5",
            )}
          >
            <input
              className="accent-primary size-3 shrink-0"
              type="radio"
              name={name}
              value={choice.value}
              defaultChecked={value === choice.value}
              disabled={choice.disabled}
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function selectedAreas(
  searchParams: URLSearchParams,
  name: "district" | "neighborhood",
) {
  const labels = searchParams.getAll(`${name}_label`);
  return searchParams.getAll(name).map((id, index) => ({
    id,
    label: labels[index] ?? id,
  }));
}

export function CatalogFilters({
  prefix,
  searchParams,
  facets,
  onDraftChange,
  onApply,
  onCancel,
  onClear,
  previewCount,
  previewPending,
  previewError,
}: {
  prefix: string;
  searchParams: URLSearchParams;
  facets?: CatalogFacetData;
  onDraftChange: (next: URLSearchParams) => void;
  onApply: () => void;
  onCancel: () => void;
  onClear: () => void;
  previewCount?: number;
  previewPending: boolean;
  previewError: boolean;
}) {
  const propertyCategory = selectedPropertyCategory(searchParams);
  const updateAreas = (
    name: "district" | "neighborhood",
    areas: SelectedArea[],
  ) => {
    const next = new URLSearchParams(searchParams);
    next.delete(name);
    next.delete(`${name}_label`);
    for (const area of areas) {
      next.append(name, area.id);
      next.append(`${name}_label`, area.label);
    }
    next.delete("page");
    onDraftChange(next);
  };
  const featureNames = [
    "parking",
    "elevator",
    "storage",
    "balcony",
    "furnished",
  ] as const;

  return (
    <form
      className="flex min-h-full flex-col"
      onInput={(event) => {
        const form = event.currentTarget;
        for (const name of moneyFilterNames) {
          const field = form.elements.namedItem(name);
          if (field instanceof HTMLInputElement) {
            field.setCustomValidity(
              moneyInToman(field.value, Number(field.dataset.moneyUnit)) ===
                undefined
                ? "مبلغ معتبر و غیرمنفی وارد کنید."
                : "",
            );
          }
        }
        for (const parameter of ["deposit", "monthly_rent"]) {
          const min = form.elements.namedItem(`${parameter}_min_toman`);
          const max = form.elements.namedItem(`${parameter}_max_toman`);
          if (
            min instanceof HTMLInputElement &&
            max instanceof HTMLInputElement
          ) {
            const minimum = moneyInToman(
              min.value,
              Number(min.dataset.moneyUnit),
            );
            const maximum = moneyInToman(
              max.value,
              Number(max.dataset.moneyUnit),
            );
            if (minimum && maximum && Number(minimum) > Number(maximum))
              max.setCustomValidity("حداکثر مبلغ نباید کمتر از حداقل باشد.");
          }
        }
        if (form.checkValidity())
          onDraftChange(paramsFromForm(form, searchParams));
      }}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="flex-1 space-y-6 overflow-y-auto px-1 pb-28">
        <details
          className="group border-b pb-6"
          open={
            searchParams.has("district") || searchParams.has("neighborhood")
          }
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium">
            محله‌ها و مناطق
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-end text-sm font-normal">
              {[
                ...selectedAreas(searchParams, "district"),
                ...selectedAreas(searchParams, "neighborhood"),
              ]
                .map((area) => area.label)
                .join("، ") || "همه محدوده‌ها"}
            </span>
            <ChevronDown
              className="size-4 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <fieldset className="mt-3 space-y-3">
            <legend className="sr-only">محدوده‌های تهران</legend>
            <p className="text-muted-foreground text-sm">
              منطقه و محله مستقل از شهر انتخاب می‌شوند.
            </p>
            <LocationMultiSelect
              kind="district"
              label="منطقه"
              selected={selectedAreas(searchParams, "district")}
              onSelectionChange={(areas) => updateAreas("district", areas)}
            />
            <LocationMultiSelect
              kind="neighborhood"
              label="محله"
              selected={selectedAreas(searchParams, "neighborhood")}
              onSelectionChange={(areas) => updateAreas("neighborhood", areas)}
            />
          </fieldset>
        </details>
        <MoneyRangeFields prefix={prefix} searchParams={searchParams} deposit />
        <MoneyRangeFields prefix={prefix} searchParams={searchParams} />

        {propertyCategory === "residential" && (
          <SegmentedChoices
            name={BEDROOM_COUNT_PARAMETER}
            label={filterLabels.bedroom_count}
            value={
              searchParams.get(BEDROOM_COUNT_PARAMETER) ??
              searchParams.get(LEGACY_BEDROOM_COUNT_PARAMETER) ??
              ""
            }
            choices={[
              { value: "", label: "همه" },
              ...(["1", "2", "3_plus"] as const).map((value) => ({
                value,
                label: bedroomCountQuickFilterLabels[value],
                disabled:
                  searchParams.get(BEDROOM_COUNT_PARAMETER) !== value &&
                  facets?.bedroom_counts.find((item) => item.value === value)
                    ?.count === 0,
              })),
            ]}
          />
        )}

        <fieldset className="space-y-4">
          <legend className="font-medium">ویژگی‌های ملک</legend>
          {featureNames.map((name) => {
            const counts = facets?.features[name];
            const selected = searchParams.get(name) ?? "";
            return (
              <SegmentedChoices
                key={name}
                inline
                name={name}
                label={filterLabels[name]}
                value={selected}
                choices={[
                  { value: "", label: "مهم نیست" },
                  {
                    value: "present",
                    label: "ضروری",
                    disabled: selected !== "present" && counts?.present === 0,
                  },
                  {
                    value: "absent",
                    label: "نباشد",
                    disabled: selected !== "absent" && counts?.absent === 0,
                  },
                ]}
              />
            );
          })}
          <p className="text-muted-foreground text-xs">
            «نباشد» فقط ویژگی‌های صراحتاً ثبت‌شده به‌عنوان غایب را برمی‌گرداند؛
            وضعیت نامشخص، غایب محسوب نمی‌شود.
          </p>
        </fieldset>

        <details
          className="group border-y py-4"
          open={
            searchParams.has("area_min") ||
            searchParams.has("area_max") ||
            searchParams.has("construction_year_min") ||
            searchParams.has("construction_year_max")
          }
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium">
            متراژ و سال ساخت{" "}
            <ChevronDown
              className="size-4 group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="mt-4 space-y-5">
            <RangeFields
              prefix={prefix}
              searchParams={searchParams}
              minimum="area_min"
              maximum="area_max"
              unit="متراژ (متر مربع)"
            />
            <RangeFields
              prefix={prefix}
              searchParams={searchParams}
              minimum="construction_year_min"
              maximum="construction_year_max"
              unit="سال ساخت"
            />
          </div>
        </details>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-ordering`}>مرتب‌سازی</Label>
          <Select
            dir="rtl"
            value={
              !["", "newest", "freshness"].includes(
                searchParams.get("ordering") ?? "",
              )
                ? searchParams.get("ordering")!
                : "newest"
            }
            onValueChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value === "newest") next.delete("ordering");
              else next.set("ordering", value);
              next.delete("page");
              onDraftChange(next);
            }}
          >
            <SelectTrigger id={`${prefix}-ordering`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">جدیدترین</SelectItem>
              <SelectItem value="monthly_rent">کمترین اجاره ماهانه</SelectItem>
              <SelectItem value="deposit">کمترین ودیعه</SelectItem>
              <SelectItem value="area_desc">بیشترین متراژ</SelectItem>
              <SelectItem value="area_asc">کمترین متراژ</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-background sticky bottom-0 -mx-1 mt-auto grid grid-cols-2 gap-2 border-t px-1 pt-4">
        <div className="text-muted-foreground col-span-2 mb-2 text-sm leading-6">
          {(["deposit", "monthly_rent"] as const).map((parameter) => {
            const minimum = searchParams.get(`${parameter}_min_toman`);
            const maximum = searchParams.get(`${parameter}_max_toman`);
            return (
              <p key={parameter}>
                {parameter === "deposit" ? "ودیعه" : "اجاره ماهانه"}:{" "}
                {minimum ? `از ${compactToman(minimum)} ` : ""}
                {maximum ? `تا ${compactToman(maximum)} ` : ""}
                {minimum || maximum ? "تومان" : "بدون محدودیت"}
              </p>
            );
          })}
        </div>
        <Button type="button" variant="ghost" onClick={onClear}>
          پاک کردن همه
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          انصراف
        </Button>
        <Button
          className="col-span-2"
          type="submit"
          disabled={previewPending || previewError}
        >
          {previewPending
            ? "در حال شمارش ملک‌ها…"
            : previewError
              ? "شمارش ملک‌ها ممکن نشد"
              : `نمایش ${new Intl.NumberFormat("fa-IR").format(previewCount ?? 0)} ملک`}
        </Button>
        <p
          className="sr-only"
          role={previewError ? "alert" : "status"}
          aria-live="polite"
        >
          {previewPending
            ? "در حال به‌روزرسانی تعداد ملک‌ها"
            : previewError
              ? "به‌روزرسانی تعداد ملک‌ها ممکن نشد"
              : `${new Intl.NumberFormat("fa-IR").format(previewCount ?? 0)} ملک مطابق فیلترهای انتخابی است`}
        </p>
      </div>
    </form>
  );
}
