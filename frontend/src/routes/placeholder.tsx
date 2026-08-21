import type { Route } from "./+types/placeholder";
import { Link } from "react-router";

const pages = {
  guide: "راهنمای ترب‌رنت",
  contact: "تماس با ما",
  login: "ورود به ترب‌رنت",
  "add-submission": "ثبت آگهی اجاره",
  search: "نتیجه جست‌وجو",
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
    <main id="main-content" className="error-page" tabIndex={-1}>
      <section className="surface surface--dialog">
        <p className="section-kicker">ترب‌رنت</p>
        <h1>{pageTitle(matches)}</h1>
        <p>این بخش به‌زودی در دسترس خواهد بود.</p>
        <Link className="error-page-link" to="/">
          بازگشت به خانه
        </Link>
      </section>
    </main>
  );
}
