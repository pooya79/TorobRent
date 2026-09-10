import {
  Building2,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  Star,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SetURLSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { LocationMultiSelect } from "./LocationMultiSelect";
import { normalizeNumericEntry } from "./numeric-entry";
import { NumericPreferenceControl } from "./NumericPreferenceControl";
import { propertyTypeOptions } from "./property-taxonomy";
import {
  preferenceLabels,
  priorityLabels,
  numericPreferences,
  readPreferences,
  type PreferenceId,
  type Preference,
  type Preferences,
} from "./preferences";

const preferenceGroups = [
  {
    title: "بودجه دلخواه",
    description: "تعادل بین رهن و اجاره",
    icon: Wallet,
    ids: ["monthly_rent", "deposit"],
    tone: "bg-amber-50/70 dark:bg-amber-950/20",
  },
  {
    title: "ملک و محله",
    description: "نوع ملک و محدوده دلخواه",
    icon: MapPin,
    ids: ["property_type", "district", "neighborhood"],
    tone: "bg-sky-50/60 dark:bg-sky-950/20",
  },
  {
    title: "فضا و ساختمان",
    description: "اندازه و مشخصات دلخواه",
    icon: Building2,
    ids: ["area", "bedroom_count", "construction_year", "freshness"],
    tone: "bg-muted/40",
  },
  {
    title: "امکانات روزمره",
    description: "کدام امکانات برایتان مهم‌تر است؟",
    icon: Sparkles,
    ids: ["parking", "elevator", "storage", "balcony", "furnished"],
    tone: "bg-emerald-50/60 dark:bg-emerald-950/20",
  },
] as const;

export function PreferenceControls({
  searchParams,
  setSearchParams,
}: {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Preferences>({});
  const [error, setError] = useState("");
  const [locations, setLocations] = useState<Record<string, string>>({});
  const active = searchParams.get("ordering") === "preference_fit";
  const update = (id: PreferenceId, values: Partial<Preference>) =>
    setDraft((current) => ({
      ...current,
      [id]: {
        priority: "unimportant",
        target: numericPreferences[id]
          ? ""
          : id === "property_type"
            ? "apartment"
            : id === "district" || id === "neighborhood"
              ? []
              : "present",
        ...current[id],
        ...values,
      },
    }));
  const restore = (next: URLSearchParams) => {
    if (active) {
      const saved = next.get("preference_return_ordering") || "newest";
      const canonical = [
        "newest",
        "monthly_rent",
        "deposit",
        "area_asc",
        "area_desc",
        "freshness",
        "area",
      ];
      const rate = next.get("annual_return_rate");
      const validComparison =
        saved === "equivalent_monthly_cost" &&
        rate !== null &&
        /^\d+(?:\.\d{1,2})?$/.test(rate) &&
        Number(rate) <= 500;
      next.set(
        "ordering",
        canonical.includes(saved) || validComparison ? saved : "newest",
      );
    }
    next.delete("page");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const canonical: Preferences = {};
    for (const id of Object.keys(draft) as PreferenceId[]) {
      const value = draft[id]!;
      const bounds = numericPreferences[id];
      const target = bounds
        ? Number(normalizeNumericEntry(String(value.target)))
        : value.target;
      if (
        value.priority !== "unimportant" &&
        (value.target === "" ||
          (Array.isArray(value.target) && value.target.length === 0) ||
          (bounds &&
            (!Number.isSafeInteger(target) ||
              Number(target) < bounds.min ||
              Number(target) > bounds.max)))
      ) {
        setError(`مقدار معتبر برای ${preferenceLabels[id]} وارد کنید.`);
        return;
      }
      if (value.priority !== "unimportant")
        canonical[id] = { ...value, target };
    }
    if (!Object.keys(canonical).length) {
      setError("حداقل یک ترجیح را مشخص کنید.");
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (!active)
      next.set("preference_return_ordering", next.get("ordering") || "newest");
    next.set("preferences", JSON.stringify(canonical));
    for (const [kind, label] of Object.entries(locations))
      next.set(`preference_location_${kind}`, label);
    next.set("ordering", "preference_fit");
    next.delete("page");
    setSearchParams(next);
    setOpen(false);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        setDraft(readPreferences(searchParams.get("preferences")));
        setError("");
        setOpen(value);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" aria-label="ترجیحات من">
          ترجیحات من{active ? " • فعال" : ""}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        dir="rtl"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <SheetHeader className="bg-muted/30 border-b px-6 pt-7 pb-5">
          <span className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-2xl">
            <SlidersHorizontal className="size-5" aria-hidden="true" />
          </span>
          <SheetTitle>ترجیحات من</SheetTitle>
          <SheetDescription>
            فیلترها شرط قطعی هستند. ترجیحات فقط ترتیب ملک‌های واجد شرایط را
            تغییر می‌دهند؛ تناسب با خواسته‌های شما، نه کیفیت کلی ملک.
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={submit}
          className="min-h-0 flex-1 scroll-pb-32 overflow-y-auto"
        >
          <div className="space-y-6 p-5">
            {preferenceGroups.map((group) => (
              <section
                key={group.title}
                className={`rounded-2xl p-4 ${group.tone}`}
              >
                <header className="mb-4 flex items-start gap-3">
                  <group.icon
                    className="mt-1 size-5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="font-semibold">{group.title}</h3>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {group.description}
                    </p>
                  </div>
                </header>
                <div className="space-y-4">
                  {group.ids.map((id) => (
                    <fieldset
                      key={id}
                      className="border-foreground/10 space-y-2 border-t pt-3"
                    >
                      <legend className="sr-only">
                        {preferenceLabels[id]}
                      </legend>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {preferenceLabels[id]}
                        </span>
                        {draft[id]?.priority === "very_important" && (
                          <Star
                            className="size-4 fill-amber-400 text-amber-600"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={`اهمیت ${preferenceLabels[id]}`}
                        className="bg-background/80 grid grid-cols-3 gap-1 rounded-lg p-1"
                      >
                        {Object.entries(priorityLabels).map(
                          ([value, label]) => (
                            <label
                              key={value}
                              className="has-checked:bg-foreground has-checked:text-background has-focus-visible:ring-ring relative flex min-h-10 cursor-pointer items-center justify-center rounded-md px-1 text-xs has-focus-visible:ring-2"
                            >
                              <input
                                type="radio"
                                name={`preference-${id}-priority`}
                                value={value}
                                checked={
                                  (draft[id]?.priority || "unimportant") ===
                                  value
                                }
                                onChange={() =>
                                  update(id, {
                                    priority: value as Preference["priority"],
                                  })
                                }
                                className="absolute inset-0 size-full cursor-pointer opacity-0"
                              />
                              {label}
                            </label>
                          ),
                        )}
                      </div>
                      {draft[id]?.priority &&
                        draft[id]?.priority !== "unimportant" && (
                          <>
                            {numericPreferences[id] ? (
                              <NumericPreferenceControl
                                id={id}
                                value={String(draft[id]?.target ?? "")}
                                onChange={(target) => update(id, { target })}
                              />
                            ) : id === "district" || id === "neighborhood" ? (
                              <LocationMultiSelect
                                kind={id}
                                label={`${preferenceLabels[id]} دلخواه`}
                                selected={(Array.isArray(draft[id]?.target)
                                  ? draft[id].target
                                  : typeof draft[id]?.target === "string" &&
                                      draft[id]?.target !== "present"
                                    ? [draft[id].target]
                                    : []
                                ).map((areaId) => ({
                                  id: areaId,
                                  label:
                                    locations[areaId] ||
                                    searchParams.get(
                                      `preference_location_${areaId}`,
                                    ) ||
                                    "محدوده انتخاب‌شده",
                                }))}
                                onSelectionChange={(areas) => {
                                  update(id, {
                                    target: areas
                                      .slice(0, 22)
                                      .map((area) => area.id)
                                      .sort(),
                                  });
                                  setLocations((current) => ({
                                    ...current,
                                    ...Object.fromEntries(
                                      areas.map((area) => [
                                        area.id,
                                        area.label,
                                      ]),
                                    ),
                                  }));
                                }}
                              />
                            ) : (
                              <>
                                <Label htmlFor={`preference-${id}-target`}>
                                  وضعیت دلخواه {preferenceLabels[id]}
                                </Label>
                                <select
                                  id={`preference-${id}-target`}
                                  className="bg-background min-h-11 w-full rounded-md border px-2"
                                  value={String(draft[id]?.target ?? "")}
                                  onChange={(event) =>
                                    update(id, { target: event.target.value })
                                  }
                                >
                                  {(id === "property_type"
                                    ? propertyTypeOptions
                                    : [
                                        ["present", "دارد"],
                                        ["absent", "ندارد"],
                                      ]
                                  ).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                          </>
                        )}
                    </fieldset>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="bg-background/95 sticky bottom-0 flex flex-wrap gap-2 border-t p-4 backdrop-blur">
            {error && (
              <p role="alert" className="text-destructive w-full text-sm">
                {error}
              </p>
            )}
            <Button type="submit">اعمال و مرتب‌سازی ترجیحات</Button>
            {active && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  restore(next);
                  setSearchParams(next);
                  setOpen(false);
                }}
              >
                غیرفعال کردن رتبه‌بندی
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                restore(next);
                for (const key of [...next.keys()])
                  if (key === "preferences" || key.startsWith("preference_"))
                    next.delete(key);
                setSearchParams(next);
                setOpen(false);
              }}
            >
              بازنشانی ترجیحات
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
