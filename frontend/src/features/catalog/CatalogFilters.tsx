import type { FormEvent } from "react";
import { Link } from "react-router";
import type { SetURLSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeNumericEntry, persianDigits } from "./numeric-entry";

export const filterLabels = {
  deposit_min_toman: "حداقل ودیعه",
  deposit_max_toman: "حداکثر ودیعه",
  monthly_rent_min_toman: "حداقل اجاره ماهانه",
  monthly_rent_max_toman: "حداکثر اجاره ماهانه",
  area_min: "حداقل متراژ",
  area_max: "حداکثر متراژ",
  room_count: "تعداد اتاق",
  property_type: "نوع ملک",
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
} as const;

export type FilterName = keyof typeof filterLabels;

export const filterChoiceLabels = {
  apartment: "آپارتمان",
  house: "خانه",
  villa: "ویلا",
  present: "دارد",
  absent: "ندارد",
} as const;

const propertyTypeOptions = [
  ["apartment", filterChoiceLabels.apartment],
  ["house", filterChoiceLabels.house],
  ["villa", filterChoiceLabels.villa],
] as const;

const featureOptions = [
  ["present", filterChoiceLabels.present],
  ["absent", filterChoiceLabels.absent],
] as const;

const numericFilters = new Set<FilterName>([
  "deposit_min_toman",
  "deposit_max_toman",
  "monthly_rent_min_toman",
  "monthly_rent_max_toman",
  "area_min",
  "area_max",
  "room_count",
]);

const selectClassName =
  "border-input bg-background h-11 w-full rounded-md border px-3 text-sm shadow-sm";

function RangeFields({
  prefix,
  searchParams,
  minimum,
  maximum,
}: {
  prefix: string;
  searchParams: URLSearchParams;
  minimum: FilterName;
  maximum: FilterName;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[minimum, maximum].map((name) => (
        <div className="space-y-2" key={name}>
          <Label htmlFor={`${prefix}-${name}`}>{filterLabels[name]}</Label>
          <Input
            id={`${prefix}-${name}`}
            name={name}
            inputMode="numeric"
            defaultValue={persianDigits(searchParams.get(name))}
          />
        </div>
      ))}
    </div>
  );
}

function ChoiceField({
  prefix,
  searchParams,
  name,
  options,
}: {
  prefix: string;
  searchParams: URLSearchParams;
  name: FilterName | "ordering";
  options: readonly (readonly [string, string])[];
}) {
  const label = name === "ordering" ? "مرتب‌سازی" : filterLabels[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={`${prefix}-${name}`}>{label}</Label>
      <select
        className={selectClassName}
        id={`${prefix}-${name}`}
        name={name}
        defaultValue={searchParams.get(name) ?? ""}
      >
        <option value="">همه</option>
        {options.map(([value, optionLabel]) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CatalogFilters({
  prefix,
  searchParams,
  setSearchParams,
}: {
  prefix: string;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams(searchParams);
    for (const name of [...Object.keys(filterLabels), "ordering"] as (
      FilterName | "ordering"
    )[]) {
      const entry = form.get(name);
      const rawValue = typeof entry === "string" ? entry.trim() : "";
      const value = numericFilters.has(name as FilterName)
        ? normalizeNumericEntry(rawValue)
        : rawValue;
      if (value) next.set(name, value);
      else next.delete(name);
    }
    next.delete("page");
    setSearchParams(next);
  };

  return (
    <form className="space-y-5" onSubmit={applyFilters}>
      <div className="space-y-2">
        <Label>محدوده</Label>
        <p className="text-muted-foreground text-sm">
          {searchParams.get("location_label") ??
            searchParams.get("location") ??
            "تهران"}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/">تغییر محدوده</Link>
        </Button>
      </div>
      <RangeFields
        prefix={prefix}
        searchParams={searchParams}
        minimum="deposit_min_toman"
        maximum="deposit_max_toman"
      />
      <RangeFields
        prefix={prefix}
        searchParams={searchParams}
        minimum="monthly_rent_min_toman"
        maximum="monthly_rent_max_toman"
      />
      <RangeFields
        prefix={prefix}
        searchParams={searchParams}
        minimum="area_min"
        maximum="area_max"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-room_count`}>
            {filterLabels.room_count}
          </Label>
          <Input
            id={`${prefix}-room_count`}
            name="room_count"
            inputMode="numeric"
            defaultValue={persianDigits(searchParams.get("room_count"))}
          />
        </div>
        <ChoiceField
          prefix={prefix}
          searchParams={searchParams}
          name="property_type"
          options={propertyTypeOptions}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(
          ["parking", "elevator", "storage", "balcony", "furnished"] as const
        ).map((name) => (
          <ChoiceField
            key={name}
            prefix={prefix}
            searchParams={searchParams}
            name={name}
            options={featureOptions}
          />
        ))}
      </div>
      <ChoiceField
        prefix={prefix}
        searchParams={searchParams}
        name="ordering"
        options={[
          ["freshness", "تازه‌ترین"],
          ["monthly_rent", "کمترین اجاره ماهانه"],
          ["deposit", "کمترین ودیعه"],
          ["area", "کمترین متراژ"],
        ]}
      />
      <Button className="w-full" type="submit">
        اعمال فیلترها
      </Button>
    </form>
  );
}
