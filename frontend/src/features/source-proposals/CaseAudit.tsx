import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import { CasePager } from "./CaseRecords";
import { Button } from "@/components/ui/button";

export function CaseAudit({
  proposalId,
  recordId,
  kind,
}: {
  proposalId: string;
  recordId: string;
  kind: "attempts" | "actions";
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["operator-source-proposals", proposalId, kind, recordId, page],
    enabled: open,
    refetchInterval: 5000,
    queryFn: async () => {
      if (kind === "attempts") {
        const { data, error } = await api.GET(
          "/api/v1/operator/source-proposals/{proposal_id}/problems/{exception_id}/attempts/",
          {
            params: {
              path: { proposal_id: proposalId, exception_id: recordId },
              query: { page: page + 1 },
            },
          },
        );
        if (error || !data) throw apiError(error);
        return {
          count: data.count,
          results: data.results.map((row) => ({
            id: `${row.run}-${row.attempt}`,
            date: row.attempted_at,
            text: row.detail,
          })),
        };
      }
      const { data, error } = await api.GET(
        "/api/v1/operator/source-proposals/{proposal_id}/exclusions/{exclusion_id}/actions/",
        {
          params: {
            path: { proposal_id: proposalId, exclusion_id: recordId },
            query: { page: page + 1 },
          },
        },
      );
      if (error || !data) throw apiError(error);
      return {
        count: data.count,
        results: data.results.map((row) => ({
          id: String(row.id),
          date: row.created_at,
          text: row.reason,
        })),
      };
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer">
        {kind === "attempts" ? "تاریخچه تلاش‌ها" : "تاریخچه محدودیت"}
      </summary>
      {open &&
        (query.data ? (
          <div className="grid gap-3">
            {query.data.results.map((row) => (
              <p key={row.id}>
                <time dateTime={row.date}>
                  {new Date(row.date).toLocaleString("fa-IR")}
                </time>{" "}
                · {row.text}
              </p>
            ))}
            <CasePager page={page} count={query.data.count} onPage={setPage} />
          </div>
        ) : (
          <p role={query.isError ? "alert" : "status"}>
            {query.isError ? (
              <Button onClick={() => void query.refetch()}>تلاش دوباره</Button>
            ) : (
              "در حال بارگذاری…"
            )}
          </p>
        ))}
    </details>
  );
}
