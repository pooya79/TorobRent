import {
  isRouteErrorResponse,
  Links,
  Meta,
  Scripts,
  ScrollRestoration,
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
        <meta name="theme-color" content="#167c54" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
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
  return (
    <AppProviders>
      <ProductShell>
        <RouteFocus />
      </ProductShell>
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
    <main id="main-content" className="error-page" tabIndex={-1}>
      <section className="surface surface--dialog">
        <p className="section-kicker">
          {notFound ? "خطای ۴۰۴" : "خطای سامانه"}
        </p>
        <h1>{title}</h1>
        <p>{detail}</p>
        <a className="error-page-link" href="/">
          بازگشت به خانه
        </a>
      </section>
    </main>
  );
}
