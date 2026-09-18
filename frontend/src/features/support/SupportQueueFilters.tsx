import { Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { ChoiceButtons } from "@/components/ChoiceButtons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supportClassificationLabels } from "./labels";
import type {
  AssigneeFacet,
  IntakeKind,
  SupportClassification,
  SupportQueueFilters,
  SupportRequestStatus,
} from "./queries";

export function SupportQueueFilterPanel({
  filters,
  onApply,
}: {
  filters: SupportQueueFilters;
  onApply: (filters: SupportQueueFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const update = (patch: Partial<SupportQueueFilters>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (
      next.age_days !== undefined &&
      (!Number.isInteger(next.age_days) || next.age_days < 0)
    )
      return;
    onApply({ ...next, search: next.search?.trim() || undefined, page: 1 });
  };
  const count = Object.entries(filters).filter(
    ([key, value]) =>
      !["page", "page_size", "ordering"].includes(key) &&
      value !== undefined &&
      value !== "",
  ).length;
  return (
    <div className="mb-5 border-y py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-3">
          <div className="max-w-sm space-y-2">
            <Label className="sr-only" htmlFor="support-search">
              جست‌وجوی درخواست
            </Label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute start-3 top-3.5 size-4"
                aria-hidden="true"
              />
              <Input
                id="support-search"
                className="rounded-xl ps-10"
                type="search"
                placeholder="عبارت مورد نظر را جست‌وجو کنید"
                value={draft.search ?? ""}
                onChange={(event) => update({ search: event.target.value })}
              />
            </div>
          </div>
          <ChoiceButtons
            compact
            label="وضعیت درخواست"
            name="support-status"
            value={draft.status ?? ""}
            options={[
              ["", "همه"],
              ["open", "باز"],
              ["in_progress", "در حال رسیدگی"],
              ["escalated", "ارجاع‌شده"],
              ["resolved", "رسیدگی‌شده"],
            ]}
            onChange={(value) =>
              update({
                status: value ? (value as SupportRequestStatus) : undefined,
              })
            }
          />
        </div>
      </div>
      <div className="mt-2">
        <details className="group">
          <summary className="text-muted-foreground focus-visible:outline-ring flex w-fit cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            نوع درخواست، دسته‌بندی و ترتیب نمایش
            {count > 0 && (
              <span className="text-primary text-xs">
                ({count.toLocaleString("fa-IR")} فیلتر فعال)
              </span>
            )}
          </summary>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <ChoiceButtons
              compact
              label="مسئول رسیدگی"
              name="support-assignee"
              value={draft.assignee ?? ""}
              options={[
                ["", "همه"],
                ["unassigned", "بدون مسئول"],
                ["mine", "در اختیار من"],
                ["other", "در اختیار دیگران"],
              ]}
              onChange={(value) =>
                update({
                  assignee: value ? (value as AssigneeFacet) : undefined,
                })
              }
            />
            <ChoiceButtons
              compact
              label="اولویت"
              name="support-priority"
              value={draft.priority ?? ""}
              options={[
                ["", "همه"],
                ["urgent", "فوری"],
                ["normal", "عادی"],
              ]}
              onChange={(value) =>
                update({
                  priority: value ? (value as "normal" | "urgent") : undefined,
                })
              }
            />
          </div>

          <div className="mt-4 space-y-5">
            <ChoiceButtons
              compact
              label="نوع درخواست اولیه"
              name="support-intake"
              value={draft.intake_kind ?? ""}
              options={[
                ["", "همه"],
                ["general", "راهنمایی و پرسش"],
                ["account_deletion", "حذف حساب"],
                ["public_contact_removal", "حذف اطلاعات تماس عمومی"],
              ]}
              onChange={(value) =>
                update({
                  intake_kind: value ? (value as IntakeKind) : undefined,
                })
              }
            />
            <ChoiceButtons
              compact
              label="دسته‌بندی درخواست"
              name="support-classification"
              value={draft.classification ?? ""}
              options={[
                ["", "همه"],
                ...Object.entries(supportClassificationLabels),
              ]}
              onChange={(value) =>
                update({
                  classification: value
                    ? (value as SupportClassification)
                    : undefined,
                })
              }
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="support-age">حداقل زمان انتظار (روز)</Label>
                <Input
                  id="support-age"
                  type="number"
                  min={0}
                  step={1}
                  className="rounded-xl"
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
              <ChoiceButtons
                compact
                label="ترتیب نمایش"
                name="support-order"
                value={draft.ordering ?? "oldest"}
                options={[
                  ["oldest", "قدیمی‌ترین"],
                  ["newest", "تازه‌ترین"],
                ]}
                onChange={(value) =>
                  update({ ordering: value as "oldest" | "newest" })
                }
              />
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
