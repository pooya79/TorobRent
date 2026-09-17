import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

type Schema = components["schemas"];
export type CaseRecordTypes = {
  results: Schema["ExternalListingCandidateSummary"];
  runs: Schema["ExtractionRequest"];
  history: Schema["SourceProposalEvent"];
  "responsibility-history": Schema["SourceResponsibilityChange"];
  profiles: Schema["SourceProfileSummary"];
  repairs: Schema["SourceProfileRepair"];
  problems: Schema["SourceProblemSummary"];
  exclusions: Schema["SourceExclusionSummary"];
};
const paths = {
  results: "/api/v1/operator/source-proposals/{proposal_id}/results/",
  runs: "/api/v1/operator/source-proposals/{proposal_id}/runs/",
  history: "/api/v1/operator/source-proposals/{proposal_id}/history/",
  "responsibility-history":
    "/api/v1/operator/source-proposals/{proposal_id}/responsibility-history/",
  profiles: "/api/v1/operator/source-proposals/{proposal_id}/profiles/",
  repairs: "/api/v1/operator/source-proposals/{proposal_id}/repairs/",
  problems: "/api/v1/operator/source-proposals/{proposal_id}/problems/",
  exclusions: "/api/v1/operator/source-proposals/{proposal_id}/exclusions/",
} as const;
type Page<T> = { count: number; results: T[] };
export function useCaseRecords<K extends keyof CaseRecordTypes>(
  kind: K,
  proposalId: string,
  page: number,
  q: string,
  options: {
    state?: "all" | "open" | "excluded" | "resolved";
    enabled?: boolean;
    status?: "all" | "ready" | "issues" | "published" | "archived";
    run?: string;
  } = {},
) {
  return useQuery({
    queryKey: [
      "operator-source-proposals",
      proposalId,
      kind,
      page,
      q,
      options.status,
      options.run,
      options.state,
    ],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await api.GET(paths[kind], {
        params: {
          path: { proposal_id: proposalId },
          query: {
            page: page + 1,
            q,
            status: options.status,
            run: options.run,
            state: options.state,
          },
        },
      });
      if (error || !data) throw apiError(error);
      // The path map and record map describe the same API resources.
      return data as Page<CaseRecordTypes[K]>;
    },
  });
}
export function CasePager({
  page,
  count,
  onPage,
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
}) {
  const last = Math.max(0, Math.ceil(count / 20) - 1);
  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        variant="outline"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        صفحه قبل
      </Button>
      <span className="text-sm">
        صفحه {(page + 1).toLocaleString("fa-IR")} از{" "}
        {(last + 1).toLocaleString("fa-IR")} · {count.toLocaleString("fa-IR")}{" "}
        مورد
      </span>
      <Button
        variant="outline"
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
      >
        صفحه بعد
      </Button>
    </div>
  );
}
export function CaseRecords<K extends keyof CaseRecordTypes>({
  kind,
  proposalId,
  children,
}: {
  kind: K;
  proposalId: string;
  children: (rows: CaseRecordTypes[K][]) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | "open" | "excluded" | "resolved">(
    "all",
  );
  const query = useCaseRecords(kind, proposalId, page, q, {
    state: kind === "problems" ? state : undefined,
  });
  return (
    <div className="grid gap-4">
      {kind === "problems" && (
        <select
          aria-label="فیلتر وضعیت مشکلات"
          value={state}
          onChange={(e) => {
            setState(e.target.value as typeof state);
            setPage(0);
          }}
        >
          <option value="all">همه</option>
          <option value="open">نیازمند رسیدگی</option>
          <option value="excluded">کنار گذاشته شده</option>
          <option value="resolved">رفع شده</option>
        </select>
      )}
      <Input
        aria-label="جست‌وجو در همه موارد"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
      />
      <Button variant="outline" onClick={() => void query.refetch()}>
        تازه‌سازی
      </Button>
      {query.isPending ? (
        <p role="status">در حال بارگذاری…</p>
      ) : query.isError ? (
        <p role="alert">بارگذاری ناموفق بود؛ دوباره تلاش کنید.</p>
      ) : (
        <>
          <div key={`${page}-${q}-${state}`}>
            {children(query.data.results)}
          </div>
          <CasePager page={page} count={query.data.count} onPage={setPage} />
        </>
      )}
    </div>
  );
}
