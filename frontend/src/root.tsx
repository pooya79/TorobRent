import { dehydrate, QueryClient } from "@tanstack/react-query";
import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
} from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { ProductShell } from "@/app/ProductShell";
import { RouteFocus } from "@/app/RouteFocus";
import { THEME_BOOTSTRAP_SCRIPT, THEME_COLORS } from "@/app/ThemeProvider";
import { currentUserQuery, sessionQuery } from "@/features/session/queries";
import { createApiClient } from "@/lib/api/client";
import type { Route } from "./+types/root";
import "./styles.css";

export async function loader({ request }: Route.LoaderArgs) {
  const queryClient = new QueryClient();
  const responseHeaders = new Headers({ "Cache-Control": "private, no-store" });
  let csrfToken: string | undefined;

  if (typeof window === "undefined") {
    const requestUrl = new URL(request.url);
    const baseUrl = process.env.VITE_PROXY_TARGET ?? requestUrl.origin;
    const api = createApiClient(baseUrl);
    const cookie = request.headers.get("cookie");
    const forwardedHeaders = cookie ? { cookie } : undefined;

    try {
      const sessionResponse = await api.GET("/api/v1/auth/session/", {
        headers: forwardedHeaders,
      });
      for (const setCookie of sessionResponse.response.headers.getSetCookie()) {
        responseHeaders.append("Set-Cookie", setCookie);
      }

      if (!sessionResponse.error && sessionResponse.data) {
        const session = sessionResponse.data;
        csrfToken = session.csrf_token;
        queryClient.setQueryData(sessionQuery.queryKey, session);

        if (session.authenticated) {
          const currentUserResponse = await api.GET("/api/v1/users/me/", {
            headers: forwardedHeaders,
          });
          if (!currentUserResponse.error && currentUserResponse.data) {
            queryClient.setQueryData(
              currentUserQuery.queryKey,
              currentUserResponse.data,
            );
          }
        }
      }
    } catch {
      // Keep the public shell available and let React Query retry in the browser.
    }
  }

  return data(
    { csrfToken, dehydratedState: dehydrate(queryClient) },
    { headers: responseHeaders },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

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
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="theme-color"
          content={THEME_COLORS.light}
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content={THEME_COLORS.dark}
          media="(prefers-color-scheme: dark)"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
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
  const { csrfToken, dehydratedState } = useLoaderData<typeof loader>();
  const routeContent = <RouteFocus />;
  return (
    <AppProviders csrfToken={csrfToken} dehydratedState={dehydratedState}>
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
      className="mx-auto flex min-h-screen w-full max-w-432 items-center px-4 py-16 sm:px-6 lg:px-10"
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
