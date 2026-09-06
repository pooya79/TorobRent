import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import {
  addSourceExclusion,
  previewSourceExclusion,
  removeSourceExclusion,
  withdrawExcludedListings,
  type OperatorSourceProposal,
} from "./queries";

type Exclusion = components["schemas"]["SourceExclusion"];
type Rule = components["schemas"]["SourceExclusionPreviewRequest"];

export function SourceExclusionsSummary({
  exclusions,
}: {
  exclusions: Exclusion[];
}) {
  return (
    <section className="grid gap-2" aria-label="محدودیت‌های منبع">
      <h4 className="font-semibold">محدودیت‌های منبع</h4>
      <p>
        صفحات محدودشده پردازش نمی‌شود. حذف محدودیت، استخراج تازه را مجاز می‌کند؛
        نتایج قبلی خودکار منتشر نمی‌شود.
      </p>
      {exclusions.length === 0 && <p>محدودیتی ثبت نشده است.</p>}
      {exclusions.map((rule) => (
        <article key={rule.id} className="grid gap-1 rounded border p-3">
          <p>
            {rule.active ? "محدودیت فعال" : "محدودیت حذف‌شده"} ·{" "}
            {rule.kind === "exact" ? "نشانی دقیق" : "بخش مسیر"}
          </p>
          <p dir="ltr" className="break-all">
            {rule.url}
          </p>
          <p>{rule.reason}</p>
          <time dateTime={rule.created_at}>
            {new Date(rule.created_at).toLocaleString("fa-IR")}
          </time>
          {rule.actions.map((action) => (
            <p key={action.id}>
              {action.action === "remove"
                ? "حذف محدودیت"
                : "خروج آگهی‌ها از انتشار"}
              : {action.reason}
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}

export function SourceExclusionsPanel({
  proposalId,
  exclusions,
  onUpdate,
}: {
  proposalId: string;
  exclusions: Exclusion[];
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const [kind, setKind] = useState<Rule["kind"]>("exact");
  const [url, setUrl] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [selection, setSelection] = useState<{
    rule: Exclusion;
    action: "remove" | "withdraw";
  } | null>(null);
  const queryClient = useQueryClient();
  const preview = useMutation({
    mutationFn: (rule: Rule) => previewSourceExclusion(proposalId, rule),
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!confirmed || !reason.trim())
        throw new Error("دلیل و تأیید لازم است.");
      const decision = { reason, confirmed };
      if (selection?.action === "remove")
        return removeSourceExclusion(proposalId, {
          ...decision,
          exclusion_id: selection.rule.id,
        });
      if (!preview.data) throw new Error("پیش‌نمایش لازم است.");
      if (selection?.action === "withdraw")
        return withdrawExcludedListings(proposalId, {
          ...decision,
          exclusion_id: selection.rule.id,
          listing_ids: preview.data.published_listings.map((item) => item.id),
        });
      return addSourceExclusion(proposalId, {
        ...decision,
        kind: preview.data.kind,
        url: preview.data.url,
      });
    },
    onSuccess: (updated) => {
      preview.reset();
      setSelection(null);
      setReason("");
      setConfirmed(false);
      setUrl("");
      onUpdate(updated);
      void queryClient.invalidateQueries({
        queryKey: ["operator-external-listing-candidates"],
      });
    },
    onError: () => {
      setConfirmed(false);
      preview.reset();
      void queryClient.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
    },
  });
  const busy = preview.isPending || mutation.isPending;
  const changeInput = () => {
    preview.reset();
    setConfirmed(false);
    mutation.reset();
  };
  const choose = (rule: Exclusion, action: "remove" | "withdraw") => {
    changeInput();
    setReason("");
    setSelection({ rule, action });
    if (action === "withdraw")
      preview.mutate({ kind: rule.kind, url: rule.url });
  };
  const confirmation =
    selection?.action === "withdraw"
      ? "خروج آگهی‌های نمایش‌داده‌شده از انتشار را تأیید می‌کنم"
      : selection?.action === "remove"
        ? "حذف محدودیت را تأیید می‌کنم؛ نتایج قبلی خودکار منتشر نمی‌شود"
        : "اعمال محدودیت را تأیید می‌کنم؛ آگهی‌های منتشرشده باقی می‌ماند";
  return (
    <section
      className="grid gap-3 rounded-lg border p-4"
      aria-label="مدیریت محدودیت‌ها"
    >
      <h3 className="font-semibold">مدیریت محدودیت‌ها</h3>
      <p className="text-muted-foreground text-sm">
        محدودیت با دلیل و تأیید شما اعمال می‌شود و به تأیید دوباره پروفایل نیاز
        ندارد. خطای استخراج به تنهایی دلیل کنار گذاشتن صفحه نیست.
      </p>
      {exclusions
        .filter((rule) => rule.active)
        .map((rule) => (
          <div key={rule.id} className="grid gap-2 rounded border p-3">
            <p dir="ltr" className="break-all">
              {rule.url}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => choose(rule, "remove")}
              >
                حذف این محدودیت
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => choose(rule, "withdraw")}
              >
                پیش‌نمایش خروج آگهی‌ها
              </Button>
            </div>
          </div>
        ))}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <fieldset className="grid gap-3" disabled={busy}>
          <legend className="mb-2 font-medium">
            {selection
              ? selection.action === "remove"
                ? "حذف محدودیت"
                : "خروج آگهی‌ها از انتشار"
              : "محدودیت تازه"}
          </legend>
          {selection ? (
            <>
              <p dir="ltr" className="break-all">
                {selection.rule.url}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelection(null);
                  changeInput();
                  setReason("");
                }}
              >
                بازگشت به محدودیت تازه
              </Button>
            </>
          ) : (
            <>
              <label className="grid gap-1">
                نوع محدودیت
                <select
                  className="rounded border p-2"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as Rule["kind"]);
                    changeInput();
                  }}
                >
                  <option value="exact">نشانی دقیق</option>
                  <option value="path_prefix">بخش مسیر</option>
                </select>
              </label>
              <label className="grid gap-1">
                نشانی محدودیت
                <Input
                  dir="ltr"
                  type="url"
                  maxLength={1000}
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    changeInput();
                  }}
                />
              </label>
              <p className="text-sm">
                نشانی دقیق، پارامترهای معنادار را حفظ می‌کند. بخش{" "}
                <bdi dir="ltr">/archive</bdi> شامل{" "}
                <bdi dir="ltr">/archive-old</bdi> نمی‌شود و فقط روی همین وب‌سایت
                اعمال می‌شود.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={!url.trim()}
                onClick={() => {
                  setConfirmed(false);
                  preview.mutate({ kind, url });
                }}
              >
                پیش‌نمایش محدودیت
              </Button>
            </>
          )}
          {preview.data && (
            <div className="grid gap-2 rounded border p-3" role="status">
              <p dir="ltr" className="break-all">
                {preview.data.url}
              </p>
              {preview.data.known_page_count === 0 ? (
                <p>
                  هیچ صفحه شناخته‌شده‌ای مطابق نیست؛ این پیش‌نمایش کشف کامل
                  وب‌سایت نیست.
                </p>
              ) : (
                <>
                  <p>
                    صفحات شناخته‌شده مطابق:{" "}
                    {preview.data.known_page_count.toLocaleString("fa-IR")}؛
                    حداکثر ۱۰۰ نمونه از اطلاعات موجود، نه کشف کامل وب‌سایت.
                  </p>
                  <ul className="grid gap-1">
                    {preview.data.known_pages.map((page) => (
                      <li key={page} dir="ltr" className="break-all">
                        {page}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p>
                آگهی‌های منتشرشده مطابق:{" "}
                {preview.data.published_listing_count.toLocaleString("fa-IR")}
              </p>
              <ul className="grid gap-1">
                {preview.data.published_listings.map((listing) => (
                  <li key={listing.id} dir="ltr" className="break-all">
                    {listing.url}
                  </li>
                ))}
              </ul>
              <p>
                ثبت محدودیت، آگهی‌های موجود را از انتشار خارج نمی‌کند. خروج فقط
                برای آگهی‌های نمایش‌داده‌شده با اقدام جداگانه انجام می‌شود.
              </p>
            </div>
          )}
          {(preview.data || selection?.action === "remove") && (
            <>
              <label className="grid gap-1">
                دلیل تصمیم
                <Input
                  value={reason}
                  maxLength={2000}
                  required
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="flex items-center gap-2">
                <Input
                  type="checkbox"
                  className="size-4"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {confirmation}
              </label>
              <Button
                type="submit"
                disabled={
                  !reason.trim() ||
                  !confirmed ||
                  (selection?.action === "withdraw" &&
                    !preview.data?.published_listings.length)
                }
              >
                {selection?.action === "withdraw"
                  ? "خروج آگهی‌های نمایش‌داده‌شده"
                  : selection?.action === "remove"
                    ? "ثبت حذف محدودیت"
                    : "ثبت محدودیت"}
              </Button>
            </>
          )}
        </fieldset>
        {(preview.error || mutation.error) && (
          <p role="alert">
            {errorMessage(
              preview.error ?? mutation.error,
              "تصمیم ثبت نشد؛ پیش‌نمایش و پرونده را تازه کنید.",
            )}
          </p>
        )}
        {mutation.isSuccess && <p role="status">تصمیم ثبت شد.</p>}
      </form>
    </section>
  );
}
