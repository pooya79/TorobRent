import { type FormEvent, useState } from "react";
import type { SetURLSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeNumericEntry, persianDigits } from "./numeric-entry";

const validationMessage =
  "نرخ باید بین ۰ تا ۵۰۰ درصد و حداکثر دارای دو رقم اعشار باشد.";

function canonicalRate(value: string) {
  const normalized = normalizeNumericEntry(value).replaceAll("٫", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || number > 500) return null;
  return String(number);
}

export function RentalTermsComparison({
  searchParams,
  setSearchParams,
}: {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  const selectedRate = searchParams.get("annual_return_rate");
  const [draftRate, setDraftRate] = useState(() => persianDigits(selectedRate));
  const [error, setError] = useState("");

  const applyRate = (rate: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("annual_return_rate", rate);
    next.set("ordering", "equivalent_monthly_cost");
    next.delete("page");
    setSearchParams(next);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rate = canonicalRate(draftRate);
    if (rate === null) {
      setError(validationMessage);
      return;
    }
    setError("");
    applyRate(rate);
  };

  const clear = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("annual_return_rate");
    if (next.get("ordering") === "equivalent_monthly_cost") {
      next.delete("ordering");
    }
    next.delete("page");
    setSearchParams(next);
  };

  return (
    <section className="bg-muted/50 mb-3 shrink-0 rounded-xl border p-3">
      <details open={selectedRate !== null}>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          مقایسه شرایط اجاره با هزینه فرصت ودیعه
        </summary>
        <form
          className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={submit}
        >
          <div className="space-y-1">
            <Label htmlFor="annual-return-rate">فرض بازده موثر سالانه</Label>
            <div className="flex items-center gap-2">
              <Input
                id="annual-return-rate"
                inputMode="decimal"
                value={draftRate}
                aria-invalid={Boolean(error)}
                aria-describedby={
                  error ? "annual-return-rate-error" : "annual-return-rate-help"
                }
                onChange={(event) => {
                  setDraftRate(event.currentTarget.value);
                  setError("");
                }}
              />
              <span id="annual-return-rate-help" className="text-sm">
                درصد
              </span>
            </div>
            {error ? (
              <p
                id="annual-return-rate-error"
                role="alert"
                className="text-destructive text-sm"
              >
                {error}
              </p>
            ) : null}
          </div>
          <Button type="submit" className="self-end">
            محاسبه و مرتب‌سازی
          </Button>
          <Button
            type="button"
            variant="outline"
            className="self-end"
            onClick={() => applyRate("0")}
          >
            سناریوی بازده صفر
          </Button>
        </form>
        {selectedRate !== null ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>فرض فعال: بازده موثر سالانه {formatRate(selectedRate)} درصد</p>
            <Button type="button" size="sm" variant="ghost" onClick={clear}>
              پاک کردن سناریو
            </Button>
          </div>
        ) : null}
      </details>
      <p className="text-muted-foreground mt-2 text-xs leading-6">
        این برآورد، سناریوی هزینه فرصت برای ودیعه قابل بازگشت طبق شرایط آگهی
        است؛ بازده واقعی نامطمئن است و این ابزار توصیه مالی یا سرمایه‌گذاری
        نیست.
      </p>
    </section>
  );
}

function formatRate(rate: string) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(
    Number(rate),
  );
}
