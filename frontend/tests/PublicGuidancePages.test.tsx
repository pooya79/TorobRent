import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { ContactPage } from "@/pages/ContactPage";
import {
  AboutPage,
  AdvertisePage,
  GuidePage,
  PrivacyPage,
  TermsPage,
} from "@/pages/PublicGuidancePages";
import { server } from "./server";
import routerConfig from "../react-router.config";
import { meta as advertiseMeta } from "@/routes/advertise";
import { meta as contactMeta } from "@/routes/contact";
import { meta as guideMeta } from "@/routes/guide";
import { meta as privacyMeta } from "@/routes/privacy";
import { meta as termsMeta } from "@/routes/terms";
import { meta as aboutMeta } from "@/routes/about";

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

test("publishes Persian Guide, Privacy, Terms, and honest alpha guidance", () => {
  const pages = [
    {
      page: <GuidePage />,
      heading: "راهنمای ترب‌رنت",
      copy: "اطلاعات نسخه آلفا از داده‌های نمایشی و ورود دستی",
    },
    {
      page: <PrivacyPage />,
      heading: "حریم خصوصی",
      copy: "اطلاعات تماس عمومی را در نخستین فرصت از نمایش خارج می‌کنیم",
    },
    {
      page: <TermsPage />,
      heading: "شرایط استفاده",
      copy: "موجودی زنده سامانه‌های گردآورنده آگهی نیستند",
    },
  ];

  for (const item of pages) {
    const view = renderPage(item.page);
    expect(screen.getByRole("heading", { name: item.heading })).toBeVisible();
    expect(screen.getByText(new RegExp(item.copy))).toBeVisible();
    view.unmount();
  }
});

test("introduces future Owner and Agent phone enrollment without entering Submission", () => {
  renderPage(<AdvertisePage />);

  expect(
    screen.getByRole("heading", { name: "ثبت آگهی در ترب‌رنت" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      /ثبت‌نام تلفنی مالکان و نمایندگان مجاز مالک هنوز فعال نشده است/,
    ),
  ).toBeVisible();
  expect(screen.getByText(/به‌زودی/)).toBeVisible();
  expect(screen.getByRole("link", { name: "جست‌وجوی ملک" })).toHaveAttribute(
    "href",
    "/search",
  );
  expect(screen.queryByRole("link", { name: /ثبت آگهی/ })).toBeNull();
});

test("explains TorobRent genuinely without unsupported marketplace claims", () => {
  renderPage(<AboutPage />);

  expect(screen.getByRole("heading", { name: "درباره ترب‌رنت" })).toBeVisible();
  expect(screen.getByText(/ملک‌های مسکونی و تجاری/)).toBeVisible();
  expect(screen.getByText(/فقط تهران/)).toBeVisible();
  expect(screen.getByText(/هر آگهی با منبع/)).toBeVisible();
  expect(screen.queryByText(/بزرگ‌ترین|بهترین|تضمین می‌کند/)).toBeNull();
});

test("submits an accessible Persian Contact form and reports success", async () => {
  const user = userEvent.setup();
  let submitted: Record<string, unknown> | undefined;
  server.use(
    http.post("*/api/v1/contact/messages/", async ({ request }) => {
      submitted = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(
        { detail: "پیام شما ثبت شد و اپراتور آن را بررسی می‌کند." },
        { status: 201 },
      );
    }),
  );
  renderPage(<ContactPage />);

  await user.type(
    screen.getByRole("textbox", { name: "نام و نام خانوادگی" }),
    "نگار محمدی",
  );
  await user.type(
    screen.getByRole("textbox", { name: "ایمیل" }),
    "negar@example.com",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "موضوع پیام" }),
    "general",
  );
  await user.type(
    screen.getByRole("textbox", { name: "متن پیام" }),
    "برای استفاده از جست‌وجو راهنمایی می‌خواهم.",
  );
  await user.click(screen.getByRole("button", { name: "ارسال پیام" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "پیام شما ثبت شد",
  );
  expect(submitted).toMatchObject({
    name: "نگار محمدی",
    email: "negar@example.com",
    kind: "general",
  });
});

test("links Persian API validation errors to the Contact field", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/contact/messages/", () =>
      HttpResponse.json(
        {
          detail: "متن پیام باید دست‌کم ۱۰ نویسه باشد.",
          errors: {
            message: [
              {
                code: "min_length",
                message: "متن پیام باید دست‌کم ۱۰ نویسه باشد.",
              },
            ],
          },
        },
        { status: 400 },
      ),
    ),
  );
  renderPage(<ContactPage />);

  await user.type(
    screen.getByRole("textbox", { name: "نام و نام خانوادگی" }),
    "نگار محمدی",
  );
  await user.type(
    screen.getByRole("textbox", { name: "ایمیل" }),
    "negar@example.com",
  );
  const message = screen.getByRole("textbox", { name: "متن پیام" });
  await user.type(message, "پیام معتبر برای سرور");
  await user.click(screen.getByRole("button", { name: "ارسال پیام" }));

  expect(
    await screen.findByText("متن پیام باید دست‌کم ۱۰ نویسه باشد."),
  ).toHaveAttribute("id", "contact-message-error");
  expect(message).toHaveAttribute("aria-invalid", "true");
  expect(message).toHaveAttribute("aria-describedby", "contact-message-error");
});

test("explains deletion and prompt public-contact removal boundaries", () => {
  renderPage(<ContactPage />);

  expect(
    screen.getByRole("option", { name: "درخواست حذف حساب" }),
  ).toBeVisible();
  expect(
    screen.getByText(/حذف خودکار حساب در نسخه آلفا در دسترس نیست/),
  ).toBeVisible();
  expect(
    screen.getByText(/اطلاعات تماس عمومی را سریع از نمایش خارج می‌کند/),
  ).toBeVisible();
});

test("pre-renders public guidance with Persian metadata", () => {
  expect(routerConfig.prerender).toEqual([
    "/about",
    "/guide",
    "/contact",
    "/advertise",
    "/privacy",
    "/terms",
  ]);
  const routeMetadata = [
    [aboutMeta(), "معرفی فارسی ترب‌رنت"],
    [guideMeta(), "راهنمای فارسی جست‌وجو"],
    [contactMeta(), "ارسال پیام فارسی"],
    [advertiseMeta(), "ثبت‌نام تلفنی مالک و نماینده مجاز"],
    [privacyMeta(), "سیاست حریم خصوصی فارسی"],
    [termsMeta(), "شرایط استفاده فارسی"],
  ] as const;
  for (const [metadata, expectedDescription] of routeMetadata) {
    const title = metadata.find((item) => "title" in item)?.title;
    const description = metadata.find(
      (item) => "name" in item && item.name === "description",
    )?.content;
    expect(title).toContain("ترب‌رنت");
    expect(description).toContain(expectedDescription);
  }
});

test("Contact controls follow keyboard order", async () => {
  const user = userEvent.setup();
  renderPage(<ContactPage />);

  await user.tab();
  expect(
    screen.getByRole("textbox", { name: "نام و نام خانوادگی" }),
  ).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("textbox", { name: "ایمیل" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("combobox", { name: "موضوع پیام" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("textbox", { name: "متن پیام" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "ارسال پیام" })).toHaveFocus();
});
