import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeNumericEntry, persianDigits } from "./numeric-entry";

export const moneyFilterNames = [
  "deposit_min_toman",
  "deposit_max_toman",
  "monthly_rent_min_toman",
  "monthly_rent_max_toman",
] as const;

// Convert decimal display amounts exactly; the API always receives whole toman.
export function moneyInToman(value: string, unit: number): string | undefined {
  const normalized = normalizeNumericEntry(value).replace(/٫/g, ".");
  if (!normalized) return "";
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  const precision = unit === 1_000_000_000 ? 9 : 6;
  if (/[1-9]/.test(fraction.slice(precision))) return undefined;
  const amount = BigInt(
    whole + fraction.slice(0, precision).padEnd(precision, "0"),
  );
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? String(amount) : undefined;
}

const formatAmount = (value: string, unit: number) => {
  if (!value) return "";
  const normalized = normalizeNumericEntry(value);
  if (!/^\d+$/.test(normalized)) return value;
  const amount = BigInt(normalized);
  const divisor = BigInt(unit);
  const whole = new Intl.NumberFormat("fa-IR").format(amount / divisor);
  const fraction = String(amount % divisor)
    .padStart(unit === 1_000_000_000 ? 9 : 6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}٫${persianDigits(fraction)}` : whole;
};

export function compactToman(value: string | null) {
  if (!value) return "بدون محدودیت";
  const unit = Number(value) >= 1_000_000_000 ? 1_000_000_000 : 1_000_000;
  return `${formatAmount(value, unit)} ${unit === 1_000_000 ? "میلیون" : "میلیارد"}`;
}

function MoneyField({
  id,
  name,
  label,
  initialValue,
  deposit,
}: {
  id: string;
  name: string;
  label: string;
  initialValue: string;
  deposit: boolean;
}) {
  const [unit, setUnit] = useState(
    deposit && Number(initialValue) >= 1_000_000_000
      ? 1_000_000_000
      : 1_000_000,
  );
  const [value, setValue] = useState(() => formatAmount(initialValue, unit));
  return (
    <div className="min-w-0 space-y-2">
      <Label className="text-muted-foreground" htmlFor={id}>
        {label}
      </Label>
      <div className="border-input focus-within:ring-ring flex overflow-hidden rounded-xl border focus-within:ring-1">
        <Input
          id={id}
          name={name}
          aria-label={label}
          inputMode="decimal"
          data-money-unit={unit}
          className="min-w-0 rounded-none border-0 text-base shadow-none focus-visible:ring-0"
          placeholder="بدون محدودیت"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onBlur={() => {
            const amount = moneyInToman(value, unit);
            if (amount !== undefined) setValue(formatAmount(amount, unit));
          }}
        />
        {deposit ? (
          <Button
            type="button"
            variant="ghost"
            className="bg-muted h-11 shrink-0 gap-1.5 rounded-none border-s px-3 font-normal"
            aria-label={`تغییر واحد ${label}، ${unit === 1_000_000 ? "میلیون" : "میلیارد"} تومان`}
            onClick={() => {
              const amount = moneyInToman(value, unit);
              if (amount === undefined) return;
              const next = unit === 1_000_000 ? 1_000_000_000 : 1_000_000;
              setUnit(next);
              setValue(formatAmount(amount, next));
            }}
          >
            {unit === 1_000_000 ? "میلیون" : "میلیارد"}
            <ArrowLeftRight className="size-3.5" aria-hidden="true" />
          </Button>
        ) : (
          <span className="text-muted-foreground flex items-center px-3 text-sm">
            میلیون
          </span>
        )}
      </div>
    </div>
  );
}

export function MoneyRangeFields({
  prefix,
  searchParams,
  deposit = false,
}: {
  prefix: string;
  searchParams: URLSearchParams;
  deposit?: boolean;
}) {
  const title = deposit ? "ودیعه" : "اجاره ماهانه";
  const parameter = deposit ? "deposit" : "monthly_rent";
  return (
    <fieldset className="space-y-3 border-b pb-6">
      <legend className="mb-3 font-medium">
        {title}{" "}
        <span className="text-muted-foreground font-normal">· تومان</span>
      </legend>
      <div className="grid gap-3 min-[400px]:grid-cols-2">
        {(["min", "max"] as const).map((bound) => {
          const name = `${parameter}_${bound}_toman`;
          return (
            <MoneyField
              key={name}
              id={`${prefix}-${name}`}
              name={name}
              label={`${bound === "min" ? "حداقل" : "حداکثر"} ${title}`}
              initialValue={searchParams.get(name) ?? ""}
              deposit={deposit}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
