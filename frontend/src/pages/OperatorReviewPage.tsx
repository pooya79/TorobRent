import {
  Check,
  Clock3,
  FileWarning,
  MessageSquareWarning,
  ShieldX,
  UserRound,
} from "lucide-react";
import { useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { prototypeRepository } from "@/features/prototype/fixtures";

export function OperatorReviewPage() {
  const [searchParams] = useSearchParams();
  const reviewQueue = prototypeRepository.getReviewQueue();
  const reviewFacts = prototypeRepository.getReviewFacts();
  const reviewHistory = prototypeRepository.getReviewHistory();
  const reviewSummary = prototypeRepository.getReviewSummary();

  if (searchParams.get("prototypeState") === "permission") {
    return (
      <main
        id="main-content"
        className="mx-auto flex min-h-[70vh] w-full max-w-360 items-center px-4 py-16 sm:px-6 lg:px-10"
        tabIndex={-1}
      >
        <Card className="mx-auto max-w-lg text-center shadow-none">
          <CardContent className="flex flex-col items-center py-8">
            <span className="bg-muted mb-5 flex size-14 items-center justify-center rounded-full">
              <ShieldX className="size-6" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-semibold">دسترسی اپراتور لازم است</h1>
            <p className="text-muted-foreground mt-3 leading-7">
              این صف فقط برای کارکنانی نمایش داده می‌شود که مجوز بررسی آگهی‌ها
              را دارند.
            </p>
            <Button className="mt-6" variant="outline">
              بازگشت به خانه
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-360 px-4 py-8 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm">فضای اپراتور</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            صف بررسی آگهی‌ها
          </h1>
          <p className="text-muted-foreground mt-2">
            {reviewSummary.pendingCountLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">همه وضعیت‌ها</Button>
          <Button variant="outline">قدیمی‌ترین ابتدا</Button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
        <section className="space-y-3" aria-label="صف ارسال‌ها">
          {reviewQueue.map(({ title, role, time }, index) => (
            <button
              className={`border-border hover:bg-muted focus-visible:ring-ring min-h-24 w-full rounded-xl border p-4 text-start transition-colors focus-visible:ring-2 ${index === 0 ? "border-primary bg-primary/5" : "bg-card"}`}
              key={title}
              type="button"
            >
              <span className="mb-2 flex items-center justify-between gap-2 font-semibold">
                {title}
                {index === 0 && <Badge>در حال بررسی</Badge>}
              </span>
              <span className="text-muted-foreground flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <UserRound className="size-3" aria-hidden="true" /> {role}
                </span>
                <span className="flex items-center gap-1">
                  <Clock3 className="size-3" aria-hidden="true" /> {time}
                </span>
              </span>
            </button>
          ))}
        </section>

        <Card className="shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl">{reviewSummary.title}</CardTitle>
                <p className="text-muted-foreground mt-2 text-sm">
                  {reviewSummary.sourceLabel}
                </p>
              </div>
              <Badge variant="secondary">{reviewSummary.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert variant="destructive">
              <FileWarning aria-hidden="true" />
              <AlertTitle>{reviewSummary.warningTitle}</AlertTitle>
              <AlertDescription>{reviewSummary.warningDetail}</AlertDescription>
            </Alert>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {reviewFacts.map(([term, value]) => (
                <div className="bg-muted rounded-lg p-4" key={term}>
                  <dt className="text-muted-foreground text-xs">{term}</dt>
                  <dd className="mt-1 font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <Separator />
            <div className="flex flex-wrap justify-end gap-3">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <MessageSquareWarning aria-hidden="true" /> درخواست اصلاح
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader className="text-start">
                    <AlertDialogTitle>
                      درخواست اصلاح ارسال شود؟
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      ثبت‌کننده دلیل بازگشت آگهی را می‌بیند و می‌تواند نسخه
                      اصلاح‌شده را دوباره ارسال کند.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="gap-2 sm:space-x-0">
                    <AlertDialogCancel>انصراف</AlertDialogCancel>
                    <AlertDialogAction>ارسال درخواست اصلاح</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button>
                    <Check aria-hidden="true" /> تأیید و انتشار
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader className="text-start">
                    <AlertDialogTitle>آگهی منتشر شود؟</AlertDialogTitle>
                    <AlertDialogDescription>
                      پس از تأیید، اطلاعات ملک و آگهی برای اجاره‌کنندگان قابل
                      مشاهده می‌شود.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="gap-2 sm:space-x-0">
                    <AlertDialogCancel>انصراف</AlertDialogCancel>
                    <AlertDialogAction>تأیید نهایی و انتشار</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>

        <aside aria-labelledby="status-history-title">
          <h2 id="status-history-title" className="mb-4 text-lg font-semibold">
            تاریخچه وضعیت
          </h2>
          <ol className="border-border space-y-6 border-s ps-5 text-sm">
            {reviewHistory.map(([event, time]) => (
              <li key={event}>
                <p className="font-semibold">{event}</p>
                <p className="text-muted-foreground mt-1">{time}</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}

export default OperatorReviewPage;
