import { Calculator } from "lucide-react";
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

  const applyRate = (rate: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("annual_return_rate", rate);
    next.set("ordering", "equivalent_monthly_cost");
    next.delete("page");
    setSearchParams(next);
    setOpen(false);
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
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
      >
        <DialogTitle className="pe-8">برآورد هزینه ماهانه</DialogTitle>
        <DialogDescription>
          رهن بیشتر یا اجاره بیشتر؟ با وارد کردن بازده سالانه مورد انتظار،
          هزینه ماهانه ملک‌ها را با هم مقایسه کنید.
        </DialogDescription>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="annual-return-rate">بازده سالانه مورد انتظار</Label>
            <div className="relative">
              <Input
                id="annual-return-rate"
                inputMode="decimal"
                autoComplete="off"
                placeholder="مثلا ۳۰"
                className="pe-14 tabular-nums"
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
              بازدهی که انتظار دارید در یک سال از مبلغ رهن به دست آورید. برای
              مقایسه فقط بر اساس اجاره، صفر وارد کنید.
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
          <div className="bg-muted/60 space-y-2 rounded-lg p-3 text-xs leading-6">
            <p className="font-medium">
              برآورد ماهانه = اجاره + بازده ماهانه مبلغ رهن
            </p>
            <p className="text-muted-foreground">
              این مبلغ برای مقایسه است و اجاره پرداختی شما نیست. بازده ماهانه از
              نرخ موثر سالانه محاسبه می‌شود و قطعی نیست. مبنا، رهن و اجاره یک
              آگهی فعال از هر ملک است.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              className="bg-foreground text-background hover:bg-foreground/90 flex-1"
            >
              محاسبه و مرتب‌سازی
            </Button>
            {selectedRate !== null ? (
              <Button type="button" variant="outline" onClick={clear}>
                حذف برآورد
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            نتایج از کمترین هزینه برآوردی مرتب می‌شوند.
          </p>
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
