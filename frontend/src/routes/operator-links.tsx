import { Link2 } from "lucide-react";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function OperatorLinksRoute() {
  return (
    <PageMain>
      <header className="mb-6">
        <p className="text-muted-foreground mb-2 text-sm">فضای اپراتور</p>
        <h1 className="text-3xl font-semibold tracking-tight">بررسی پیوندها</h1>
      </header>
      <Alert>
        <Link2 className="size-5" aria-hidden="true" />
        <AlertTitle>این بخش برنامه‌ریزی شده است</AlertTitle>
        <AlertDescription>
          هنوز گردش‌کار، صف یا بررسی خودکاری برای Link Verification ساخته نشده
          است. این صفحه فقط محدوده آینده را معرفی می‌کند و داده عملیاتی نمایش
          نمی‌دهد.
        </AlertDescription>
      </Alert>
    </PageMain>
  );
}
