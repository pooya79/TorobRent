import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { ContactPage } from "@/pages/ContactPage";
import { GuidePage, PrivacyPage, TermsPage } from "@/pages/PublicGuidancePages";
import { server } from "./server";
import routerConfig from "../react-router.config";
import { meta as contactMeta } from "@/routes/contact";
import { meta as guideMeta } from "@/routes/guide";
import { meta as privacyMeta } from "@/routes/privacy";
import { meta as termsMeta } from "@/routes/terms";

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
    "/guide",
    "/contact",
    "/privacy",
    "/terms",
  ]);
  const routeMetadata = [
    [guideMeta(), "راهنمای فارسی جست‌وجو"],
    [contactMeta(), "ارسال پیام فارسی"],
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
