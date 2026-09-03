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

function supportMessage(id: string, title: string, preview: string) {
  return {
    ...message,
    id,
    kind: "support_request",
    title,
    preview,
    group: {
      kind: "support_request",
      id,
      label: "پشتیبانی",
    },
  };
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

test("renders a Support thread with safe links and lets the requester reply", async () => {
  let replyBody = "";
  const support = supportMessage(
    "10000000-0000-4000-8000-000000000097",
    "مشکل حساب",
    "پاسخ اپراتور",
  );
  server.use(
    http.get("*/api/v1/messages/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [support],
      }),
    ),
    http.get("*/api/v1/messages/:messageId/", () =>
      HttpResponse.json({
        ...support,
        body: support.preview,
        read: true,
        target: null,
        public_status: "in_progress",
        reply_allowed: true,
        entries: [
          {
            id: "20000000-0000-4000-8000-000000000097",
            kind: "operator_reply",
            body: "راهنما در https://example.com/help است.",
            created_at: support.created_at,
            edited_at: null,
          },
        ],
      }),
    ),
    http.post(
      "*/api/v1/messages/support-requests/:messageId/replies/",
      async ({ request }) => {
        replyBody = ((await request.json()) as { body: string }).body;
        return HttpResponse.json(
          {
            id: "30000000-0000-4000-8000-000000000097",
            author_kind: "requester",
            body: replyBody,
            created_at: support.created_at,
            edited_at: null,
          },
          { status: 201 },
        );
      },
    ),
  );
  renderPage(`/messages/${support.id}`);
  const user = userEvent.setup();

  expect(await screen.findByText("وضعیت: در حال بررسی")).toBeVisible();
  expect(screen.getAllByText("پاسخ اپراتور")).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: "https://example.com/help" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await user.type(
    screen.getByRole("textbox", { name: "ادامه گفت‌وگو" }),
    "سپاس، بررسی می‌کنم.",
  );
  await user.click(screen.getByRole("button", { name: "ارسال پیام" }));
  await waitFor(() => expect(replyBody).toBe("سپاس، بررسی می‌کنم."));
});

test("keeps an expired resolved Support thread readable and links to a new request", async () => {
  const support = supportMessage(
    "10000000-0000-4000-8000-000000000098",
    "درخواست قدیمی",
    "پاسخ نهایی اپراتور",
  );
  server.use(
    http.get("*/api/v1/messages/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [support],
      }),
    ),
    http.get("*/api/v1/messages/:messageId/", () =>
      HttpResponse.json({
        ...support,
        body: support.preview,
        read: true,
        target: null,
        public_status: "resolved",
        reply_allowed: false,
        entries: [
          {
            id: "20000000-0000-4000-8000-000000000098",
            kind: "requester_message",
            body: "متن درخواست قدیمی",
            created_at: support.created_at,
            edited_at: null,
            editable: false,
          },
          {
            id: "30000000-0000-4000-8000-000000000098",
            kind: "operator_reply",
            body: "پاسخ نهایی اپراتور",
            created_at: "2026-09-03T13:00:00Z",
            edited_at: null,
            editable: false,
          },
        ],
      }),
    ),
  );

  renderPage(`/messages/${support.id}`);

  expect(await screen.findByText("وضعیت: رسیدگی شد")).toBeVisible();
  expect(screen.getByText("متن درخواست قدیمی")).toBeVisible();
  expect(screen.getAllByText("پاسخ نهایی اپراتور")).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: "ایجاد درخواست پشتیبانی جدید" }),
  ).toHaveAttribute("href", "/messages/new/support");
  expect(
    screen.queryByRole("textbox", { name: "ادامه گفت‌وگو" }),
  ).not.toBeInTheDocument();
});

