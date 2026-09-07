import { BulkCandidateDetails } from "./BulkCandidateDetails";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

type Preview = components["schemas"]["SourceBulkPreview"];
type Action = components["schemas"]["SourceBulkPreviewRequest"]["action"];
const statuses = {
  eligible: "واجد شرایط",
  blocked: "مسدود",
  excluded: "کنار گذاشته شده",
  obsolete: "قدیمی",
};

export function SourceBulkActions({
  proposalId,
  pages,
}: {
  proposalId: string;
  pages: components["schemas"]["SourceExtractionException"][];
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<Action>("publish");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<number | null>(null);
  const reset = () => {
    setPreview(null);
    setConfirmed(false);
    setOutcome(null);
  };
  const refresh = () =>
    Promise.all(
      [
        ["operator-source-proposals"],
        ["operator-external-listing-candidates"],
        ["messages"],
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/source-proposals/{proposal_id}/exceptions/bulk/preview/",
        {
          params: { path: { proposal_id: proposalId } },
          body: { exception_ids: selected, action, reason },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setConfirmed(false);
    },
  });
  const applyMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/source-proposals/{proposal_id}/exceptions/bulk/apply/",
        {
          params: { path: { proposal_id: proposalId } },
          body: { token: preview!.token, confirmed: true },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: async (data) => {
      reset();
      setSelected([]);
      setOutcome(data.affected);
      await refresh();
    },
    onError: async () => {
      reset();
      await refresh();
    },
  });
  const busy = previewMutation.isPending || applyMutation.isPending;
  const groups = new Map<string, typeof pages>();
  for (const page of pages) {
    const group = page.state === "open" ? page.problem : page.state;
    groups.set(group, [...(groups.get(group) ?? []), page]);
  }
  return (
    <section
      className="grid min-w-0 gap-3 rounded-lg border p-4"
      aria-label="اقدام گروهی روی نتایج جاری"
    >
      <h4 className="font-semibold">اقدام گروهی روی نتایج جاری همین منبع</h4>
      <p>
        حداکثر ۲۰ صفحه را انتخاب کنید. پیش‌نمایش، وضعیت جاری هر صفحه را پیش از
        تصمیم نشان می‌دهد.
      </p>
      <a href={`#source-profile-${proposalId}`} className="underline">
        بررسی و تعمیر پروفایل منبع
      </a>
      <p>اصلاح یک آگهی، پروفایل استخراج را تعمیر نمی‌کند.</p>
      <fieldset disabled={busy} className="grid min-w-0 gap-3">
        {[...groups].map(([group, items]) => (
          <div key={group} className="grid gap-2 rounded border p-3">
            <Button
              variant="outline"
              className="h-auto min-h-11 whitespace-normal"
              onClick={() => {
                reset();
                setSelected(items.slice(0, 20).map((page) => page.id));
              }}
            >
              انتخاب گروه{" "}
              {group === "resolved"
                ? "استخراج موفق"
                : group === "excluded"
                  ? "کنار گذاشته شده"
                  : "نیازمند بررسی"}{" "}
              · {items.length.toLocaleString("fa-IR")} صفحه (تا ۲۰ صفحه)
            </Button>
            {items.map((page) => (
              <label key={page.id} className="flex min-w-0 items-center gap-2">
                <Input
                  type="checkbox"
                  className="size-4"
                  checked={selected.includes(page.id)}
                  disabled={
                    !selected.includes(page.id) && selected.length >= 20
                  }
                  onChange={(event) => {
                    reset();
                    setSelected(
                      event.target.checked
                        ? [...selected, page.id]
                        : selected.filter((id) => id !== page.id),
                    );
                  }}
                />
                <bdi dir="ltr" className="min-w-0 break-all">
                  {page.canonical_url}
                </bdi>
              </label>
            ))}
          </div>
        ))}
        <p>{selected.length.toLocaleString("fa-IR")} صفحه انتخاب شده</p>
        <label className="grid gap-2">
          اقدام انتخابی
          <select
            value={action}
            onChange={(event) => {
              reset();
              setAction(event.target.value as Action);
            }}
            className="rounded border p-2"
          >
            <option value="publish">انتشار موارد معتبر در انتظار</option>
            <option value="exclude">کنار گذاشتن صریح صفحه‌ها</option>
            <option value="request_action">
              درخواست اقدام نماینده در گفتگوی منبع
            </option>
          </select>
        </label>
        {action !== "publish" && (
          <label className="grid gap-2">
            {action === "exclude" ? "دلیل محدودیت" : "متن درخواست از نماینده"}
            <textarea
              value={reason}
              maxLength={4000}
              onChange={(event) => {
                reset();
                setReason(event.target.value);
              }}
              className="min-h-24 rounded border p-2"
            />
          </label>
        )}
        <Button
          disabled={
            !selected.length || (action !== "publish" && !reason.trim())
          }
          onClick={() => {
            reset();
            applyMutation.reset();
            previewMutation.mutate();
          }}
        >
          پیش‌نمایش انتخاب
        </Button>
      </fieldset>
      {preview && (
        <section className="grid gap-3" aria-label="پیش‌نمایش اقدام گروهی">
          <h5 className="font-semibold">
            دامنه انتخاب: همین منبع،{" "}
            {preview.items.length.toLocaleString("fa-IR")} صفحه
          </h5>
          {action === "request_action" && (
            <p className="whitespace-pre-wrap">پیام ارسالی: {reason}</p>
          )}
          {action === "exclude" && (
            <p>
              محدودیت فقط روی نشانی‌های دقیق انتخابی اعمال می‌شود. آگهی‌های
              منتشرشده برداشته نمی‌شوند.
            </p>
          )}
          <ul className="grid gap-2">
            {preview.items.map((item) => (
              <li key={item.id} className="grid gap-1 rounded border p-3">
                <bdi dir="ltr" className="min-w-0 break-all">
                  {item.url}
                </bdi>
                <p>
                  {statuses[item.status]} ·{" "}
                  {item.action_eligible ? "در دامنه اجرای اقدام" : "بدون تغییر"}
                </p>
                <p>{item.detail}</p>
                {action === "exclude" && (
                  <p>
                    آگهی منتشرشده مرتبط:{" "}
                    {item.published_listing_count.toLocaleString("fa-IR")}
                  </p>
                )}
                {item.candidate && (
                  <BulkCandidateDetails
                    candidate={item.candidate}
                    onCorrected={reset}
                  />
                )}
              </li>
            ))}
          </ul>
          <label className="flex min-w-0 items-center gap-2">
            <Input
              type="checkbox"
              className="size-4"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            دامنه انتخاب و موارد قابل اقدام را تأیید می‌کنم
          </label>
          <Button
            disabled={
              !confirmed ||
              busy ||
              !preview.items.some((item) => item.action_eligible)
            }
            onClick={() => applyMutation.mutate()}
          >
            اجرای اقدام گروهی
          </Button>
        </section>
      )}
      {(previewMutation.error || applyMutation.error) && (
        <p role="alert">
          {(previewMutation.error || applyMutation.error)?.message} پیش‌نمایش را
          تازه کنید.
        </p>
      )}
      {outcome !== null && (
        <p role="status">
          اقدام برای {outcome.toLocaleString("fa-IR")} مورد انجام شد.
        </p>
      )}
    </section>
  );
}
