import { Banknote, Bitcoin, Calculator, Check, Coins } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { type FormEvent, useState } from "react";
import type { SetURLSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeNumericEntry, persianDigits } from "./numeric-entry";

const validationMessage =
  "نرخ باید بین ۰ تا ۵۰۰ درصد و حداکثر دارای دو رقم اعشار باشد.";

// Fixed historical snapshot; endpoints and calculations are documented in
// docs/research/rental-estimate-market-reference.md. Refresh dates and values together.
const marketReferences = [
  {
    label: "طلای ۱۸ عیار",
    icon: Coins,
    iconClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    rate: "175",
    sources: [
      {
        label: "تاریخچه طلا",
        url: "https://www.tgju.org/profile/geram18/history",
      },
    ],
  },
  {
    label: "دلار آزاد",
    icon: Banknote,
    iconClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    rate: "131",
    sources: [
      {
        label: "تاریخچه دلار",
        url: "https://www.tgju.org/profile/price_dollar_rl/history",
      },
    ],
  },
  {
    label: "بیت‌کوین",
    icon: Bitcoin,
    iconClass: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    rate: "64",
    sources: [
      { label: "قیمت آغاز دوره", url: "https://www.tgju.org/news/3530773" },
      { label: "قیمت پایان دوره", url: "https://gem.tgju.org/news/3882905" },
    ],
  },
];

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
  const [open, setOpen] = useState(false);

  const applyRate = (rate: string, sort: boolean) => {
    const next = new URLSearchParams(searchParams);
    next.set("annual_return_rate", rate);
    if (sort) {
      next.set("ordering", "equivalent_monthly_cost");
    }
    if (sort || next.get("ordering") === "equivalent_monthly_cost") {
      next.delete("page");
    }
    setSearchParams(next);
    setOpen(false);
  };

  const validateAndApply = (sort: boolean) => {
    const rate = canonicalRate(draftRate);
    if (rate === null) {
      setError(validationMessage);
      return;
    }
    setError("");
    applyRate(rate, sort);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    validateAndApply(false);
  };

  const clear = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("annual_return_rate");
    if (next.get("ordering") === "equivalent_monthly_cost") {
      next.delete("ordering");
    }
    next.delete("page");
    setSearchParams(next);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setDraftRate(persianDigits(selectedRate));
        setError("");
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={`px-2 sm:px-4 ${selectedRate !== null ? "bg-muted" : ""}`}
        >
          <Calculator className="hidden sm:block" aria-hidden="true" />
          برآورد هزینه
          {selectedRate !== null ? (
            <span className="bg-foreground/10 rounded px-1.5 py-0.5 text-xs tabular-nums">
              {formatRate(selectedRate)}٪
              <span className="sr-only"> بازده سالانه، فعال</span>
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent
        dir="rtl"
        className="max-h-[calc(100dvh-2rem)] max-w-xl gap-4 overflow-y-auto p-5 sm:p-6"
      >
        <div className="flex items-center gap-3 pe-6">
          <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <Calculator className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <DialogTitle>برآورد هزینه ماهانه</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              رهن و اجاره را با یک معیار مقایسه کنید.
            </DialogDescription>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="annual-return-rate">بازده سالانه مورد انتظار</Label>
            <div className="relative">
              <Input
                id="annual-return-rate"
                inputMode="decimal"
                autoComplete="off"
                placeholder="مثلا ۳۰"
                className="h-14 rounded-xl pe-14 text-xl font-medium tabular-nums md:text-xl"
                value={draftRate}
                aria-invalid={Boolean(error)}
                aria-describedby={
                  error
                    ? "annual-return-rate-help annual-return-rate-error"
                    : "annual-return-rate-help"
                }
                onChange={(event) => {
                  setDraftRate(event.currentTarget.value);
                  setError("");
                }}
              />
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm">
                درصد
              </span>
            </div>
            <p
              id="annual-return-rate-help"
              className="text-muted-foreground text-xs leading-6"
            >
              اگر پول رهن را سرمایه‌گذاری می‌کردید، در یک سال چقدر رشد می‌کرد؟
            </p>
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
          <section
            aria-labelledby="market-reference-heading"
            className="space-y-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <h3 id="market-reference-heading" className="text-sm font-medium">
                از بازار ایده بگیرید
              </h3>
              <span className="text-muted-foreground text-xs">
                برای انتخاب نرخ، لمس کنید
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {marketReferences.map((reference) => {
                const active = canonicalRate(draftRate) === reference.rate;
                const Icon = reference.icon;
                return (
                  <button
                    key={reference.label}
                    type="button"
                    aria-label={`استفاده از نرخ ${reference.label}، ${formatRate(reference.rate)} درصد`}
                    aria-pressed={active}
                    className={`focus-visible:ring-ring relative flex min-w-0 flex-col items-center gap-2 rounded-2xl border px-1 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none sm:px-3 ${active ? "border-foreground bg-muted" : "border-border hover:border-foreground/40 hover:bg-muted/50"}`}
                    onClick={() => {
                      setDraftRate(persianDigits(reference.rate));
                      setError("");
                    }}
                  >
                    {active ? (
                      <Check
                        className="absolute start-2 top-2 size-3.5"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className={`flex size-10 items-center justify-center rounded-full sm:size-12 ${reference.iconClass}`}
                    >
                      <Icon className="size-5 sm:size-6" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-medium sm:text-sm">
                      {reference.label}
                    </span>
                    <span
                      className="text-xl font-semibold tabular-nums sm:text-2xl"
                      dir="ltr"
                    >
                      +{formatRate(reference.rate)}٪
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      رشد تقریبی سالانه
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="text-muted-foreground space-y-1 text-[11px] leading-5">
              <p>به تومان · ۱۸ شهریور ۱۴۰۴ تا ۱۸ شهریور ۱۴۰۵</p>
              <p>بازده گذشته، تضمین آینده نیست.</p>
              <div className="flex flex-wrap items-center gap-x-2">
                <span>منبع: TGJU</span>
                {marketReferences.flatMap((reference) =>
                  reference.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="decoration-border hover:text-foreground underline underline-offset-4"
                    >
                      {reference.label === "بیت‌کوین"
                        ? `بیت‌کوین: ${source.label === "قیمت آغاز دوره" ? "آغاز" : "پایان"}`
                        : reference.label}
                    </a>
                  )),
                )}
              </div>
            </div>
          </section>
          <div className="bg-muted/60 space-y-1 rounded-xl px-3 py-2.5 text-xs leading-6">
            <p className="font-medium">
              برآورد ماهانه = اجاره + بازده ماهانه پول رهن
            </p>
            <p className="text-muted-foreground">
              برای مقایسه است؛ اجاره پرداختی شما نیست.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              className="bg-foreground text-background hover:bg-foreground/90 flex-1 rounded-xl"
            >
              فقط اعمال برآورد
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl"
              onClick={() => validateAndApply(true)}
            >
              محاسبه و مرتب‌سازی
            </Button>
            {selectedRate !== null ? (
              <Button type="button" variant="ghost" onClick={clear}>
                حذف برآورد
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatRate(rate: string) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(
    Number(rate),
  );
}
