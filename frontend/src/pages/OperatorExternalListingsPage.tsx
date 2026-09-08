import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe2,
  ListFilter,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExternalListingCandidateCard } from "@/features/source-proposals/OperatorReviewCards";
import { ExternalListingQueueRow } from "@/features/source-proposals/ExternalListingQueueRow";
import {
  candidateCanDecide,
  candidateNeedsAttention,
  normalizeListingSearch,
  representativeName,
} from "@/features/source-proposals/external-listing-workflow";
import { sourceAssignee } from "@/features/source-proposals/operator-workflow";
import {
  operatorExternalListingCandidatesQueryOptions,
  operatorSourceProposalsQueryOptions,
  type ExternalListingCandidate,
} from "@/features/source-proposals/queries";
import { currentUserQuery } from "@/features/session/queries";

const filters = [
  { id: "all", label: "همه آگهی‌ها", icon: Building2 },
  { id: "mine", label: "واگذارشده به من", icon: UserRound },
  { id: "attention", label: "نیازمند اصلاح", icon: ListFilter },
] as const;
const pageSize = 20;
const selectClass =
  "border-input bg-background focus-visible:ring-ring h-11 w-full min-w-0 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

export function OperatorExternalListingsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [listingCompleted, setListingCompleted] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const currentUser = useQuery(currentUserQuery);
  const mayReview =
    currentUser.data?.operator_capabilities.includes(
      "review_source_proposals",
    ) ?? false;
  const proposals = useQuery({
    ...operatorSourceProposalsQueryOptions,
    enabled: mayReview,
  });
  const candidates = useQuery({
    ...operatorExternalListingCandidatesQueryOptions,
    enabled: mayReview,
  });
  const proposalMap = new Map(
    proposals.data?.map((proposal) => [proposal.id, proposal]),
  );
  const items = candidates.data ?? [];
  const sourceId = params.get("proposal") ?? "";
  const search = params.get("q") ?? "";
  const filter = params.get("filter") ?? "all";
  const sort = params.get("sort") ?? "oldest";
  const isMine = (candidate: ExternalListingCandidate) => {
    const proposal = proposalMap.get(candidate.source_proposal_id);
    return Boolean(
      proposal &&
      currentUser.data &&
      sourceAssignee(proposal) === currentUser.data.id,
    );
  };
  const matches = (candidate: ExternalListingCandidate, value: string) =>
    value === "mine"
      ? isMine(candidate)
      : value === "attention"
        ? candidateNeedsAttention(candidate)
        : true;
  const scoped = items.filter(
    (candidate) => !sourceId || candidate.source_proposal_id === sourceId,
  );
  const visible = scoped
    .filter((candidate) => {
      const proposal = proposalMap.get(candidate.source_proposal_id);
      return (
        matches(candidate, filter) &&
        normalizeListingSearch(
          [
            candidate.title,
            candidate.source.display_name,
            candidate.source.domain,
            candidate.external_url,
            representativeName(proposal),
            proposal?.submitter?.account_label,
            proposal?.responsibility?.operator_label,
          ].join(" "),
        ).includes(normalizeListingSearch(search))
      );
    })
    .sort((a, b) =>
      sort === "newest"
        ? b.created_at.localeCompare(a.created_at)
        : a.created_at.localeCompare(b.created_at),
    );
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const requestedPage = Number(params.get("page") || 1);
  const page = Math.min(
    pageCount,
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1,
  );
  const pageItems = visible.slice((page - 1) * pageSize, page * pageSize);
  const selected = items.find(
    (candidate) => candidate.id === params.get("candidate"),
  );
  const selectedProposal = selected
    ? proposalMap.get(selected.source_proposal_id)
    : undefined;
  const sourceOptions = [
    ...new Map(
      items.map((candidate) => [
        candidate.source_proposal_id,
        candidate.source,
      ]),
    ).entries(),
  ];
  const update = (key: string, value: string, replace = true) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page" && key !== "candidate") next.delete("page");
    setParams(next, { replace });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    for (const key of ["q", "filter", "proposal", "page"]) next.delete(key);
    setParams(next, { replace: true });
  };
  const removeCompletedCandidate = (candidateId: string) => {
    queryClient.setQueryData<ExternalListingCandidate[]>(
      operatorExternalListingCandidatesQueryOptions.queryKey,
      (current) => current?.filter((candidate) => candidate.id !== candidateId),
    );
    setListingCompleted(true);
    update("candidate", "");
    void queryClient.invalidateQueries({
      queryKey: operatorSourceProposalsQueryOptions.queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: operatorExternalListingCandidatesQueryOptions.queryKey,
    });
  };

  return (
    <PageMain>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-info text-sm font-semibold">
            فضای اپراتور / آگهی‌های منابع
          </p>
          <h1 className="mt-2 text-3xl font-semibold">آگهی‌های استخراج‌شده</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl leading-7">
            ملک، نماینده منبع و مسئول بررسی را یکجا ببینید؛ برای بررسی جزئیات،
            آگهی را باز کنید.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/operator/source-proposals">
            <Globe2 aria-hidden="true" />
            صف منابع
          </Link>
        </Button>
      </header>
      {mayReview && (
        <>
          <div
            className="mb-6 grid gap-3 sm:grid-cols-3"
            aria-label="نمای کلی صف"
          >
            {filters.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => update("filter", id === "all" ? "" : id)}
                className={`focus-visible:outline-ring flex items-center gap-4 rounded-xl border p-5 text-start focus-visible:outline-2 ${filter === id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"}`}
              >
                <span className="bg-background text-primary rounded-xl border p-3">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="flex flex-1 items-center justify-between gap-3">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-3xl font-semibold tabular-nums">
                    {candidates.isPending
                      ? "—"
                      : scoped
                          .filter((candidate) => matches(candidate, id))
                          .length.toLocaleString("fa-IR")}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {listingCompleted && (
            <p role="status" className="text-info mb-4 flex items-center gap-2">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              تصمیم آگهی ثبت شد.
            </p>
          )}
          {proposals.isError && (
            <Alert className="mb-4">
              <AlertDescription>
                اطلاعات نماینده و مسئول منابع بارگذاری نشد.{" "}
                <Button variant="link" onClick={() => void proposals.refetch()}>
                  تلاش دوباره برای منابع
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <section
            aria-label="صف آگهی‌ها"
            className="bg-card overflow-hidden rounded-xl border shadow-sm"
          >
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid gap-2">
                <Label htmlFor="listing-search">جست‌وجوی آگهی و نماینده</Label>
                <div className="relative">
                  <Search
                    className="text-muted-foreground absolute start-3 top-3.5 size-4"
                    aria-hidden="true"
                  />
                  <Input
                    id="listing-search"
                    className="h-11 ps-10"
                    placeholder="عنوان ملک، نام نماینده یا دامنه…"
                    value={search}
                    onChange={(event) => update("q", event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="listing-source">منبع</Label>
                <select
                  id="listing-source"
                  className={selectClass}
                  value={sourceId}
                  onChange={(event) => update("proposal", event.target.value)}
                >
                  <option value="">همه منابع</option>
                  {sourceId &&
                    !sourceOptions.some(([id]) => id === sourceId) && (
                      <option value={sourceId}>
                        {proposalMap.get(sourceId)?.website_name ||
                          "منبع انتخاب‌شده"}
                      </option>
                    )}
                  {sourceOptions.map(([id, source]) => (
                    <option key={id} value={id}>
                      {source.display_name} · {source.domain}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="listing-sort">ترتیب نمایش</Label>
                <select
                  id="listing-sort"
                  className={selectClass}
                  value={sort}
                  onChange={(event) => update("sort", event.target.value)}
                >
                  <option value="oldest">قدیمی‌ترین دریافت، اول</option>
                  <option value="newest">جدیدترین دریافت، اول</option>
                </select>
              </div>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-sm">
              <p role="status">
                {candidates.isPending
                  ? "در حال بارگذاری آگهی‌ها…"
                  : `${visible.length.toLocaleString("fa-IR")} آگهی در این نما`}
              </p>
              {(search || sourceId || filter !== "all") && (
                <Button variant="link" size="sm" onClick={clearFilters}>
                  پاک کردن فیلترها
                </Button>
              )}
            </div>
            <div
              className="bg-muted/40 text-muted-foreground hidden gap-4 border-t px-5 py-3 text-xs font-medium xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)]"
              aria-hidden="true"
            >
              <span>ملک و مشخصات</span>
              <span>منبع و نماینده</span>
              <span>شرایط اجاره</span>
              <span>وضعیت و مسئول بررسی</span>
            </div>
            {candidates.isError ? (
              <div className="p-6">
                <Alert variant="destructive">
                  <AlertDescription>
                    صف آگهی‌های منابع بیرونی بارگذاری نشد.
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => void candidates.refetch()}
                >
                  تلاش دوباره
                </Button>
              </div>
            ) : candidates.isPending ? (
              <div className="animate-pulse space-y-4 p-5" aria-hidden="true">
                {[1, 2, 3].map((id) => (
                  <div key={id} className="bg-muted h-24 rounded-xl" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <Building2
                  className="text-muted-foreground mx-auto mb-4 size-10"
                  aria-hidden="true"
                />
                <h2 className="text-lg font-semibold">
                  {items.length === 0
                    ? "آگهی منبع بیرونی در انتظار بررسی وجود ندارد."
                    : "آگهی مطابق این فیلترها پیدا نشد"}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {items.length === 0
                    ? "نتایج تازه منابع برای بررسی در این صف نمایش داده می‌شوند."
                    : "عبارت جست‌وجو یا منبع انتخاب‌شده را تغییر دهید."}
                </p>
              </div>
            ) : (
              pageItems.map((candidate) => (
                <ExternalListingQueueRow
                  key={candidate.id}
                  candidate={candidate}
                  proposal={proposalMap.get(candidate.source_proposal_id)}
                  mine={isMine(candidate)}
                  onOpen={() => {
                    returnFocus.current = document.activeElement as HTMLElement;
                    update("candidate", candidate.id, false);
                  }}
                />
              ))
            )}
            {pageCount > 1 && (
              <nav
                aria-label="صفحه‌بندی آگهی‌ها"
                className="flex items-center justify-between gap-3 border-t p-4"
              >
                <Button
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => update("page", String(page - 1))}
                >
                  صفحه قبل
                </Button>
                <span className="text-muted-foreground text-sm">
                  صفحه {page.toLocaleString("fa-IR")} از{" "}
                  {pageCount.toLocaleString("fa-IR")}
                </span>
                <Button
                  variant="outline"
                  disabled={page === pageCount}
                  onClick={() => update("page", String(page + 1))}
                >
                  صفحه بعد
                </Button>
              </nav>
            )}
          </section>
          <Dialog
            open={Boolean(selected)}
            onOpenChange={(open) => {
              if (!open) update("candidate", "");
            }}
          >
            <DialogContent
              className="inset-y-0 left-0 h-dvh w-full max-w-3xl translate-x-0 translate-y-0 content-start gap-5 overflow-y-auto rounded-none p-4 sm:p-6"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                (returnFocus.current?.isConnected
                  ? returnFocus.current
                  : document.getElementById("listing-search")
                )?.focus();
              }}
            >
              <DialogTitle className="pe-10">بررسی آگهی</DialogTitle>
              <DialogDescription>
                مشخصات و شواهد را بررسی کنید، سپس درباره انتشار تصمیم بگیرید.
              </DialogDescription>
              {selected && (
                <>
                  <div className="bg-muted/30 grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
                        <UserRound className="size-4" aria-hidden="true" />
                        نماینده منبع
                      </p>
                      <p className="font-medium break-words">
                        <bdi>{representativeName(selectedProposal)}</bdi>
                      </p>
                      {selectedProposal?.submitter?.display_name && (
                        <bdi className="text-muted-foreground mt-1 block w-fit max-w-full text-xs break-all">
                          {selectedProposal.submitter.account_label}
                        </bdi>
                      )}
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
                        <ShieldCheck className="size-4" aria-hidden="true" />
                        اپراتور مسئول بررسی
                      </p>
                      <p className="font-medium break-all">
                        <bdi>
                          {isMine(selected)
                            ? "واگذارشده به من"
                            : selectedProposal?.responsibility
                                ?.operator_label ||
                              (selectedProposal?.assignment?.review_operator
                                ? "اپراتور دیگر"
                                : "مسئول تعیین نشده")}
                        </bdi>
                      </p>
                    </div>
                    <p className="text-muted-foreground text-xs leading-6 sm:col-span-2">
                      نماینده منبع، معرفی‌کننده وب‌سایت است؛ مالکیت این ملک از
                      این اطلاعات مشخص نمی‌شود.
                    </p>
                  </div>
                  {!candidateCanDecide(
                    selected,
                    selectedProposal,
                    currentUser.data?.id,
                  ) && (
                    <Alert>
                      <AlertDescription>
                        تصمیم‌گیری این آگهی با اپراتور مسئول منبع است. برای
                        پیگیری مسئولیت، پرونده منبع را باز کنید.
                      </AlertDescription>
                    </Alert>
                  )}
                  <ExternalListingCandidateCard
                    key={selected.id}
                    candidate={selected}
                    canDecide={candidateCanDecide(
                      selected,
                      selectedProposal,
                      currentUser.data?.id,
                    )}
                    onDecisionSuccess={removeCompletedCandidate}
                  />
                  <Button
                    variant="outline"
                    onClick={() => update("candidate", "")}
                  >
                    <ArrowRight aria-hidden="true" />
                    بازگشت به فهرست
                  </Button>
                </>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </PageMain>
  );
}
