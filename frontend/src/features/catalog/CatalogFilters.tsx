import type { FormEvent } from "react";

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
  "ordering",
] as const;

function paramsFromForm(form: HTMLFormElement, current: URLSearchParams) {
  const data = new FormData(form);
  const next = new URLSearchParams(current);
  for (const name of formFilterNames) {
    const entry = data.get(name);
    const rawValue = typeof entry === "string" ? entry.trim() : "";
    const value = numericFilters.has(name as FilterName)
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
  bounded,
  grouped = false,
}: {
  prefix: string;
  searchParams: URLSearchParams;
  minimum: FilterName;
  maximum: FilterName;
  unit: string;
  bounded?: { min: number; max: number; step: number };
  grouped?: boolean;
}) {
  const syncSlider = (
    name: FilterName,
    value: string,
    form: HTMLFormElement | null,
  ) => {
    const field = form?.elements.namedItem(name);
    if (field instanceof HTMLInputElement) {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
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
              defaultValue={
                grouped && searchParams.get(name)
                  ? new Intl.NumberFormat("fa-IR").format(
                      Number(
                        normalizeNumericEntry(searchParams.get(name) ?? ""),
                      ),
                    )
                  : persianDigits(searchParams.get(name))
              }
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
            {bounded && (
              <input
                className="accent-primary w-full"
                type="range"
                aria-label={`${filterLabels[name]}، کنترل بازه`}
                min={bounded.min}
                max={bounded.max}
                step={bounded.step}
                defaultValue={
                  normalizeNumericEntry(searchParams.get(name) ?? "") ||
                  (name === minimum ? bounded.min : bounded.max)
                }
                onChange={(event) =>
                  syncSlider(
                    name,
                    event.currentTarget.value,
                    event.currentTarget.form,
                  )
                }
              />
            )}
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
}: {
  name: string;
  label: string;
  value: string;
  choices: readonly { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1">
        {choices.map((choice) => (
          <label
            key={choice.value || "any"}
            className="has-checked:bg-background has-focus-visible:ring-ring flex min-h-10 cursor-pointer items-center justify-center rounded-md px-2 text-center text-xs has-focus-visible:ring-2 has-disabled:cursor-not-allowed has-disabled:opacity-50"
          >
            <input
              className="sr-only"
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
      onInput={(event) =>
        onDraftChange(paramsFromForm(event.currentTarget, searchParams))
      }
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="flex-1 space-y-6 overflow-y-auto px-1 pb-28">
        <fieldset className="space-y-3">
          <legend className="font-medium">محدوده‌های تهران</legend>
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

        <RangeFields
          prefix={prefix}
          searchParams={searchParams}
          minimum="deposit_min_toman"
          maximum="deposit_max_toman"
          unit="ودیعه (تومان)"
          grouped
        />
        <RangeFields
          prefix={prefix}
          searchParams={searchParams}
          minimum="monthly_rent_min_toman"
          maximum="monthly_rent_max_toman"
          unit="اجاره ماهانه (تومان)"
          grouped
        />
        <RangeFields
          prefix={prefix}
          searchParams={searchParams}
          minimum="area_min"
          maximum="area_max"
          unit="متراژ (متر مربع)"
          bounded={{ min: 20, max: 1000, step: 5 }}
        />
        <RangeFields
          prefix={prefix}
          searchParams={searchParams}
          minimum="construction_year_min"
          maximum="construction_year_max"
          unit="سال ساخت"
          bounded={{ min: 1200, max: 1500, step: 1 }}
        />

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

        <div className="space-y-2">
          <Label htmlFor={`${prefix}-ordering`}>مرتب‌سازی</Label>
          <select
            id={`${prefix}-ordering`}
            name="ordering"
            className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm shadow-sm"
            defaultValue={
              searchParams.get("ordering") === "newest" ||
              searchParams.get("ordering") === "freshness"
                ? ""
                : (searchParams.get("ordering") ?? "")
            }
          >
            <option value="">جدیدترین</option>
            <option value="monthly_rent">کمترین اجاره ماهانه</option>
            <option value="deposit">کمترین ودیعه</option>
            <option value="area_desc">بیشترین متراژ</option>
            <option value="area_asc">کمترین متراژ</option>
          </select>
        </div>
      </div>

      <div className="bg-background sticky bottom-0 -mx-1 mt-auto grid grid-cols-2 gap-2 border-t px-1 pt-4">
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
