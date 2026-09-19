import { CaseRecords } from "./CaseRecords";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api/errors";
import {
  reassignSourceResponsibility,
  type OperatorSourceProposal,
} from "./queries";

export function SourceResponsibilityPanel({
  proposal,
  canManage,
  canRelease = false,
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  canManage: boolean;
  canRelease?: boolean;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const responsibility = proposal.responsibility;
  const mutation = useMutation({
    mutationFn: (release: boolean) =>
      reassignSourceResponsibility(proposal.id, {
        assignee_email: release ? null : email.trim(),
        reason: reason.trim(),
        reviewed_responsibility_revision: responsibility?.revision ?? 0,
      }),
    onSuccess: (updated) => {
      setEmail("");
      setReason("");
      onUpdate(updated);
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
    },
  });
  if (!responsibility) return null;
  return (
    <section
      aria-label="مسئولیت منبع"
      className="grid gap-3 rounded-lg border p-4"
    >
      <h3 className="font-semibold">اپراتور مسئول منبع</h3>
      <p dir="ltr" className="text-start break-all">
        {responsibility.operator_label ?? "مسئول تعیین نشده است"}
      </p>
      <p className="text-muted-foreground text-sm">
        مسئولیت از پذیرش پرونده تا بررسی و نگهداری منبع ادامه دارد و منقضی
        نمی‌شود. مسئول می‌تواند مسئولیت خود را آزاد کند؛ مدیر صف می‌تواند
        مسئولیت را واگذار یا آزاد کند.
      </p>
      {(canManage || canRelease) && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(!canManage);
          }}
        >
          {canManage && (
            <>
              <Label htmlFor={`responsible-email-${proposal.id}`}>
                ایمیل اپراتور مقصد
              </Label>
              <Input
                id={`responsible-email-${proposal.id}`}
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </>
          )}
          <Label htmlFor={`responsible-reason-${proposal.id}`}>
            دلیل تغییر مسئول
          </Label>
          <Input
            id={`responsible-reason-${proposal.id}`}
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {canManage && (
            <Button
              type="submit"
              disabled={!email.trim() || !reason.trim() || mutation.isPending}
            >
              واگذاری مسئولیت منبع
            </Button>
          )}
          {responsibility.operator && (
            <Button
              type="button"
              variant="outline"
              disabled={!reason.trim() || mutation.isPending}
              onClick={() => mutation.mutate(true)}
            >
              آزادسازی مسئولیت منبع
            </Button>
          )}
        </form>
      )}
      {mutation.error && (
        <p role="alert">
          {errorMessage(
            mutation.error,
            "تغییر مسئول ممکن نشد؛ پرونده را تازه کنید.",
          )}
        </p>
      )}
      <details onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer">تاریخچه مسئولیت</summary>
        {historyOpen && (
          <CaseRecords kind="responsibility-history" proposalId={proposal.id}>
            {(rows) => (
              <ol className="mt-3 grid gap-3 text-sm">
                {rows.map((change) => (
                  <li
                    key={change.revision}
                    className="grid gap-1 border-t pt-2"
                  >
                    <time dateTime={change.created_at}>
                      {new Date(change.created_at).toLocaleString("fa-IR")}
                    </time>
                    <p>{change.reason}</p>
                    <p className="break-all">
                      مسئول: {change.operator_label ?? "بدون مسئول"}
                    </p>
                    <p className="break-all">
                      ثبت‌کننده: {change.actor_label ?? "حساب حذف شده"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CaseRecords>
        )}
      </details>
    </section>
  );
}
