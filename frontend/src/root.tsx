import {
  isRouteErrorResponse,
  Links,
  Meta,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { ProductShell } from "@/app/ProductShell";
import { RouteFocus } from "@/app/RouteFocus";
import type { Route } from "./+types/root";
import "./styles.css";

function isNotFoundError(error: unknown) {
  return isRouteErrorResponse(error) && error.status === 404;
}

export const meta: Route.MetaFunction = ({ error }) => {
  if (error) {
    const notFound = isNotFoundError(error);
    return [
      { title: notFound ? "صفحه پیدا نشد | ترب‌رنت" : "خطای سامانه | ترب‌رنت" },
      {
        name: "description",
        content: notFound
          ? "صفحه درخواستی در ترب‌رنت پیدا نشد."
          : "در بارگذاری ترب‌رنت مشکلی پیش آمد.",
      },
    ];
  }

  return [
    { title: "ترب‌رنت | جست‌وجوی خانه برای اجاره" },
    {
      name: "description",
      content: "جست‌وجو و مقایسه آگهی‌های اجاره خانه از چند منبع در ترب‌رنت.",
    },
  ];
};

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        <a
          className="bg-primary text-primary-foreground fixed start-3 top-3 z-50 min-h-11 -translate-y-24 rounded-lg px-4 py-3 text-sm font-semibold focus:translate-y-0"
          href="#main-content"
        >
          رفتن به محتوای اصلی
        </a>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const routeContent = <RouteFocus />;
  return (
    <AppProviders>
      {pathname === "/operator" || pathname.startsWith("/operator/") ? (
        routeContent
      ) : (
        <ProductShell>{routeContent}</ProductShell>
      )}
    </AppProviders>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isNotFoundError(error);
  const title = notFound ? "این صفحه پیدا نشد" : "مشکلی پیش آمد";
  const detail = notFound
    ? "ممکن است نشانی صفحه عوض شده باشد."
    : "لطفاً کمی بعد دوباره تلاش کنید.";

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen w-full max-w-360 items-center px-4 py-16 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <section className="border-border mx-auto w-full max-w-xl rounded-xl border p-8 text-center">
        <p className="text-primary mb-3 text-sm font-semibold">
          {notFound ? "خطای ۴۰۴" : "خطای سامانه"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-4">{detail}</p>
        <a
          className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold"
          href="/"
        >
          بازگشت به خانه
        </a>
      </section>
    </main>
  );
}
