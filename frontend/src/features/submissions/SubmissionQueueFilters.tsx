import { ChoiceButtons } from "@/components/ChoiceButtons";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LocationMultiSelect,
  type SelectedArea,
} from "@/features/catalog/LocationMultiSelect";
import { supportedCitiesQueryOptions } from "@/features/catalog/queries";
import { PersianDateFilter } from "@/components/PersianDateFilter";
import type { OperatorQueueFilters } from "./queries";

export function SubmissionQueueFilters({
  filters,
  onApply,
}: {
  filters: OperatorQueueFilters;
  onApply: (filters: OperatorQueueFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [district, setDistrict] = useState<SelectedArea[]>([]);
  const [neighborhood, setNeighborhood] = useState<SelectedArea[]>([]);
  const cities = useQuery(supportedCitiesQueryOptions());
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) =>
      !["page", "page_size", "ordering"].includes(key) &&
      value !== undefined &&
      value !== "",
  ).length;
  const invalidRange = Boolean(
    draft.pending_after &&
    draft.pending_before &&
    draft.pending_after > draft.pending_before,
  );
  const update = (patch: Partial<OperatorQueueFilters>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  return (
    <form
      className="bg-card mb-6 rounded-2xl border shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalidRange) onApply({ ...draft, page: 1 });
      }}
    >
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <SlidersHorizontal className="text-primary size-5" aria-hidden="true" />
        <h2 className="font-semibold">فیلتر درخواست‌ها</h2>
        {activeFilterCount > 0 && (
          <span className="bg-primary/10 text-primary ms-auto rounded-full px-3 py-1 text-xs">
            {activeFilterCount.toLocaleString("fa-IR")} فیلتر فعال
          </span>
        )}
      </div>
      <div className="space-y-6 p-5">
        <ChoiceButtons
          label="وضعیت درخواست"
          name="submission-state"
          value={draft.state ?? ""}
          onChange={(state) => update({ state: state || undefined })}
          options={[
            ["", "همه"],
            ["pending", "در انتظار بررسی"],
            ["changes_requested", "نیازمند اصلاح"],
            ["published", "منتشرشده"],
            ["rejected", "ردشده"],
            ["draft", "پیش‌نویس"],
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1fr_auto]">
          <ChoiceButtons
            label="مسئول بررسی"
            name="submission-assignee"
            value={draft.assignee ?? ""}
            onChange={(assignee) => update({ assignee: assignee || undefined })}
            options={[
              ["", "همه"],
              ["unclaimed", "بدون مسئول"],
              ["mine", "در اختیار من"],
              ["other", "در اختیار دیگران"],
            ]}
          />
          <ChoiceButtons
            label="ترتیب نمایش"
            name="submission-order"
            value={draft.ordering ?? "oldest"}
            onChange={(ordering) =>
              update({ ordering: ordering as "oldest" | "newest" })
            }
            options={[
              ["oldest", "قدیمی‌ترین"],
              ["newest", "تازه‌ترین"],
            ]}
          />
        </div>
        <details className="border-t pt-4">
          <summary className="focus-visible:outline-ring cursor-pointer rounded-md py-2 text-sm font-medium">
            محدوده، تاریخ و فیلترهای بیشتر
          </summary>
          <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="queue-city">شهر</Label>
              <Select
                dir="rtl"
                value={draft.city ?? "all"}
                onValueChange={(city) => {
                  update({
                    city: city === "all" ? undefined : city,
                    district: undefined,
                    neighborhood: undefined,
                  });
                  setDistrict([]);
                  setNeighborhood([]);
                }}
              >
                <SelectTrigger id="queue-city" className="rounded-xl">
                  <SelectValue placeholder="همه شهرها" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه شهرها</SelectItem>
                  {cities.data?.map((city) => (
                    <SelectItem key={city.id} value={city.id}>
                      {city.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cities.isError && (
                <p className="text-destructive text-xs" role="alert">
                  دریافت شهرها ممکن نشد.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">منطقه</p>
              <LocationMultiSelect
                kind="district"
                label="منطقه"
                selected={district}
                onSelectionChange={(areas) => {
                  const next = areas.slice(-1);
                  setDistrict(next);
                  update({ district: next[0]?.id });
                }}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">محله</p>
              <LocationMultiSelect
                kind="neighborhood"
                label="محله"
                selected={neighborhood}
                onSelectionChange={(areas) => {
                  const next = areas.slice(-1);
                  setNeighborhood(next);
                  update({ neighborhood: next[0]?.id });
                }}
              />
            </div>
            <PersianDateFilter
              label="ورود به صف از تاریخ"
              value={draft.pending_after}
              boundary="start"
              onChange={(pending_after) => update({ pending_after })}
            />
            <PersianDateFilter
              label="ورود به صف تا تاریخ"
              value={draft.pending_before}
              boundary="end"
              onChange={(pending_before) => update({ pending_before })}
            />
            <div className="space-y-2">
              <Label htmlFor="queue-age">حداقل زمان انتظار (روز)</Label>
              <Input
                id="queue-age"
                className="rounded-xl"
                type="number"
                min={0}
                step={1}
                placeholder="بدون محدودیت"
                value={draft.age_days ?? ""}
                onChange={(event) =>
                  update({
                    age_days: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="queue-source">شناسه منبع (اختیاری)</Label>
              <Input
                id="queue-source"
                className="rounded-xl"
                dir="ltr"
                placeholder="شناسه منبع را وارد کنید"
                value={draft.source ?? ""}
                onChange={(event) =>
                  update({ source: event.target.value.trim() || undefined })
                }
              />
            </div>
          </div>
        </details>
        {invalidRange && (
          <p role="alert" className="text-destructive text-sm">
            تاریخ پایان باید برابر یا بعد از تاریخ شروع باشد.
          </p>
        )}
      </div>
      <div className="bg-muted/30 flex flex-wrap items-center gap-3 rounded-b-2xl border-t px-5 py-4">
        <Button type="submit" className="rounded-xl" disabled={invalidRange}>
          اعمال فیلترها
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="rounded-xl"
          onClick={() => {
            const cleared = { ordering: "oldest" as const };
            setDraft(cleared);
            setDistrict([]);
            setNeighborhood([]);
            onApply(cleared);
          }}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          پاک کردن فیلترها
        </Button>
        <p className="text-muted-foreground text-xs sm:ms-auto">
          پس از انتخاب، فیلترها را اعمال کنید.
        </p>
      </div>
    </form>
  );
}
