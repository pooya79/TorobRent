import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SourceProposal } from "./queries";

export function CurrentWebsiteStatus({
  proposal,
}: {
  proposal: SourceProposal;
}) {
  if (proposal.current_website_conflict) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعارض وب‌سایت‌های جاری</AlertTitle>
        <AlertDescription>
          بیش از یک وب‌سایت جاری دارید. برای انتخاب وب‌سایتی که می‌خواهید ادامه
          دهید، با تیم بررسی تماس بگیرید.
          <Link className="underline" to="/messages">
            هماهنگی با اپراتور در مرکز پیام‌ها
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-2 text-sm">
      <p className="font-semibold">
        {proposal.is_current ? "وب‌سایت جاری شما" : "سابقه وب‌سایت"}
      </p>
      {proposal.assignment?.state === "active" ? (
        <>
          <details>
            <summary className="text-muted-foreground cursor-pointer">
              می‌خواهید وب‌سایت دیگری معرفی کنید؟
            </summary>
            <p className="mt-2">
              برای جایگزینی وب‌سایت، ابتدا با تیم بررسی هماهنگ کنید. پایان
              همکاری، نمایش آگهی‌های این وب‌سایت را متوقف می‌کند.
            </p>
            <Link className="underline" to="/messages">
              هماهنگی با اپراتور در مرکز پیام‌ها
            </Link>
          </details>
        </>
      ) : proposal.is_current ? (
        <p>
          {proposal.state === "pending"
            ? "اقدام بعدی: منتظر بررسی اپراتور بمانید. تا بسته شدن این پیشنهاد، وب‌سایت دیگری نمی‌توانید معرفی کنید."
            : proposal.state === "changes_requested"
              ? "اقدام بعدی: موارد خواسته‌شده را اصلاح و دوباره ارسال کنید."
              : "اقدام بعدی: معرفی همین وب‌سایت را تکمیل کنید. هر ارسال‌کننده فقط یک وب‌سایت جاری دارد."}
        </p>
      ) : (
        <p>
          {proposal.discarded_at
            ? "این پیش‌نویس حذف شده است و در سوابق باقی می‌ماند."
            : "این پرونده جای وب‌سایت جاری را اشغال نمی‌کند."}
        </p>
      )}
    </div>
  );
}
