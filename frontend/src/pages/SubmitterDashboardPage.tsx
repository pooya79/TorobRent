import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Plus,
} from "lucide-react";
import { useSearchParams } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { prototypeRepository } from "@/features/prototype/fixtures";

const submissionState = {
  "needs-change": { icon: AlertCircle, tone: "destructive" as const },
  pending: { icon: Clock3, tone: "secondary" as const },
  published: { icon: CheckCircle2, tone: "secondary" as const },
};

export function SubmitterDashboardPage() {
  const [searchParams] = useSearchParams();
  const submissions = prototypeRepository.getSubmissions();
  const selectedSubmission = submissions.find(
    (submission) => submission.id === searchParams.get("submission"),
  );

  return (
    <PageMain>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm">پنل ثبت‌کننده</p>
          <h1 className="text-3xl font-semibold tracking-tight">آگهی‌های من</h1>
          <p className="text-muted-foreground mt-2">
            وضعیت ارسال‌ها و اقدام بعدی را یک‌جا دنبال کنید.
          </p>
        </div>
        <Button asChild className="rounded-full">
          <a href="/add-submission">
            <Plus aria-hidden="true" /> ثبت آگهی تازه
          </a>
        </Button>
      </header>

      {selectedSubmission && (
        <Card className="border-primary mb-6 shadow-none">
          <CardContent className="space-y-3">
            <h2 className="text-lg font-semibold">
              جزئیات ارسال {selectedSubmission.title}
            </h2>
            <p>{selectedSubmission.detail}</p>
            <p className="text-muted-foreground text-sm">
              {selectedSubmission.time}
            </p>
            <p className="text-sm font-semibold">
              گام بعدی: منتظر بررسی اپراتور بمانید.
            </p>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4" aria-label="ارسال‌های شما">
        {submissions.map((submission) => {
          const { icon: Icon, tone } = submissionState[submission.state];
          return (
            <Card className="shadow-none" key={submission.title}>
              <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-full">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <h2 className="font-semibold">{submission.title}</h2>
                    <Badge variant={tone}>{submission.status}</Badge>
                  </div>
                  <p className="text-sm">{submission.detail}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {submission.time}
                  </p>
                </div>
                <Button asChild variant="outline">
                  <a href={submission.href} aria-label={submission.action}>
                    مشاهده <ArrowLeft aria-hidden="true" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </PageMain>
  );
}

export default SubmitterDashboardPage;
