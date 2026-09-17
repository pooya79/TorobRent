import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useSearchParams,
  useLocation,
  useNavigate,
} from "react-router";
import { ArrowUpLeft, Globe2, Search } from "lucide-react";
import { PageMain } from "@/components/layout/PageMain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SourceResponsibilityPanel } from "@/features/source-proposals/SourceResponsibilityPanel";
import { Label } from "@/components/ui/label";
import { currentUserQuery } from "@/features/session/queries";
import {
  claimSourceProposal,
  operatorSourceProposalsQueryOptions,
  operatorSourceContextQueryOptions,
} from "@/features/source-proposals/queries";
import {
  sourceAssignee,
  sourceDomain,
  sourceWarnings,
  sourceWorkflow,
} from "@/features/source-proposals/operator-workflow";

const filters = [
  { id: "mine", label: "پرونده‌های من" },
  { id: "unassigned", label: "آماده پذیرش" },
  { id: "all", label: "همه پرونده‌ها" },
  { id: "url", label: "بررسی نشانی" },
  { id: "profile", label: "بررسی پروفایل" },
  { id: "active", label: "منابع فعال" },
];
export function OperatorSourceProposalPage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const claim = useMutation({
    mutationFn: claimSourceProposal,
    onSuccess: (proposal) => {
      queryClient.setQueryData(
        operatorSourceContextQueryOptions(proposal.id).queryKey,
        [proposal],
      );
      void queryClient.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
      void navigate(
        `/operator/source-proposals/${proposal.id}#${sourceWorkflow(proposal).section}`,
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
    },
  });
  const [now] = useState(() => Date.now());
  const proposals = useQuery(operatorSourceProposalsQueryOptions);
  const currentUser = useQuery(currentUserQuery);
  const transferTrigger = useRef<HTMLButtonElement | null>(null);
  const [transferred, setTransferred] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const transferCase = proposals.data?.find(
    (proposal) => proposal.id === transferId,
  );
  const canManage = currentUser.data?.operator_capabilities.includes(
    "manage_operator_queues",
  );
  const [params, setParams] = useSearchParams();
  const selected =
    params.get("filter") ??
    (currentUser.data &&
    !currentUser.data.operator_capabilities.includes("review_source_proposals")
      ? "all"
      : "mine");
  const search = params.get("q") ?? "";
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  if (params.get("proposal"))
    return (
      <Navigate
        replace
        to={`/operator/source-proposals/${params.get("proposal")}${hash}`}
      />
    );
  const items = proposals.data ?? [];
  const matches = (proposal: (typeof items)[number], filter: string) =>
    filter === "all" ||
    (filter === "unassigned"
      ? !sourceAssignee(proposal)
      : filter === "mine"
        ? Boolean(
            currentUser.data &&
            sourceAssignee(proposal) === currentUser.data.id,
          )
        : filter === "active"
          ? proposal.assignment?.state === "active"
          : sourceWorkflow(proposal).filter === filter);
  const visible = items.filter(
    (proposal) =>
      matches(proposal, selected) &&
      `${proposal.website_name} ${sourceDomain(proposal)}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <PageMain>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-info text-sm font-semibold">
            فضای اپراتور / منابع
          </p>
          <h1 className="mt-2 text-3xl font-semibold">صف بررسی منابع</h1>
          <p className="text-muted-foreground mt-3">
            ابتدا مسئولیت یک پرونده را بپذیرید؛ سپس همه مراحل بررسی و نگهداری
            منبع را در همان پرونده ادامه دهید.
          </p>
        </div>
      </header>
      {transferred && (
        <p
          role="status"
          className="bg-primary/5 mb-4 rounded-xl border p-4 text-sm"
        >
          واگذاری مسئولیت ثبت شد.
        </p>
      )}
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="grid gap-5 border-b p-5">
          <div className="max-w-md">
            <Label htmlFor="source-search">جست‌وجوی نام یا دامنه</Label>
            <div className="relative mt-2">
              <Search
                className="text-muted-foreground absolute start-3 top-3 size-4"
                aria-hidden="true"
              />
              <Input
                id="source-search"
                className="ps-10"
                value={search}
                placeholder="نام منبع یا example.com"
                onChange={(e) => update("q", e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="فیلتر منابع">
            {filters.map((filter) => (
              <Button
                key={filter.id}
                variant={selected === filter.id ? "default" : "outline"}
                size="sm"
                aria-pressed={selected === filter.id}
                onClick={() => update("filter", filter.id)}
              >
                {filter.label}
                <span className="opacity-70">
                  {items
                    .filter((proposal) => matches(proposal, filter.id))
                    .length.toLocaleString("fa-IR")}
                </span>
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            مسئولیت زمان پایان ندارد. پرونده‌های دیگران فقط خواندنی هستند؛
            واگذاری به اپراتور دیگر با مدیر صف است.
          </p>
        </div>
        {proposals.isPending && (
          <p role="status" className="p-8">
            در حال بارگذاری منابع…
          </p>
        )}
        {proposals.isError && (
          <div role="alert" className="p-8">
            صف منابع بارگذاری نشد.{" "}
            <Button variant="outline" onClick={() => void proposals.refetch()}>
              تلاش دوباره
            </Button>
          </div>
        )}
        {proposals.isSuccess && (
          <>
            <p
              role="status"
              className="text-muted-foreground px-5 py-3 text-sm"
            >
              {visible.length.toLocaleString("fa-IR")} منبع
            </p>
            {!visible.length && (
              <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
                <Globe2
                  className="text-muted-foreground size-10"
                  aria-hidden="true"
                />
                <h2 className="font-semibold">منبعی پیدا نشد</h2>
                <p className="text-muted-foreground text-sm">
                  {search
                    ? "جست‌وجو یا فیلتر را تغییر دهید."
                    : selected === "mine"
                      ? "هنوز پرونده‌ای در اختیار شما نیست. از پرونده‌های آماده پذیرش شروع کنید."
                      : selected === "unassigned"
                        ? "در حال حاضر پرونده‌ای برای پذیرش وجود ندارد."
                        : "درخواست تازه منابع در این صف نمایش داده می‌شود."}
                </p>
                {items.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setParams({ filter: "unassigned" })}
                  >
                    مشاهده پرونده‌های آماده پذیرش
                  </Button>
                )}
              </div>
            )}
            <ul className="divide-y">
              {visible.map((proposal) => {
                const workflow = sourceWorkflow(proposal);
                const owner = sourceAssignee(proposal);
                const mine = owner === currentUser.data?.id;
                const canTake =
                  !owner &&
                  currentUser.data?.operator_capabilities.includes(
                    "review_source_proposals",
                  );
                return (
                  <li
                    key={proposal.id}
                    className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <div className="min-w-0">
                      <Link
                        className="text-lg font-semibold hover:underline focus-visible:outline-2"
                        to={`/operator/source-proposals/${proposal.id}`}
                      >
                        {proposal.website_name || sourceDomain(proposal)}
                      </Link>
                      <p
                        dir="ltr"
                        className="text-muted-foreground mt-1 text-end text-sm break-all"
                      >
                        {sourceDomain(proposal)}
                      </p>
                      <div className="mt-3 text-sm">
                        <span className="text-muted-foreground">
                          ارسال‌کننده:{" "}
                        </span>
                        <span>
                          {proposal.submitter?.display_name ||
                            proposal.submitter?.account_label ||
                            "حساب حذف شده"}
                        </span>
                        {proposal.submitter?.display_name && (
                          <p className="text-muted-foreground mt-1 text-xs break-all">
                            <bdi>{proposal.submitter.account_label}</bdi>
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sourceWarnings(proposal).map((warning) => (
                          <Badge key={warning} variant="destructive">
                            {warning}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <dl className="grid content-start gap-2 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-muted-foreground">مرحله</dt>
                        <dd>
                          <Badge variant="secondary">{workflow.stage}</Badge>
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-muted-foreground">مسئول</dt>
                        <dd className="break-all">
                          {proposal.responsibility?.operator_label ||
                            (sourceAssignee(proposal)
                              ? "مسئول تعیین شده"
                              : "بدون مسئول")}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">عمر پرونده</dt>
                        <dd>
                          <time dateTime={proposal.created_at}>
                            {Math.max(
                              0,
                              Math.floor(
                                (now - Date.parse(proposal.created_at)) /
                                  86400000,
                              ),
                            ).toLocaleString("fa-IR")}{" "}
                            روز
                          </time>
                        </dd>
                      </div>
                      {proposal.assignment?.state === "active" && (
                        <div className="flex flex-wrap gap-2">
                          <dt className="text-muted-foreground">دریافت بعدی</dt>
                          <dd>
                            <Link
                              className="text-primary underline underline-offset-4"
                              to={`/operator/source-proposals/${proposal.id}#processing`}
                            >
                              {proposal.assignment.source.processing_paused ? (
                                "پردازش متوقف است"
                              ) : proposal.assignment.source
                                  .crawl_interval_hours &&
                                proposal.assignment.source.next_crawl_at ? (
                                <time
                                  dateTime={
                                    proposal.assignment.source.next_crawl_at
                                  }
                                >
                                  {new Date(
                                    proposal.assignment.source.next_crawl_at,
                                  ).toLocaleString("fa-IR", {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })}
                                </time>
                              ) : (
                                "فقط اجرای دستی"
                              )}
                            </Link>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="flex flex-col items-start justify-between gap-3">
                      <div>
                        <p className="text-muted-foreground text-xs">
                          اقدام بعدی
                        </p>
                        <p className="mt-1 text-sm">
                          {!owner
                            ? "پذیرش مسئولیت برای شروع کار"
                            : mine
                              ? workflow.action
                              : "در اختیار اپراتور دیگر · فقط مشاهده"}
                        </p>
                      </div>
                      <div className="grid w-full gap-2 sm:w-auto">
                        {canTake ? (
                          <Button
                            size="sm"
                            disabled={claim.isPending}
                            onClick={() => claim.mutate(proposal.id)}
                          >
                            {claim.isPending && claim.variables === proposal.id
                              ? "در حال پذیرش…"
                              : "پذیرش مسئولیت و شروع کار"}
                            <ArrowUpLeft aria-hidden="true" />
                          </Button>
                        ) : (
                          <Button
                            asChild
                            size="sm"
                            variant={mine ? "default" : "outline"}
                          >
                            <Link
                              to={`/operator/source-proposals/${proposal.id}#${workflow.section}`}
                            >
                              {mine ? "ادامه کار روی پرونده" : "مشاهده پرونده"}{" "}
                              <ArrowUpLeft aria-hidden="true" />
                            </Link>
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => {
                              transferTrigger.current = event.currentTarget;
                              setTransferred(false);
                              setTransferId(proposal.id);
                            }}
                          >
                            واگذاری مسئولیت
                          </Button>
                        )}
                        {claim.isError && claim.variables === proposal.id && (
                          <p
                            role="alert"
                            className="text-destructive max-w-xs text-sm"
                          >
                            پذیرش انجام نشد. ممکن است مسئول پرونده تغییر کرده
                            باشد؛ وضعیت تازه صف را بررسی و دوباره تلاش کنید.
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <Dialog
        open={Boolean(transferCase)}
        onOpenChange={(open) => {
          if (!open) setTransferId(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            transferTrigger.current?.focus();
          }}
        >
          <DialogTitle>واگذاری مسئولیت پرونده</DialogTitle>
          <DialogDescription>
            {transferCase?.website_name} — مسئول تازه همه مراحل این پرونده را
            ادامه می‌دهد. دلیل واگذاری در تاریخچه ثبت می‌شود.
          </DialogDescription>
          {transferCase && (
            <SourceResponsibilityPanel
              key={transferCase.id}
              proposal={transferCase}
              canManage={Boolean(canManage)}
              onUpdate={() => {
                setTransferId(null);
                setTransferred(true);
                void queryClient.invalidateQueries({
                  queryKey: ["operator-source-proposals"],
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </PageMain>
  );
}
