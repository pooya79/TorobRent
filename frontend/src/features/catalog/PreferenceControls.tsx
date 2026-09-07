import { useState, type FormEvent } from "react";
import type { SetURLSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { normalizeNumericEntry, persianDigits } from "./numeric-entry";
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
        className="flex w-full flex-col overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>ترجیحات من</SheetTitle>
          <SheetDescription>
            فیلترها شرط قطعی هستند. ترجیحات فقط ترتیب ملک‌های واجد شرایط را
            تغییر می‌دهند؛ تناسب با خواسته‌های شما، نه کیفیت کلی ملک.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="space-y-5 p-4">
          {(Object.keys(preferenceLabels) as PreferenceId[]).map((id) => (
            <fieldset key={id} className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 font-medium">
                {preferenceLabels[id]}
              </legend>
              <Label htmlFor={`preference-${id}-priority`}>
                اهمیت {preferenceLabels[id]}
              </Label>
              <select
                id={`preference-${id}-priority`}
                className="bg-background min-h-11 w-full rounded-md border px-2"
                value={draft[id]?.priority || "unimportant"}
                onChange={(event) =>
                  update(id, {
                    priority: event.target.value as Preference["priority"],
                  })
                }
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {draft[id]?.priority && draft[id]?.priority !== "unimportant" && (
                <>
                  {numericPreferences[id] ? (
                    <>
                      <Label htmlFor={`preference-${id}-target`}>
                        {numericPreferences[id].unit}
                      </Label>
                      <Input
                        id={`preference-${id}-target`}
                        inputMode="numeric"
                        value={persianDigits(String(draft[id]?.target ?? ""))}
                        onChange={(event) =>
                          update(id, { target: event.target.value })
                        }
                      />
                    </>
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
                          searchParams.get(`preference_location_${areaId}`) ||
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
                            areas.map((area) => [area.id, area.label]),
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
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
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
