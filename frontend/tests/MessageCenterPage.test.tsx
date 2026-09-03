import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";

import { MessageCenterPage } from "@/pages/MessageCenterPage";
import { server } from "./server";

const message = {
  id: "10000000-0000-4000-8000-000000000095",
  kind: "system_notification",
  title: "اصلاح پیشنهاد لازم است",
  preview: "تصاویر را اصلاح کنید.",
  created_at: "2026-09-03T12:00:00Z",
  read: false,
  group: {
    kind: "submission",
    id: "20000000-0000-4000-8000-000000000095",
    label: "پیشنهاد ملک",
  },
};

function renderPage(initialEntry = "/messages") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="messages" element={<MessageCenterPage />} />
          <Route path="messages/:messageId" element={<MessageCenterPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("opens a notification on a stable detail route and can mark it unread", async () => {
  let markedUnread = false;
  server.use(
    http.get("*/api/v1/messages/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [message],
      }),
    ),
    http.get("*/api/v1/messages/:messageId/", () =>
      HttpResponse.json({
        ...message,
        body: message.preview,
        read: true,
        target: {
          label: "مشاهده پیشنهاد",
          href: "/dashboard#submission-20000000-0000-4000-8000-000000000095",
        },
      }),
    ),
    http.patch("*/api/v1/messages/:messageId/", async ({ request }) => {
      markedUnread =
        ((await request.json()) as { read: boolean }).read === false;
      return HttpResponse.json({
        ...message,
        body: message.preview,
        target: null,
        read: false,
      });
    }),
  );
  renderPage();
  const user = userEvent.setup();

  const feed = await screen.findByRole("region", { name: "فهرست پیام‌ها" });
  const link = await within(feed).findByRole("link", {
    name: /اصلاح پیشنهاد لازم است/,
  });
  expect(link).toHaveAttribute("href", `/messages/${message.id}`);
  await user.click(link);

  const detail = await screen.findByRole("region", { name: "جزئیات پیام" });
  const heading = within(detail).getByRole("heading", {
    name: "اصلاح پیشنهاد لازم است",
  });
  expect(heading).toHaveFocus();
  expect(within(detail).getByText("تصاویر را اصلاح کنید.")).toBeVisible();
  expect(
    within(detail).getByRole("link", { name: "مشاهده پیشنهاد" }),
  ).toHaveAttribute(
    "href",
    "/dashboard#submission-20000000-0000-4000-8000-000000000095",
  );
  expect(
    within(detail).getByRole("link", { name: "بازگشت به پیام‌ها" }),
  ).toHaveAttribute("href", "/messages");

  await user.click(
    within(detail).getByRole("button", {
      name: "علامت‌گذاری به‌عنوان خوانده‌نشده",
    }),
  );
  expect(markedUnread).toBe(true);
});

test("filters the feed and renders empty and error states", async () => {
  const requestedQueries: string[] = [];
  server.use(
    http.get("*/api/v1/messages/", ({ request }) => {
      const url = new URL(request.url);
      requestedQueries.push(url.search);
      if (url.searchParams.get("unread") === "true") {
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        });
      }
      return new HttpResponse(null, { status: 500 });
    }),
  );
  renderPage();
  const user = userEvent.setup();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "بارگذاری پیام‌ها انجام نشد",
  );
  await user.click(screen.getByRole("button", { name: "خوانده‌نشده" }));

  expect(await screen.findByText("پیام خوانده‌نشده‌ای ندارید.")).toBeVisible();
  expect(requestedQueries).toContain("?unread=true");
});

