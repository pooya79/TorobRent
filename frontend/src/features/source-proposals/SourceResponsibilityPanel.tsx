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
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  canManage: boolean;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const responsibility = proposal.responsibility;
  const mutation = useMutation({
    mutationFn: () =>
      reassignSourceResponsibility(proposal.id, {
        assignee_email: email.trim(),
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
  if (!responsibility || proposal.assignment?.state !== "active") return null;
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
        تصمیم‌های منبع به مسئول فعلی با اختیار بررسی منبع تعلق دارد. برای پذیرش
        مسئولیت، مدیر صف باید آن را به شما واگذار کند.
      </p>
      {canManage && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
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
          <Button
            type="submit"
            disabled={!email.trim() || !reason.trim() || mutation.isPending}
          >
            واگذاری مسئولیت منبع
          </Button>
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
      <details>
        <summary className="cursor-pointer">تاریخچه مسئولیت</summary>
        <ol className="mt-3 grid gap-3 text-sm">
          {responsibility.history.map((change) => (
            <li key={change.revision} className="grid gap-1 border-t pt-2">
              <time dateTime={change.created_at}>
                {new Date(change.created_at).toLocaleString("fa-IR")}
              </time>
              <p>{change.reason}</p>
              <p className="break-all">
                مسئول: {change.operator_label ?? "حساب حذف شده"}
              </p>
              <p className="break-all">
                ثبت‌کننده: {change.actor_label ?? "حساب حذف شده"}
              </p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
