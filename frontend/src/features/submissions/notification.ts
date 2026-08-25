import type { Submission } from "./queries";

type NotificationStatus = NonNullable<Submission["notification"]>["status"];

export function notificationAlertVariant(status: NotificationStatus) {
  return status === "failed" ? ("destructive" as const) : ("default" as const);
}

export function notificationStatusLabel(status: NotificationStatus) {
  if (status === "delivered") return "ایمیل ارسال شده است.";
  if (status === "failed") return "ارسال ایمیل ناموفق بود.";
  return "ایمیل در صف ارسال است.";
}
