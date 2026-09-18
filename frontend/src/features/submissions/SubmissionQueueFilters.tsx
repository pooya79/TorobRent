import { ChoiceButtons } from "@/components/ChoiceButtons";
import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

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
  const update = (patch: Partial<OperatorQueueFilters>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (
      next.pending_after &&
      next.pending_before &&
      next.pending_after > next.pending_before
    )
      return;
    if (
      next.age_days !== undefined &&
      (!Number.isInteger(next.age_days) || next.age_days < 0)
    )
      return;
    onApply({ ...next, page: 1 });
  };
  return (
    <div className="mb-5 border-y py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-3">
          <ChoiceButtons
            compact
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
            ]}
          />
        </div>
      </div>
      <div className="mt-2">
        <details className="group">
          <summary className="text-muted-foreground focus-visible:outline-ring flex w-fit cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            محدوده، تاریخ و فیلترهای بیشتر
            {activeFilterCount > 0 && (
              <span className="text-primary text-xs">
                ({activeFilterCount.toLocaleString("fa-IR")} فیلتر فعال)
              </span>
            )}
          </summary>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <ChoiceButtons
              compact
              label="مسئول بررسی"
              name="submission-assignee"
              value={draft.assignee ?? ""}
              onChange={(assignee) =>
                update({ assignee: assignee || undefined })
              }
              options={[
                ["", "همه"],
                ["unclaimed", "بدون مسئول"],
                ["mine", "در اختیار من"],
                ["other", "در اختیار دیگران"],
              ]}
            />
            <ChoiceButtons
              compact
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
    </div>
  );
}