test("shows a recently resolved Support thread as received after requester reply reopens it", async () => {
  let reopened = false;
  const support = supportMessage(
    "10000000-0000-4000-8000-000000000099",
    "درخواست تازه رسیدگی‌شده",
    "پاسخ نهایی",
  );
  server.use(
    http.get("*/api/v1/messages/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [support],
      }),
    ),
    http.get("*/api/v1/messages/:messageId/", () =>
      HttpResponse.json({
        ...support,
        body: support.preview,
        read: true,
        target: null,
        public_status: reopened ? "received" : "resolved",
        reply_allowed: true,
        entries: [
          {
            id: "20000000-0000-4000-8000-000000000099",
            kind: "operator_reply",
            body: "پاسخ نهایی",
            created_at: support.created_at,
            edited_at: null,
            editable: false,
          },
          ...(reopened
            ? [
                {
                  id: "30000000-0000-4000-8000-000000000099",
                  kind: "requester_message",
                  body: "مشکل همچنان ادامه دارد.",
                  created_at: "2026-09-03T13:00:00Z",
                  edited_at: null,
                  editable: true,
                },
              ]
            : []),
        ],
      }),
    ),
    http.post("*/api/v1/messages/support-requests/:messageId/replies/", () => {
      reopened = true;
      return HttpResponse.json(
        {
          id: "30000000-0000-4000-8000-000000000099",
          author_kind: "requester",
          body: "مشکل همچنان ادامه دارد.",
          created_at: "2026-09-03T13:00:00Z",
          edited_at: null,
        },
        { status: 201 },
      );
    }),
  );
  renderPage(`/messages/${support.id}`);
  const user = userEvent.setup();

  expect(await screen.findByText("وضعیت: رسیدگی شد")).toBeVisible();
  await user.type(
    screen.getByRole("textbox", { name: "ادامه گفت‌وگو" }),
    "مشکل همچنان ادامه دارد.",
  );
  await user.click(screen.getByRole("button", { name: "ارسال پیام" }));

  expect(await screen.findByText("وضعیت: دریافت شد")).toBeVisible();
  expect(screen.getByText("مشکل همچنان ادامه دارد.")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "ادامه گفت‌وگو" })).toBeEnabled();
});

test("filters and continues a Listing Inquiry thread with current participant names", async () => {
  let replyBody = "";
  const inquiry = {
    ...message,
    id: "10000000-0000-4000-8000-000000000099",
    kind: "listing_inquiry",
    title: "پرسش درباره آپارتمان در سعادت‌آباد",
    preview: "آیا هنوز موجود است؟",
    group: {
      kind: "listing_inquiry",
      id: "20000000-0000-4000-8000-000000000099",
      label: "آپارتمان در سعادت‌آباد",
    },
  };
  server.use(
    http.get("*/api/v1/messages/", ({ request }) => {
      expect(new URL(request.url).searchParams.get("kind")).toBe(
        "listing_inquiry",
      );
      return HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [inquiry],
      });
    }),
    http.get("*/api/v1/messages/:messageId/", () =>
      HttpResponse.json({
        ...inquiry,
        body: inquiry.preview,
        read: true,
        target: {
          label: "مشاهده ملک",
          href: "/properties/property/slug",
        },
        public_status: null,
        reply_allowed: true,
        counterpart: {
          display_name: "مالک تازه",
          role: "submitter",
          identity_verified: false,
        },
        entries: [
          {
            id: "30000000-0000-4000-8000-000000000099",
            kind: "renter_message",
            body: "آیا هنوز موجود است؟",
            author_name: "رها",
            mine: true,
            created_at: inquiry.created_at,
          },
        ],
      }),
    ),
    http.post(
      "*/api/v1/messages/listing-inquiries/:messageId/replies/",
      async ({ request }) => {
        replyBody = ((await request.json()) as { body: string }).body;
        return HttpResponse.json(
          {
            id: "40000000-0000-4000-8000-000000000099",
            body: replyBody,
            created_at: "2026-09-03T13:00:00Z",
          },
          { status: 201 },
        );
      },
    ),
  );
  renderPage(`/messages/${inquiry.id}?filter=listing_inquiry`);

  expect(await screen.findByText("گفت‌وگو با مالک تازه")).toBeVisible();
  expect(screen.getByText("نام نمایشی؛ هویت تأییدشده نیست")).toBeVisible();
  expect(screen.getByText("رها")).toBeVisible();
  await userEvent.type(
    screen.getByRole("textbox", { name: "ادامه گفت‌وگو" }),
    "برای فردا مناسب است؟",
  );
  await userEvent.click(screen.getByRole("button", { name: "ارسال پیام" }));

  await waitFor(() => expect(replyBody).toBe("برای فردا مناسب است؟"));
});
