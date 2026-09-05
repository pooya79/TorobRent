import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SupportFinalizationPanel } from "@/features/support/SupportFinalizationPanel";
import { SupportPrivacyPanel } from "@/features/support/SupportPrivacyPanel";
import type {
  SupportExternalContactInput,
  SupportIdentityVerificationInput,
  SupportNoteInput,
  SupportPrivacyActionInput,
  SupportReopenInput,
  SupportRequest,
  SupportResolutionInput,
} from "@/features/support/queries";

const fieldClass =
  "border-input bg-background mt-1 min-h-24 w-full rounded-xl border px-3 py-2 text-sm";
const selectClass =
  "border-input bg-background mt-1 h-11 w-full rounded-xl border px-3";

function isoTimestamp(localTimestamp: string) {
  return new Date(localTimestamp).toISOString();
}

export function SupportResolutionPanel({
  isAssignee,
  isPending,
  onAddNote,
  onRecordExternalContact,
  onRecordIdentityVerification,
  onRecordPrivacyAction,
  onReopen,
  onResolve,
  supportRequest,
}: {
  isAssignee: boolean;
  isPending: boolean;
  onAddNote: (input: SupportNoteInput) => void;
  onRecordExternalContact: (input: SupportExternalContactInput) => void;
  onRecordIdentityVerification: (
    input: SupportIdentityVerificationInput,
  ) => void;
  onRecordPrivacyAction: (input: SupportPrivacyActionInput) => void;
  onReopen: (input: SupportReopenInput) => void;
  onResolve: (input: SupportResolutionInput) => void;
  supportRequest: SupportRequest;
}) {
  const [note, setNote] = useState("");
  const [correctsNote, setCorrectsNote] = useState<string>();
  const [contactChannel, setContactChannel] = useState("email");
  const [contactTime, setContactTime] = useState("");
  const [contactOutcome, setContactOutcome] = useState("");
  const [contactSummary, setContactSummary] = useState("");
  const canRecord = supportRequest.status === "in_progress" && isAssignee;

  function submitNote(event: FormEvent) {
    event.preventDefault();
    const input: SupportNoteInput = { body: note };
    if (correctsNote) input.corrects_note = correctsNote;
    onAddNote(input);
    setNote("");
    setCorrectsNote(undefined);
  }

  return (
    <section className="space-y-6" aria-labelledby="support-resolution-title">
      <div>
        <h2 id="support-resolution-title" className="font-semibold">
          سوابق و نتیجه رسیدگی
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          این بخش فقط سابقه داخلی و ارتباط انجام‌شده بیرون از ترب‌رنت را ثبت
          می‌کند؛ پیامی برای درخواست‌کننده ارسال نمی‌شود.
        </p>
      </div>

      {canRecord && (
        <div className="grid gap-5 lg:grid-cols-2">
          <form
            className="border-border rounded-lg border p-4"
            onSubmit={submitNote}
          >
            <Label className="grid gap-2">
              یادداشت داخلی
              <textarea
                className={fieldClass}
                maxLength={2000}
                required
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Label>
            {correctsNote && (
              <p className="text-muted-foreground mt-2 text-xs">
                این یادداشت، اصلاحیه یادداشت انتخاب‌شده است.
              </p>
            )}
            <Button
              className="mt-4 rounded-xl"
              disabled={isPending}
              type="submit"
              variant="outline"
            >
              ثبت یادداشت
            </Button>
          </form>

          <form
            className="border-border rounded-lg border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              onRecordExternalContact({
                channel:
                  contactChannel as SupportExternalContactInput["channel"],
                occurred_at: isoTimestamp(contactTime),
                outcome: contactOutcome,
                summary: contactSummary,
              });
              setContactOutcome("");
              setContactSummary("");
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Label className="grid gap-2">
                کانال ارتباط بیرونی
                <select
                  className={selectClass}
                  value={contactChannel}
                  onChange={(event) => setContactChannel(event.target.value)}
                >
                  <option value="email">ایمیل</option>
                  <option value="phone">تلفن</option>
                  <option value="in_person">حضوری</option>
                  <option value="other">سایر</option>
                </select>
              </Label>
              <Label className="grid gap-2">
                زمان ارتباط بیرونی
                <Input
                  required
                  type="datetime-local"
                  value={contactTime}
                  onChange={(event) => setContactTime(event.target.value)}
                />
              </Label>
            </div>
            <Label className="mt-3 grid gap-2">
              نتیجه ارتباط بیرونی
              <Input
                maxLength={120}
                required
                value={contactOutcome}
                onChange={(event) => setContactOutcome(event.target.value)}
              />
            </Label>
            <Label className="mt-3 grid gap-2">
              خلاصه ارتباط بیرونی
              <textarea
                className={fieldClass}
                maxLength={1000}
                required
                value={contactSummary}
                onChange={(event) => setContactSummary(event.target.value)}
              />
            </Label>
            <Button
              className="mt-4 rounded-xl"
              disabled={isPending}
              type="submit"
              variant="outline"
            >
              ثبت خلاصه ارتباط
            </Button>
          </form>
        </div>
      )}

      {(supportRequest.notes ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">یادداشت‌های داخلی</h3>
          <ol className="mt-2 space-y-2">
            {(supportRequest.notes ?? []).map((item) => (
              <li className="bg-muted rounded-lg p-3 text-sm" key={item.id}>
                <p className="whitespace-pre-wrap">{item.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {item.actor_label} ·{" "}
                  {new Date(item.created_at).toLocaleString("fa-IR")}
                </p>
                {canRecord && (
                  <Button
                    className="mt-2 h-auto p-0"
                    onClick={() => setCorrectsNote(item.id)}
                    type="button"
                    variant="link"
                  >
                    ثبت اصلاحیه
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(supportRequest.external_contacts ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">خلاصه‌های ارتباط بیرونی</h3>
          <ol className="mt-2 space-y-2">
            {(supportRequest.external_contacts ?? []).map((contact) => (
              <li className="bg-muted rounded-lg p-3 text-sm" key={contact.id}>
                <p>{contact.summary}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {contact.channel} · {contact.outcome} · {contact.actor_label}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <SupportPrivacyPanel
        canRecord={canRecord}
        isPending={isPending}
        onRecordIdentityVerification={onRecordIdentityVerification}
        onRecordPrivacyAction={onRecordPrivacyAction}
        supportRequest={supportRequest}
      />

      <SupportFinalizationPanel
        canRecord={canRecord}
        isPending={isPending}
        onReopen={onReopen}
        onResolve={onResolve}
        supportRequest={supportRequest}
      />
    </section>
  );
}
