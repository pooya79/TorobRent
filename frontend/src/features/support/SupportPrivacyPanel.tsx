import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  SupportIdentityVerificationInput,
  SupportPrivacyActionInput,
  SupportRequest,
} from "@/features/support/queries";

const fieldClass =
  "border-input bg-background mt-1 min-h-24 w-full rounded-md border px-3 py-2 text-sm";
const selectClass =
  "border-input bg-background mt-1 h-11 w-full rounded-md border px-3";

function isoTimestamp(localTimestamp: string) {
  return new Date(localTimestamp).toISOString();
}

export function SupportPrivacyPanel({
  canRecord,
  isPending,
  onRecordIdentityVerification,
  onRecordPrivacyAction,
  supportRequest,
}: {
  canRecord: boolean;
  isPending: boolean;
  onRecordIdentityVerification: (
    input: SupportIdentityVerificationInput,
  ) => void;
  onRecordPrivacyAction: (input: SupportPrivacyActionInput) => void;
  supportRequest: SupportRequest;
}) {
  const [verificationTime, setVerificationTime] = useState("");
  const [verificationSummary, setVerificationSummary] = useState("");
  const [privacyAction, setPrivacyAction] = useState(
    "defensive_contact_removal",
  );
  const [privacyActionTime, setPrivacyActionTime] = useState("");
  const [privacyActionSummary, setPrivacyActionSummary] = useState("");
  const isPrivacyWork =
    supportRequest.classification === "privacy" ||
    supportRequest.classification === "account_deletion" ||
    (supportRequest.classification === "unclassified" &&
      (supportRequest.intake_kind === "account_deletion" ||
        supportRequest.intake_kind === "public_contact_removal"));

  function submitVerification(event: FormEvent) {
    event.preventDefault();
    onRecordIdentityVerification({
      method: "out_of_band",
      verified_at: isoTimestamp(verificationTime),
      summary: verificationSummary,
    });
    setVerificationSummary("");
  }

  function submitPrivacyAction(event: FormEvent) {
    event.preventDefault();
    onRecordPrivacyAction({
      action: privacyAction as SupportPrivacyActionInput["action"],
      completed_at: isoTimestamp(privacyActionTime),
      summary: privacyActionSummary,
    });
    setPrivacyActionSummary("");
  }

  return (
    <>
      {(supportRequest.identity_verifications ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">سوابق تأیید هویت</h3>
          <ol className="mt-2 space-y-2">
            {(supportRequest.identity_verifications ?? []).map(
              (verification) => (
                <li
                  className="bg-muted rounded-lg p-3 text-sm"
                  key={verification.id}
                >
                  <p>{verification.summary}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {verification.actor_label} ·{" "}
                    {new Date(verification.verified_at).toLocaleString("fa-IR")}
                  </p>
                </li>
              ),
            )}
          </ol>
        </div>
      )}

      {(supportRequest.privacy_actions ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">
            اقدام‌های حریم خصوصی ثبت‌شده
          </h3>
          <ol className="mt-2 space-y-2">
            {(supportRequest.privacy_actions ?? []).map((privacyRecord) => (
              <li
                className="bg-muted rounded-lg p-3 text-sm"
                key={privacyRecord.id}
              >
                <p>{privacyRecord.summary}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {privacyRecord.action} · {privacyRecord.actor_label} ·{" "}
                  {new Date(privacyRecord.completed_at).toLocaleString("fa-IR")}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {canRecord && isPrivacyWork && (
        <div className="border-border grid gap-5 rounded-lg border p-4 lg:grid-cols-2">
          <form onSubmit={submitVerification}>
            <h3 className="font-semibold">تأیید هویت خارج از سامانه</h3>
            {supportRequest.account_linked_at_intake && (
              <p className="text-muted-foreground mt-1 text-xs">
                درخواست هنگام ثبت به حساب احراز‌شده متصل بوده است.
              </p>
            )}
            <Label className="mt-3 block">
              زمان تأیید هویت
              <Input
                required
                type="datetime-local"
                value={verificationTime}
                onChange={(event) => setVerificationTime(event.target.value)}
              />
            </Label>
            <Label className="mt-3 block">
              خلاصه تأیید هویت
              <textarea
                className={fieldClass}
                maxLength={1000}
                required
                value={verificationSummary}
                onChange={(event) => setVerificationSummary(event.target.value)}
              />
            </Label>
            <Button className="mt-3" disabled={isPending} type="submit">
              ثبت تأیید هویت
            </Button>
          </form>

          <form onSubmit={submitPrivacyAction}>
            <h3 className="font-semibold">ثبت تکمیل اقدام حریم خصوصی</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              اقدام دائمی در Django admin انجام می‌شود؛ این فرم فقط تکمیل آن را
              ثبت می‌کند.
            </p>
            <Label className="mt-3 block">
              نوع اقدام ثبت‌شده
              <select
                className={selectClass}
                value={privacyAction}
                onChange={(event) => setPrivacyAction(event.target.value)}
              >
                <option value="defensive_contact_removal">
                  حذف دفاعی اطلاعات تماس
                </option>
                <option value="permanent_account_action">
                  اقدام دائمی حساب
                </option>
              </select>
            </Label>
            <Label className="mt-3 block">
              زمان تکمیل اقدام
              <Input
                required
                type="datetime-local"
                value={privacyActionTime}
                onChange={(event) => setPrivacyActionTime(event.target.value)}
              />
            </Label>
            <Label className="mt-3 block">
              خلاصه اقدام تکمیل‌شده
              <textarea
                className={fieldClass}
                maxLength={1000}
                required
                value={privacyActionSummary}
                onChange={(event) =>
                  setPrivacyActionSummary(event.target.value)
                }
              />
            </Label>
            <Button className="mt-3" disabled={isPending} type="submit">
              ثبت تکمیل اقدام
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
