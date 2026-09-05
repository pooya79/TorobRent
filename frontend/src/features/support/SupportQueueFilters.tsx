import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { ChoiceButtons } from "@/components/ChoiceButtons";
import { Button } from "@/components/ui/button";
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
  const update = (patch: Partial<SupportQueueFilters>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  const count = Object.entries(filters).filter(
    ([key, value]) =>
      !["page", "page_size", "ordering"].includes(key) &&
      value !== undefined &&
      value !== "",
  ).length;
  return (
    <form
      className="bg-card mb-6 rounded-2xl border shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({
          ...draft,
          search: draft.search?.trim() || undefined,
          page: 1,
        });
      }}
    >
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <SlidersHorizontal className="text-primary size-5" aria-hidden="true" />
        <h2 className="font-semibold">جست‌وجو و فیلتر درخواست‌ها</h2>
        {count > 0 && (
          <span className="bg-primary/10 text-primary ms-auto rounded-full px-3 py-1 text-xs">
            {count.toLocaleString("fa-IR")} فیلتر فعال
          </span>
        )}
      </div>
      <div className="space-y-6 p-5">
        <div className="max-w-xl space-y-2">
          <Label htmlFor="support-search">جست‌وجوی درخواست</Label>
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
        <div className="grid gap-6 xl:grid-cols-[1fr_auto]">
          <ChoiceButtons
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
              update({ assignee: value ? (value as AssigneeFacet) : undefined })
            }
          />
          <ChoiceButtons
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
        <details className="border-t pt-4">
          <summary className="focus-visible:outline-ring cursor-pointer rounded-md py-2 text-sm font-medium">
            نوع درخواست، دسته‌بندی و ترتیب نمایش
          </summary>
          <div className="mt-4 space-y-5">
            <ChoiceButtons
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
      <div className="bg-muted/30 flex flex-wrap items-center gap-3 rounded-b-2xl border-t px-5 py-4">
        <Button type="submit" className="rounded-xl">
          اعمال فیلترها
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="rounded-xl"
          onClick={() => {
            const cleared = { ordering: "oldest" as const };
            setDraft(cleared);
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
