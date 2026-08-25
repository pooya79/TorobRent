import { Headphones } from "lucide-react";

import { PageMain } from "@/components/layout/PageMain";
import { Card, CardContent } from "@/components/ui/card";
import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";

export default function OperatorSupportRoute() {
  return (
    <OperatorCapabilityRoute
      capability={["handle_support", "handle_privacy_requests"]}
    >
      <PageMain>
        <header className="mb-6">
          <p className="text-muted-foreground mb-2 text-sm">فضای اپراتور</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            درخواست‌های پشتیبانی
          </h1>
        </header>
        <Card className="shadow-none">
          <CardContent className="flex flex-col items-start py-8">
            <Headphones
              className="text-primary mb-4 size-8"
              aria-hidden="true"
            />
            <h2 className="text-xl font-semibold">مسیر پشتیبانی آماده است</h2>
            <p className="text-muted-foreground mt-3 max-w-2xl leading-7">
              تا تکمیل برابری گردش‌کار React، رسیدگی عملیاتی موجود فقط به‌عنوان
              مسیر پشتیبانِ دارای دسترسی در Django admin باقی می‌ماند.
            </p>
          </CardContent>
        </Card>
      </PageMain>
    </OperatorCapabilityRoute>
  );
}
