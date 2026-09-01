import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  claimSourceProposal,
  decideSourceProposal,
  operatorSourceProposalsQueryOptions,
  type OperatorSourceProposal,
} from "@/features/source-proposals/queries";
import { errorMessage } from "@/lib/api/errors";

const relationshipLabels = {
  website_owner: "مالک وب‌سایت",
  website_manager: "مدیر وب‌سایت",
  authorized_representative: "نماینده مجاز",
};

const inventoryLabels = {
  "1_10": "۱ تا ۱۰",
  "11_50": "۱۱ تا ۵۰",
  "51_200": "۵۱ تا ۲۰۰",
  more_than_200: "بیش از ۲۰۰",
  unknown: "نامشخص",
};

function ProposalReviewCard({
  proposal,
  onDecisionSuccess,
}: {
  proposal: OperatorSourceProposal;
  onDecisionSuccess: (proposalId: string) => void;
}) {
  const [claimed, setClaimed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const claim = useMutation({
    mutationFn: () => claimSourceProposal(proposal.id),
    onSuccess: () => setClaimed(true),
  });
  const decision = useMutation({
    mutationFn: ({
      kind,
      reason,
    }: {
      kind: "request-changes" | "reject" | "approve";
      reason: string;
    }) => decideSourceProposal(proposal.id, kind, proposal.revision, reason),
    onSuccess: () => onDecisionSuccess(proposal.id),
  });

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{proposal.website_name}</h2>
          <Badge variant="secondary">
            نسخه {proposal.revision.toLocaleString("fa-IR")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        {proposal.needs_reconciliation && (
          <Alert>
            <AlertTitle>دامنه تکراری نیازمند تطبیق خصوصی است</AlertTitle>
            <AlertDescription>
              این علامت فقط برای اپراتور نمایش داده می‌شود؛ هویت پیشنهاد دیگر
              افشا نمی‌شود.
            </AlertDescription>
          </Alert>
        )}
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail
            label="نشانی وب‌سایت"
            value={proposal.website_url || "ثبت نشده"}
          />
          <Detail
            label="رابطه نماینده"
            value={
              proposal.relationship
                ? relationshipLabels[proposal.relationship] ||
                  proposal.relationship
                : "ثبت نشده"
            }
          />
          <Detail
            label="موجودی تقریبی"
            value={
              proposal.inventory_range
                ? inventoryLabels[proposal.inventory_range] ||
                  proposal.inventory_range
                : "ثبت نشده"
            }
          />
          <Detail
            label="نقشه یا خوراک"
            value={proposal.sitemap_url || "ثبت نشده"}
          />
          <Detail
            label="اعلام اختیار"
            value={proposal.authority_declared ? "تأیید شده" : "تأیید نشده"}
          />
          <Detail
            label="یادداشت برای اپراتور"
            value={proposal.operator_note || "ثبت نشده"}
          />
        </dl>
        {proposal.preview && (
          <section
            aria-label="زمینه کشف شبیه‌سازی‌شده"
            className="rounded-lg border p-4"
          >
            <h3 className="font-semibold">{proposal.preview.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm">
              {proposal.preview.disclaimer}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Detail
                label="تعداد تخمینی کشف"
                value={
                  proposal.preview.estimated_count === null
                    ? "نامشخص"
                    : proposal.preview.estimated_count.toLocaleString("fa-IR")
                }
              />
              <Detail
                label="بازه موجودی شبیه‌سازی‌شده"
                value={inventoryLabels[proposal.preview.inventory_range]}
              />
            </dl>
            <ul
              className="mt-4 grid gap-2"
              aria-label="نمونه‌های کشف شبیه‌سازی‌شده"
            >
              {proposal.preview.examples.map((example) => (
                <li className="rounded-md border p-3" key={example.title}>
                  <p className="font-medium">{example.title}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {example.status}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!claimed ? (
          <Button onClick={() => claim.mutate()} disabled={claim.isPending}>
            شروع بررسی
          </Button>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              decision.mutate({ kind: "request-changes", reason });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor={`reason-${proposal.id}`}>دلیل تصمیم</Label>
              <Input
                id={`reason-${proposal.id}`}
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              تأیید می‌کنم که این تصمیم فقط Source را اعتبارسنجی می‌کند و
              Listingی منتشر نمی‌شود.
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="outline"
                disabled={decision.isPending}
              >
                درخواست اصلاح
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={decision.isPending}
                onClick={() => decision.mutate({ kind: "reject", reason })}
              >
                رد پیشنهاد
              </Button>
              <Button
                type="button"
                disabled={!confirmed || decision.isPending}
                onClick={() => decision.mutate({ kind: "approve", reason: "" })}
              >
                تأیید Source
              </Button>
            </div>
          </form>
        )}
        {(claim.error || decision.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(
                claim.error ?? decision.error,
                "ثبت عملیات ممکن نشد.",
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

export function OperatorSourceProposalPage() {
  const queryClient = useQueryClient();
  const [completed, setCompleted] = useState(false);
  const proposals = useQuery(operatorSourceProposalsQueryOptions);
  const removeCompletedProposal = (proposalId: string) => {
    queryClient.setQueryData<OperatorSourceProposal[]>(
      operatorSourceProposalsQueryOptions.queryKey,
      (current) => current?.filter((proposal) => proposal.id !== proposalId),
    );
    setCompleted(true);
  };
  return (
    <PageMain>
      <header className="mb-8">
        <p className="text-primary text-sm font-semibold">فضای اپراتور</p>
        <h1 className="mt-2 text-3xl font-semibold">
          اعتبارسنجی Source Proposalها
        </h1>
      </header>
      {proposals.isPending && <p role="status">در حال بارگذاری…</p>}
      {proposals.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            صف Source Proposalها بارگذاری نشد.
          </AlertDescription>
        </Alert>
      )}
      {completed && <p role="status">تصمیم ثبت شد.</p>}
      {proposals.data?.length === 0 && (
        <p>Source Proposal در انتظار بررسی وجود ندارد.</p>
      )}
      <div className="grid gap-6">
        {proposals.data?.map((proposal) => (
          <ProposalReviewCard
            key={proposal.id}
            proposal={proposal}
            onDecisionSuccess={removeCompletedProposal}
          />
        ))}
      </div>
    </PageMain>
  );
}
