import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router";
import { PageMain } from "@/components/layout/PageMain";
import { Button } from "@/components/ui/button";
import { operatorSourceContextQueryOptions } from "@/features/source-proposals/queries";

/** Resolve bookmarks from the former queue into the source-owned review workspace. */
export function OperatorExternalListingsPage() {
  const [params] = useSearchParams();
  const candidateId = params.get("candidate");
  const sourceId = params.get("proposal");
  const proposals = useQuery({
    ...operatorSourceContextQueryOptions(null, candidateId),
    enabled: Boolean(candidateId && !sourceId),
  });
  const source =
    sourceId ??
    proposals.data?.find(
      (proposal) =>
        proposal.properties?.some(
          (candidate) => candidate.id === candidateId,
        ) ||
        proposal.assignment?.recent_requests?.some((request) =>
          request.run?.candidates?.some(
            (candidate) => candidate.id === candidateId,
          ),
        ),
    )?.id;
  if (source)
    return (
      <Navigate
        replace
        to={`/operator/source-proposals/${source}${candidateId ? `?candidate=${encodeURIComponent(candidateId)}` : ""}#exceptions`}
      />
    );
  if (!candidateId) return <Navigate replace to="/operator/source-proposals" />;
  return (
    <PageMain>
      <h1 className="text-2xl font-semibold">بررسی ملک در پرونده وب‌سایت</h1>
      <p role="status" className="my-4">
        {proposals.isPending
          ? "در حال پیدا کردن وب‌سایت این ملک…"
          : proposals.isError
            ? "اطلاعات وب‌سایت بارگذاری نشد."
            : "این ملک دیگر در نتایج موجود نیست یا به آن دسترسی ندارید. ملک‌های فعلی را در پرونده وب‌سایت ببینید."}
      </p>
      {proposals.isError && (
        <Button onClick={() => void proposals.refetch()}>تلاش دوباره</Button>
      )}
      <Button asChild variant="outline">
        <Link to="/operator/source-proposals">بازگشت به منابع</Link>
      </Button>
    </PageMain>
  );
}
