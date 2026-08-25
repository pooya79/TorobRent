import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { operatorModules } from "@/features/operator/modules";
import { currentUserQuery } from "@/features/session/queries";

export function OperatorOverviewPage() {
  const currentUser = useQuery(currentUserQuery);
  const capabilities = currentUser.data?.operator_capabilities ?? [];
  const availableModules = operatorModules.filter(
    ({ capabilities: required }) =>
      required.some((capability) => capabilities.includes(capability)),
  );

  return (
    <PageMain>
      <header className="mb-8">
        <p className="text-muted-foreground mb-2 text-sm">فضای اپراتور</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          نمای کلی مسئولیت‌ها
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl leading-7">
          فقط بخش‌هایی که برای این حساب فعال شده‌اند در دسترس‌اند.
        </p>
      </header>

      <section
        className="grid gap-4 md:grid-cols-2"
        aria-label="بخش‌های در دسترس"
      >
        {availableModules.map(({ description, icon: Icon, label, to }) => (
          <Card key={to} className="shadow-none">
            <CardHeader>
              <Icon className="text-primary size-7" aria-hidden="true" />
              <CardTitle className="mt-3">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-5 leading-7">
                {description}
              </p>
              <Link
                className="text-primary inline-flex min-h-11 items-center font-semibold"
                to={to}
              >
                ورود به بخش
              </Link>
            </CardContent>
          </Card>
        ))}
        <Card className="border-dashed shadow-none">
          <CardHeader>
            <Link2
              className="text-muted-foreground size-7"
              aria-hidden="true"
            />
            <CardTitle className="mt-3">بررسی پیوندها</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-5 leading-7">
              Link Verification برای آینده برنامه‌ریزی شده و هنوز گردش‌کار
              عملیاتی ندارد.
            </p>
            <Link
              className="text-primary inline-flex min-h-11 items-center font-semibold"
              to="/operator/links"
            >
              درباره این بخش
            </Link>
          </CardContent>
        </Card>
      </section>
    </PageMain>
  );
}

export default OperatorOverviewPage;