test("keeps older pages reachable and renders stale targets as disabled in RTL", async () => {
  const requestedPages: string[] = [];
  server.use(
    http.get("*/api/v1/messages/", ({ request }) => {
      const url = new URL(request.url);
      requestedPages.push(url.search);
      return HttpResponse.json({
        count: 26,
        next:
          url.searchParams.get("page") === "2"
            ? null
            : "http://test/api/v1/messages/?page=2",
        previous:
          url.searchParams.get("page") === "2"
            ? "http://test/api/v1/messages/"
            : null,
        results: [message],
      });
    }),
    http.get("*/api/v1/messages/:messageId/", () =>
      HttpResponse.json({
        ...message,
        body: message.preview,
        read: true,
        target: null,
      }),
    ),
  );
  renderPage();
  const user = userEvent.setup();

  expect(screen.getByRole("main")).toHaveAttribute("dir", "rtl");
  const detail = screen.getByRole("region", { name: "جزئیات پیام" });
  expect(detail).toHaveClass("hidden", "md:block");
  await user.click(await screen.findByRole("button", { name: "صفحه بعد" }));

  await waitFor(() => expect(requestedPages).toContain("?page=2"));
  expect(await screen.findByRole("button", { name: "صفحه قبل" })).toBeEnabled();
  await user.click(
    screen.getByRole("link", { name: /اصلاح پیشنهاد لازم است/ }),
  );

  expect(screen.getByRole("region", { name: "فهرست پیام‌ها" })).toHaveClass(
    "hidden",
    "md:block",
  );
  expect(
    await screen.findByRole("button", { name: "مقصد دیگر در دسترس نیست" }),
  ).toBeDisabled();
  expect(screen.getByRole("link", { name: "بازگشت به پیام‌ها" })).toHaveClass(
    "md:hidden",
  );
});

test("visually groups source proposal outcomes while keeping each event readable", async () => {
  const sourceProposalGroup = {
    kind: "source_proposal",
    id: "30000000-0000-4000-8000-000000000096",
    label: "خانه‌یاب",
  };
  server.use(
    http.get("*/api/v1/messages/", () =>
      HttpResponse.json({
        count: 2,
        next: null,
        previous: null,
        results: [
          {
            ...message,
            id: "10000000-0000-4000-8000-000000000096",
            title: "منبع پیشنهادی شما رد شد",
            preview: "مالکیت دامنه اثبات نشد.",
            group: sourceProposalGroup,
          },
          {
            ...message,
            title: "منبع پیشنهادی نیازمند اصلاح است",
            preview: "مدرک نمایندگی را تکمیل کنید.",
            group: sourceProposalGroup,
          },
        ],
      }),
    ),
  );

  renderPage();

  const group = await screen.findByRole("group", {
    name: "منبع پیشنهادی خانه‌یاب",
  });
  expect(within(group).getByText("منبع پیشنهادی شما رد شد")).toBeVisible();
  expect(
    within(group).getByText("منبع پیشنهادی نیازمند اصلاح است"),
  ).toBeVisible();
});

test("group labels do not disturb latest-activity ordering", async () => {
  const firstGroup = {
    kind: "source_proposal",
    id: "30000000-0000-4000-8000-000000000096",
    label: "خانه‌یاب",
  };
  const secondGroup = {
    kind: "source_proposal",
    id: "30000000-0000-4000-8000-000000000097",
    label: "اجاره‌یار",
  };
  server.use(
    http.get("*/api/v1/messages/", () =>
      HttpResponse.json({
        count: 3,
        next: null,
        previous: null,
        results: [
          {
            ...message,
            id: "1",
            title: "رویداد جدید خانه‌یاب",
            group: firstGroup,
          },
          {
            ...message,
            id: "2",
            title: "رویداد اجاره‌یار",
            group: secondGroup,
          },
          {
            ...message,
            id: "3",
            title: "رویداد قدیمی خانه‌یاب",
            group: firstGroup,
          },
        ],
      }),
    ),
  );

  renderPage();

  const feed = await screen.findByRole("region", { name: "فهرست پیام‌ها" });
  const links = await within(feed).findAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    expect.stringContaining("رویداد جدید خانه‌یاب"),
    expect.stringContaining("رویداد اجاره‌یار"),
    expect.stringContaining("رویداد قدیمی خانه‌یاب"),
  ]);
});
