import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

type Candidate = Pick<
  components["schemas"]["ExternalListingCandidate"],
  | "id"
  | "title"
  | "external_url"
  | "revision"
  | "state"
  | "superseded"
  | "is_current"
  | "exclusion_reason"
  | "validation_errors"
>;
const selectable = (candidate: Candidate) =>
  !candidate.superseded &&
  candidate.is_current !== false &&
  (candidate.state === "pending" || candidate.state === "changes_requested");
const publishable = (candidate: Candidate) =>
  selectable(candidate) &&
  !candidate.exclusion_reason &&
  Object.keys(candidate.validation_errors ?? {}).length === 0;

export function useCandidateSelection({
  proposalId,
  runId,
  search,
  filter,
  remote,
  candidates,
  enabled,
}: {
  proposalId: string;
  runId?: string;
  search: string;
  filter: "all" | "ready" | "issues" | "published" | "archived";
  remote: boolean;
  candidates: Candidate[];
  enabled: boolean;
}) {
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState("");
  const client = useQueryClient();
  const selectAll = useMutation({
    mutationFn: async () => {
      if (!remote) return candidates.filter(selectable);
      const result: Candidate[] = [];
      let count = 0;
      for (let page = 1; page === 1 || result.length < count; page++) {
        const { data, error } = await api.GET(
          "/api/v1/operator/source-proposals/{proposal_id}/results/",
          {
            params: {
              path: { proposal_id: proposalId },
              query: {
                page,
                q: search,
                status: filter,
                run: runId,
              },
            },
          },
        );
        if (error || !data) throw apiError(error);
        result.push(...data.results);
        count = data.count;
        if (!data.results.length) break;
      }
      return [
        ...new Map(result.filter(selectable).map((c) => [c.id, c])).values(),
      ];
    },
    onSuccess: (items) => {
      setSelected(items);
      setConfirmed(false);
      setOutcome("");
    },
  });
  const decision = useMutation({
    mutationFn: async (action: "approve" | "reject") => {
      const { data, error } = await api.POST(
        "/api/v1/operator/source-proposals/{proposal_id}/results/decide/",
        {
          params: { path: { proposal_id: proposalId } },
          body: {
            action,
            reason,
            confirmed: action === "approve" && confirmed,
            items: selected.map((candidate) => ({
              id: candidate.id,
              reviewed_revision: candidate.revision,
            })),
          },
        },
      );
      if (error || !data) throw apiError(error);
      return {
        succeeded: data.succeeded.length,
        failed: selected.filter((candidate) =>
          data.failed.some((item) => item.id === candidate.id),
        ),
        errors: data.failed.map((item) => {
          const candidate = selected.find(
            (candidate) => candidate.id === item.id,
          );
          return `${candidate?.title || candidate?.external_url || item.id}: ${item.detail}`;
        }),
      };
    },
    onSuccess: async ({ failed, errors, succeeded }) => {
      setSelected(failed);
      setConfirmed(false);
      setOutcome(
        `${succeeded.toLocaleString("fa-IR")} تصمیم ثبت شد.${failed.length ? ` ${failed.length.toLocaleString("fa-IR")} مورد ناموفق بود؛ انتخاب آن‌ها حفظ شد. ${errors.join(" · ")}` : ""}`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["operator-source-proposals"] }),
        client.invalidateQueries({
          queryKey: ["operator-external-listing-candidates"],
        }),
      ]);
    },
  });
  const busy = selectAll.isPending || decision.isPending;
  const reset = () => {
    setSelected([]);
    setConfirmed(false);
    setOutcome("");
  };
  const toggle = (items: Candidate[], checked: boolean) => {
    setConfirmed(false);
    setSelected((current) =>
      checked
        ? [
            ...new Map(
              [...current, ...items.filter(selectable)].map((c) => [c.id, c]),
            ).values(),
          ]
        : current.filter((c) => !items.some((item) => item.id === c.id)),
    );
  };
  const checkbox = (items: Candidate[], label: string) => {
    const eligible = items.filter(selectable);
    const count = eligible.filter((c) =>
      selected.some((s) => s.id === c.id),
    ).length;
    return enabled ? (
      <input
        type="checkbox"
        aria-label={label}
        ref={(node) => {
          if (node) node.indeterminate = count > 0 && count < eligible.length;
        }}
        checked={eligible.length > 0 && count === eligible.length}
        disabled={busy || !eligible.length}
        onChange={(event) => toggle(eligible, event.target.checked)}
      />
    ) : null;
  };
  const toolbar = enabled ? (
    <div className="grid gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy}
          className="h-auto min-h-11 whitespace-normal"
          onClick={() => selectAll.mutate()}
        >
          انتخاب همه آگهی‌های قابل بررسی مطابق فیلتر
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !selected.length}
          onClick={reset}
        >
          پاک کردن انتخاب
        </Button>
        <span role="status">
          {selected.length.toLocaleString("fa-IR")} آگهی انتخاب شده
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        انتخاب همه شامل تمام صفحات مطابق جست‌وجو و فیلتر است. برای نتیجه این
        اقدام گروهی، یک اعلان خلاصه شامل تعداد آگهی‌ها و دلیل اختیاری برای هر
        درخواست‌کننده استخراج ثبت می‌شود؛ ایمیل یا پیامک ارسال نمی‌شود.
      </p>
      {selected.length > 0 && (
        <>
          <label className="grid gap-2">
            دلیل رد گروهی (اختیاری)
            <Input
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            آگهی‌های انتخاب‌شده را بررسی و انتشار آن‌ها را تأیید می‌کنم
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !confirmed || !selected.every(publishable)}
              onClick={() => decision.mutate("approve")}
            >
              تأیید و انتشار انتخاب‌شده‌ها
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => decision.mutate("reject")}
            >
              رد انتخاب‌شده‌ها
            </Button>
          </div>
          {!selected.every(publishable) && (
            <p className="text-sm">
              برای انتشار، موارد دارای خطا یا محدودیت انتشار را از انتخاب خارج
              کنید.
            </p>
          )}
        </>
      )}
      {busy && <p role="status">در حال انجام…</p>}
      {selectAll.isError && <p role="alert">{selectAll.error.message}</p>}
      {decision.isError && <p role="alert">{decision.error.message}</p>}
      {outcome && <p role="status">{outcome}</p>}
    </div>
  ) : null;
  return { checkbox, toolbar, reset, busy };
}
