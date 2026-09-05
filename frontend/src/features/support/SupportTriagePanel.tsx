import { ChoiceButtons } from "@/components/ChoiceButtons";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supportClassificationLabels } from "@/features/support/labels";
import type {
  SupportClassification,
  SupportPriority,
  SupportReassignmentInput,
  SupportRequest,
  SupportTriageInput,
} from "@/features/support/queries";

export function SupportTriagePanel({
  supportRequest,
  canManageQueue,
  isPending,
  onTriage,
  onReassign,
}: {
  supportRequest: SupportRequest;
  canManageQueue: boolean;
  isPending: boolean;
  onTriage: (input: SupportTriageInput) => void;
  onReassign: (input: SupportReassignmentInput) => void;
}) {
  const [classification, setClassification] = useState("");
  const [priority, setPriority] = useState("");
  const [routing, setRouting] = useState("");
  const [destination, setDestination] = useState("");
  const [requiredCapability, setRequiredCapability] = useState("");
  const [reason, setReason] = useState("");
  const [assigneeEmail, setAssigneeEmail] = useState("");
  const [reassignmentReason, setReassignmentReason] = useState("");

  const submitTriage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input: SupportTriageInput = {};
    if (classification) {
      input.classification = classification as SupportClassification;
    }
    if (priority) input.priority = priority as SupportPriority;
    if (routing === "escalated") {
      input.status = "escalated";
      if (destination) input.escalation_destination = destination;
      if (requiredCapability) {
        input.required_capability = requiredCapability as
          "handle_support" | "handle_privacy_requests";
      }
    }
    if (reason) input.reason = reason;
    onTriage(input);
  };

  const submitReassignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onReassign({ assignee_email: assigneeEmail, reason: reassignmentReason });
  };

  const hasTriageChange = Boolean(classification || priority || routing);
  const escalationHasRoute = Boolean(destination || requiredCapability);
  const currentlyPrivacyRestricted =
    supportRequest.classification === "privacy" ||
    supportRequest.classification === "account_deletion" ||
    (supportRequest.classification === "unclassified" &&
      (supportRequest.intake_kind === "account_deletion" ||
        supportRequest.intake_kind === "public_contact_removal"));
  const classificationNeedsReason = Boolean(
    classification &&
    (supportRequest.classification !== "unclassified" ||
      currentlyPrivacyRestricted ||
      classification === "privacy" ||
      classification === "account_deletion"),
  );
  const triageDisabled =
    isPending ||
    !hasTriageChange ||
    ((classificationNeedsReason ||
      priority === "urgent" ||
      routing === "escalated") &&
      !reason) ||
    (routing === "escalated" && !escalationHasRoute);

  return (
    <div className="space-y-4">
      <Card className="gap-4 rounded-2xl shadow-none">
        <CardHeader>
          <CardTitle className="text-base">دسته‌بندی و مسیر رسیدگی</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitTriage}>
            <div className="sm:col-span-2">
              <ChoiceButtons
                label="دسته‌بندی عملیاتی"
                name="triage-classification"
                value={classification}
                onChange={setClassification}
                options={[
                  ["", "بدون تغییر"],
                  ...Object.entries(supportClassificationLabels).filter(
                    ([value]) => value !== supportRequest.classification,
                  ),
                ]}
              />
            </div>
            <div className="sm:col-span-2">
              <ChoiceButtons
                label="اولویت"
                name="triage-priority"
                value={priority}
                onChange={setPriority}
                options={[
                  ["", "بدون تغییر"],
                  ...(supportRequest.priority !== "urgent"
                    ? [["urgent", "فوری"] as const]
                    : !supportRequest.priority_locked
                      ? [["normal", "عادی"] as const]
                      : []),
                ]}
              />
              {supportRequest.priority_locked && (
                <p className="text-muted-foreground mt-2 text-xs">
                  اولویت این درخواست قابل کاهش نیست.
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <ChoiceButtons
                label="مسیر رسیدگی"
                name="triage-routing"
                value={routing}
                onChange={setRouting}
                options={[
                  ["", "بدون تغییر"],
                  ...(supportRequest.status !== "escalated"
                    ? [["escalated", "ارجاع تخصصی"] as const]
                    : []),
                ]}
              />
            </div>
            {routing === "escalated" && (
              <div className="bg-muted/40 space-y-4 rounded-xl border p-4 sm:col-span-2">
                <ChoiceButtons
                  label="تخصص مورد نیاز"
                  name="triage-capability"
                  value={requiredCapability}
                  onChange={setRequiredCapability}
                  options={[
                    ["", "تعیین نشده"],
                    ["handle_support", "پشتیبانی عمومی"],
                    ["handle_privacy_requests", "پشتیبانی حریم خصوصی"],
                  ]}
                />
                <Label className="grid gap-2">
                  مقصد ارجاع
                  <Input
                    className="rounded-xl"
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                  />
                </Label>
              </div>
            )}
            <Label className="grid gap-2 sm:col-span-2">
              دلیل تغییر
              <textarea
                className="border-input bg-background mt-1 min-h-24 w-full rounded-xl border px-3 py-2"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Label>
            <div className="flex flex-wrap items-center gap-3 border-t pt-4 sm:col-span-2">
              <Button
                className="rounded-xl"
                disabled={triageDisabled}
                type="submit"
                variant="outline"
              >
                ثبت تغییرات رسیدگی
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {canManageQueue &&
        supportRequest.status === "in_progress" &&
        supportRequest.assignee_id && (
          <Card className="gap-4 rounded-2xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base">
                واگذاری مجدد کار رهاشده
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={submitReassignment}
              >
                <Label className="grid gap-2">
                  ایمیل مسئول جدید
                  <Input
                    required
                    type="email"
                    value={assigneeEmail}
                    onChange={(event) => setAssigneeEmail(event.target.value)}
                  />
                </Label>
                <Label className="grid gap-2">
                  دلیل واگذاری مجدد
                  <Input
                    required
                    value={reassignmentReason}
                    onChange={(event) =>
                      setReassignmentReason(event.target.value)
                    }
                  />
                </Label>
                <div className="flex flex-wrap items-center gap-3 border-t pt-4 sm:col-span-2">
                  <Button disabled={isPending} type="submit" variant="outline">
                    واگذاری مجدد
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
