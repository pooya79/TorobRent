import type { Route } from "./+types/placeholder";
import { Link } from "react-router";

const pages = {
  guide: "راهنمای ترب‌رنت",
  contact: "تماس با ما",
  login: "ورود به ترب‌رنت",
  privacy: "حریم خصوصی",
  terms: "شرایط استفاده",
} as const;

function pageTitle(matches: readonly ({ id: string } | undefined)[]) {
  const routeId = matches.at(-1)?.id;
  return routeId && routeId in pages
    ? pages[routeId as keyof typeof pages]
    : "ترب‌رنت";
}

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${pageTitle(matches)} | ترب‌رنت` }];
}

export default function PlaceholderPage({ matches }: Route.ComponentProps) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[70vh] w-full max-w-360 items-center px-4 py-16 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <section className="border-border mx-auto w-full max-w-xl rounded-xl border p-8 text-center">
        <p className="text-primary mb-3 text-sm font-semibold">ترب‌رنت</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {pageTitle(matches)}
        </h1>
        <p className="text-muted-foreground mt-4">
          این بخش به‌زودی در دسترس خواهد بود.
        </p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold"
          to="/"
        >
          بازگشت به خانه
        </Link>
      </section>
    </main>
  );
}
