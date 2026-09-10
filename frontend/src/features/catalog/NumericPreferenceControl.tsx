import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeNumericEntry, persianDigits } from "./numeric-entry";
import { numericPreferences, type PreferenceId } from "./preferences";

const presets: Partial<Record<PreferenceId, readonly number[]>> = {
  area: [60, 90, 120, 150, 200],
  bedroom_count: [0, 1, 2, 3, 4, 5],
  construction_year: [1380, 1390, 1395, 1400, 1405],
  freshness: [1, 3, 7, 14, 30],
};

function choiceLabel(id: PreferenceId, value: number) {
  const number = persianDigits(String(value));
  if (id === "area") return `${number} متر`;
  if (id === "bedroom_count") return value === 0 ? "بدون اتاق" : number;
  if (id === "construction_year") return `از ${number}`;
  if (id === "freshness") return value === 1 ? "۱ روز" : `${number} روز`;
  return number;
}

export function NumericPreferenceControl({
  id,
  value,
  onChange,
}: {
  id: PreferenceId;
  value: string;
  onChange: (value: string) => void;
}) {
  const bounds = numericPreferences[id];
  if (!bounds) return null;
  const normalized = normalizeNumericEntry(value);
  const number = normalized === "" ? undefined : Number(normalized);
  const valid =
    number !== undefined &&
    Number.isSafeInteger(number) &&
    number >= bounds.min &&
    number <= bounds.max;

  return (
    <div className="space-y-3 pt-1">
      <Label htmlFor={`preference-${id}-target`}>{bounds.unit}</Label>
      {presets[id] && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={bounds.unit}
        >
          {presets[id].map((choice) => (
            <Button
              key={choice}
              type="button"
              variant={number === choice ? "default" : "outline"}
              size="sm"
              className="min-h-11 flex-1 rounded-lg px-3"
              aria-pressed={number === choice}
              onClick={() => onChange(String(choice))}
            >
              {choiceLabel(id, choice)}
            </Button>
          ))}
        </div>
      )}
      {id === "area" && (
        <div className="bg-background/70 space-y-1 rounded-xl border px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span>اندازه دلخواه</span>
            <span className="text-primary font-medium" aria-live="polite">
              {valid
                ? `حدود ${persianDigits(String(number))} متر مربع`
                : "انتخاب کنید"}
            </span>
          </div>
          <input
            type="range"
            aria-label="تنظیم متراژ دلخواه"
            aria-describedby="preference-area-hint"
            aria-valuetext={
              valid
                ? `حدود ${persianDigits(String(number))} متر مربع`
                : "انتخاب نشده"
            }
            min={1}
            max={valid ? Math.max(300, number) : 300}
            step={1}
            value={valid ? number : 90}
            onChange={(event) => onChange(event.target.value)}
            className="accent-primary focus-visible:ring-ring min-h-11 w-full cursor-pointer rounded focus-visible:ring-2"
          />
        </div>
      )}
      <Input
        id={`preference-${id}-target`}
        inputMode="numeric"
        value={persianDigits(value)}
        aria-describedby={id === "area" ? "preference-area-hint" : undefined}
        placeholder={presets[id] ? "یا مقدار دقیق را وارد کنید" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {id === "area" && (
        <p
          id="preference-area-hint"
          className="text-muted-foreground text-xs leading-5"
        >
          متراژ تقریبی دلخواه شماست؛ ملک‌های نزدیک‌تر به این اندازه امتیاز
          بیشتری می‌گیرند.
        </p>
      )}
    </div>
  );
}
