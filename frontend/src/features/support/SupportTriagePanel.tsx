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

const selectClassName =
  "border-input bg-background mt-1 h-11 w-full rounded-md border px-3";

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
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">تریاژ و مسیر‌دهی</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitTriage}>
            <Label>
              دسته‌بندی عملیاتی
              <select
                className={selectClassName}
                value={classification}
                onChange={(event) => setClassification(event.target.value)}
              >
                <option value="">بدون تغییر</option>
                {Object.entries(supportClassificationLabels)
                  .filter(([value]) => value !== supportRequest.classification)
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </Label>
            <Label>
              اولویت
              <select
                className={selectClassName}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="">بدون تغییر</option>
                {supportRequest.priority !== "urgent" ? (
                  <option value="urgent">فوری</option>
                ) : (
                  !supportRequest.priority_locked && (
                    <option value="normal">عادی</option>
                  )
                )}
              </select>
            </Label>
            <Label>
              مسیر‌دهی تخصصی
              <select
                className={selectClassName}
                value={routing}
                onChange={(event) => setRouting(event.target.value)}
              >
                <option value="">بدون تغییر</option>
                {supportRequest.status !== "escalated" && (
                  <option value="escalated">ارجاع تخصصی</option>
                )}
              </select>
            </Label>
            <Label>
              قابلیت مورد نیاز
              <select
                className={selectClassName}
                disabled={routing !== "escalated"}
                value={requiredCapability}
                onChange={(event) => setRequiredCapability(event.target.value)}
              >
                <option value="">تعیین نشده</option>
                <option value="handle_support">پشتیبانی عمومی</option>
                <option value="handle_privacy_requests">
                  پشتیبانی حریم خصوصی
                </option>
              </select>
            </Label>
            <Label className="sm:col-span-2">
              مقصد ارجاع
              <Input
                disabled={routing !== "escalated"}
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
            </Label>
            <Label className="sm:col-span-2">
              دلیل تریاژ
              <textarea
                className="border-input bg-background mt-1 min-h-24 w-full rounded-md border px-3 py-2"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Label>
            <div className="flex justify-end sm:col-span-2">
              <Button disabled={triageDisabled} type="submit">
                ثبت تریاژ
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {canManageQueue &&
        supportRequest.status === "in_progress" &&
        supportRequest.assignee_id && (
          <Card className="shadow-none">
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
                <Label>
                  ایمیل مسئول جدید
                  <Input
                    required
                    type="email"
                    value={assigneeEmail}
                    onChange={(event) => setAssigneeEmail(event.target.value)}
                  />
                </Label>
                <Label>
                  دلیل واگذاری مجدد
                  <Input
                    required
                    value={reassignmentReason}
                    onChange={(event) =>
                      setReassignmentReason(event.target.value)
                    }
                  />
                </Label>
                <div className="flex justify-end sm:col-span-2">
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
