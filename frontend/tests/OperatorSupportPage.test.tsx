import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { OperatorSupportPage } from "@/pages/OperatorSupportPage";
import { server } from "./server";

const requestId = "10000000-0000-4000-8000-000000000039";
const assignedAt = "2026-08-24T08:00:00Z";

const queueItem = {
  id: requestId,
  name: "نگار محمدی",
  email: "negar@example.com",
  intake_kind: "general",
  classification: "guidance",
  status: "in_progress",
  assignee_id: "20000000-0000-4000-8000-000000000039",
  assignee_email: "operator@example.com",
  assigned_at: assignedAt,
  created_at: "2026-08-20T08:00:00Z",
  updated_at: assignedAt,
};

function serveSupportRequest() {
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [queueItem],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...queueItem,
        message: "برای ورود به حساب راهنمایی می‌خواهم.",
        operator_note: "",
        history: [
          {
            id: "30000000-0000-4000-8000-000000000039",
            event_type: "assigned",
            actor_id: queueItem.assignee_id,
            actor_reference: queueItem.assignee_id,
            actor_label: queueItem.assignee_email,
            actor_email: queueItem.assignee_email,
            prior_state: "open",
            new_state: "in_progress",
            reason: "",
            created_at: assignedAt,
          },
        ],
      }),
    ),
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OperatorSupportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("loads an existing durable assignment with request and event details", async () => {
  serveSupportRequest();
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "صف درخواست‌های پشتیبانی" }),
  ).toBeVisible();
  expect(screen.getAllByText("نگار محمدی")[0]).toBeVisible();
  expect(screen.getByText(/سن واگذاری:/)).toBeVisible();
  expect(
    await screen.findByText("برای ورود به حساب راهنمایی می‌خواهم."),
  ).toBeVisible();
  expect(screen.getByText("زمان واگذاری")).toBeVisible();
  expect(screen.getByLabelText("زمان واگذاری ثبت‌شده")).toHaveAttribute(
    "datetime",
    assignedAt,
  );
  expect(screen.getByLabelText("زمان رویداد")).toHaveAttribute(
    "datetime",
    assignedAt,
  );
  expect(
    screen.getByRole("button", { name: "آزاد کردن درخواست" }),
  ).toBeVisible();
});

test("identifies an anonymized historical author without displaying former identity", async () => {
  serveSupportRequest();
  server.use(
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...queueItem,
        message: "درخواست حفظ‌شده",
        history: [
          {
            id: "30000000-0000-4000-8000-000000000040",
            event_type: "classified",
            actor_id: "40000000-0000-4000-8000-000000000040",
            actor_reference: "40000000-0000-4000-8000-000000000040",
            actor_label: "Former Operator",
            actor_email: null,
            prior_state: "open",
            new_state: "open",
            reason: "",
            created_at: assignedAt,
          },
        ],
      }),
    ),
  );

  renderPage();

  expect(await screen.findByText(/Former Operator/)).toBeVisible();
  expect(screen.queryByText(/former\.private@example\.com/)).toBeNull();
});

test("claims an open request and lets its assignee release it", async () => {
  const user = userEvent.setup();
  let status = "open";
  let claimCount = 0;
  let releaseCount = 0;
  const currentItem = () => ({
    ...queueItem,
    status,
    assignee_id: status === "open" ? null : queueItem.assignee_id,
    assignee_email: status === "open" ? null : queueItem.assignee_email,
    assigned_at: status === "open" ? null : assignedAt,
  });
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [currentItem()],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...currentItem(),
        message: "برای ورود به حساب راهنمایی می‌خواهم.",
        operator_note: "",
        history: [],
      }),
    ),
    http.post("*/api/v1/operator/support-requests/:id/claim/", () => {
      claimCount += 1;
      status = "in_progress";
      return HttpResponse.json(
        {
          ...currentItem(),
          message: "درخواست",
          operator_note: "",
          history: [],
        },
        { status: 201 },
      );
    }),
    http.delete("*/api/v1/operator/support-requests/:id/claim/", () => {
      releaseCount += 1;
      status = "open";
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderPage();

  await user.click(
    await screen.findByRole("button", { name: "پذیرفتن درخواست" }),
  );

  await waitFor(() => expect(claimCount).toBe(1));
  await user.click(
    await screen.findByRole("button", { name: "آزاد کردن درخواست" }),
  );

  await waitFor(() => expect(releaseCount).toBe(1));
  expect(
    await screen.findByRole("button", { name: "پذیرفتن درخواست" }),
  ).toBeVisible();
});

test("sends queue filters to the server", async () => {
  const user = userEvent.setup();
  let requestedStatus: string | null = null;
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", ({ request }) => {
      requestedStatus = new URL(request.url).searchParams.get("status");
      return HttpResponse.json({
        count: 0,
        next: null,
        previous: null,
        results: [],
      });
    }),
  );
  renderPage();

  await user.selectOptions(
    await screen.findByLabelText("وضعیت"),
    "in_progress",
  );

  await waitFor(() => expect(requestedStatus).toBe("in_progress"));
});

test("classifies and escalates privacy work without retaining its protected content", async () => {
  const user = userEvent.setup();
  let triageBody: Record<string, unknown> | undefined;
  let visible = true;
  const unclassified = {
    ...queueItem,
    classification: "unclassified",
    priority: "normal",
    status: "open",
    assignee_id: null,
    assignee_email: null,
    assigned_at: null,
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: visible ? 1 : 0,
        next: null,
        previous: null,
        results: visible ? [unclassified] : [],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...unclassified,
        message: "این درخواست در واقع به حذف داده خصوصی نیاز دارد.",
        operator_note: "",
        history: [],
      }),
    ),
    http.patch(
      "*/api/v1/operator/support-requests/:id/triage/",
      async ({ request }) => {
        triageBody = (await request.json()) as Record<string, unknown>;
        visible = false;
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  renderPage();

  await user.selectOptions(
    await screen.findByLabelText("دسته‌بندی عملیاتی"),
    "privacy",
  );
  await user.selectOptions(
    screen.getByLabelText("مسیر‌دهی تخصصی"),
    "escalated",
  );
  await user.selectOptions(
    screen.getByLabelText("قابلیت مورد نیاز"),
    "handle_privacy_requests",
  );
  await user.type(
    screen.getByLabelText("دلیل تریاژ"),
    "نیازمند رسیدگی حفاظت‌شده است.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت تریاژ" }));

  await waitFor(() =>
    expect(triageBody).toEqual({
      classification: "privacy",
      status: "escalated",
      required_capability: "handle_privacy_requests",
      reason: "نیازمند رسیدگی حفاظت‌شده است.",
    }),
  );
  expect(await screen.findByText("موردی در صف نیست.")).toBeVisible();
  expect(
    screen.queryByText("این درخواست در واقع به حذف داده خصوصی نیاز دارد."),
  ).not.toBeInTheDocument();
});

test("escalates to an unavailable capability without retaining request content", async () => {
  const user = userEvent.setup();
  let visible = true;
  const content = "این درخواست پس از ارجاع فقط برای متخصص حریم خصوصی است.";
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: visible ? 1 : 0,
        next: null,
        previous: null,
        results: visible ? [{ ...queueItem, priority: "normal" }] : [],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      visible
        ? HttpResponse.json({
            ...queueItem,
            priority: "normal",
            message: content,
            operator_note: "",
            history: [],
          })
        : HttpResponse.json({}, { status: 404 }),
    ),
    http.patch("*/api/v1/operator/support-requests/:id/triage/", () => {
      visible = false;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderPage();

  await user.click(await screen.findByRole("button", { name: /نگار محمدی/ }));
  expect(await screen.findByText(content)).toBeVisible();
  await user.selectOptions(
    screen.getByLabelText("مسیر‌دهی تخصصی"),
    "escalated",
  );
  await user.selectOptions(
    screen.getByLabelText("قابلیت مورد نیاز"),
    "handle_privacy_requests",
  );
  await user.type(
    screen.getByLabelText("دلیل تریاژ"),
    "این رسیدگی به قابلیت تخصصی نیاز دارد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت تریاژ" }));

  expect(await screen.findByText("موردی در صف نیست.")).toBeVisible();
  expect(screen.queryByText(content)).not.toBeInTheDocument();
});

test("lets a Support lead submit a reasoned reassignment", async () => {
  const user = userEvent.setup();
  let reassignmentBody: Record<string, unknown> | undefined;
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "40000000-0000-4000-8000-000000000039",
        email: "lead@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support", "manage_operator_queues"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [queueItem],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...queueItem,
        priority: "normal",
        escalation_destination: "",
        required_capability: "",
        message: "این کار پس از لغو دسترسی مسئول قبلی رها شده است.",
        operator_note: "",
        history: [],
      }),
    ),
    http.post(
      "*/api/v1/operator/support-requests/:id/reassign/",
      async ({ request }) => {
        reassignmentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          ...queueItem,
          assignee_email: "replacement@example.com",
          message: "درخواست",
          operator_note: "",
          history: [],
        });
      },
    ),
  );
  renderPage();

  await user.type(
    await screen.findByLabelText("ایمیل مسئول جدید"),
    "replacement@example.com",
  );
  await user.type(
    screen.getByLabelText("دلیل واگذاری مجدد"),
    "دسترسی مسئول قبلی لغو شده است.",
  );
  await user.click(screen.getByRole("button", { name: "واگذاری مجدد" }));

  await waitFor(() =>
    expect(reassignmentBody).toEqual({
      assignee_email: "replacement@example.com",
      reason: "دسترسی مسئول قبلی لغو شده است.",
    }),
  );
});

test("keeps privacy-reclassified content visible for an Operator with both capabilities", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support", "handle_privacy_requests"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [{ ...queueItem, classification: "unclassified" }],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...queueItem,
        classification: "unclassified",
        message: "محتوای حفاظت‌شده برای اپراتور دو قابلیتی",
        operator_note: "",
        history: [],
      }),
    ),
    http.patch(
      "*/api/v1/operator/support-requests/:id/triage/",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  renderPage();

  await user.selectOptions(
    await screen.findByLabelText("دسته‌بندی عملیاتی"),
    "privacy",
  );
  await user.type(
    screen.getByLabelText("دلیل تریاژ"),
    "این اپراتور قابلیت حریم خصوصی را نیز دارد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت تریاژ" }));

  expect(
    await screen.findByText("محتوای حفاظت‌شده برای اپراتور دو قابلیتی"),
  ).toBeVisible();
});

test("records internal work and resolves without pretending to send a reply", async () => {
  const user = userEvent.setup();
  let noteBody: Record<string, unknown> | undefined;
  let contactBody: Record<string, unknown> | undefined;
  let resolutionBody: Record<string, unknown> | undefined;
  serveSupportRequest();
  server.use(
    http.post(
      "*/api/v1/operator/support-requests/:id/notes/",
      async ({ request }) => {
        noteBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "note-id" }, { status: 201 });
      },
    ),
    http.post(
      "*/api/v1/operator/support-requests/:id/external-contacts/",
      async ({ request }) => {
        contactBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "contact-id" }, { status: 201 });
      },
    ),
    http.post(
      "*/api/v1/operator/support-requests/:id/resolve/",
      async ({ request }) => {
        resolutionBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      },
    ),
  );
  renderPage();

  await user.type(
    await screen.findByLabelText("یادداشت داخلی"),
    "نتیجه بررسی اولیه ثبت شد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت یادداشت" }));
  await waitFor(() =>
    expect(noteBody).toEqual({ body: "نتیجه بررسی اولیه ثبت شد." }),
  );

  await user.selectOptions(
    screen.getByLabelText("کانال ارتباط بیرونی"),
    "email",
  );
  await user.type(
    screen.getByLabelText("زمان ارتباط بیرونی"),
    "2026-08-25T10:30",
  );
  await user.type(screen.getByLabelText("نتیجه ارتباط بیرونی"), "answered");
  await user.type(
    screen.getByLabelText("خلاصه ارتباط بیرونی"),
    "راهنمای بازیابی حساب ایمیل شد؛ متن کامل گفتگو ذخیره نشد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت خلاصه ارتباط" }));
  await waitFor(() =>
    expect(contactBody).toEqual({
      channel: "email",
      occurred_at: new Date("2026-08-25T10:30").toISOString(),
      outcome: "answered",
      summary: "راهنمای بازیابی حساب ایمیل شد؛ متن کامل گفتگو ذخیره نشد.",
    }),
  );

  await user.selectOptions(
    screen.getByLabelText("نتیجه نهایی"),
    "answered_externally",
  );
  await user.type(
    screen.getByLabelText("خلاصه داخلی نتیجه"),
    "راهنما خارج از TorobRent ارائه شد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت نتیجه و بستن" }));
  await waitFor(() =>
    expect(resolutionBody).toEqual({
      category: "answered_externally",
      summary: "راهنما خارج از TorobRent ارائه شد.",
    }),
  );
  expect(
    screen.queryByRole("button", { name: /ارسال پاسخ/ }),
  ).not.toBeInTheDocument();
});

test("records privacy verification and admin action completion without deleting an account", async () => {
  const user = userEvent.setup();
  let verificationBody: Record<string, unknown> | undefined;
  let privacyActionBody: Record<string, unknown> | undefined;
  const privacyRequest = {
    ...queueItem,
    intake_kind: "account_deletion",
    classification: "account_deletion",
    account_linked_at_intake: false,
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_privacy_requests"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [privacyRequest],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...privacyRequest,
        message: "درخواست حذف حساب",
        notes: [],
        external_contacts: [],
        identity_verifications: [],
        privacy_actions: [],
        history: [],
      }),
    ),
    http.post(
      "*/api/v1/operator/support-requests/:id/identity-verifications/",
      async ({ request }) => {
        verificationBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "verification-id" }, { status: 201 });
      },
    ),
    http.post(
      "*/api/v1/operator/support-requests/:id/privacy-actions/",
      async ({ request }) => {
        privacyActionBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "privacy-action-id" }, { status: 201 });
      },
    ),
  );
  renderPage();

  await user.type(
    await screen.findByLabelText("زمان تأیید هویت"),
    "2026-08-25T11:15",
  );
  await user.type(
    screen.getByLabelText("خلاصه تأیید هویت"),
    "تأیید از مسیر بازیابی ثبت‌شده انجام شد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت تأیید هویت" }));
  await waitFor(() =>
    expect(verificationBody).toEqual({
      method: "out_of_band",
      verified_at: new Date("2026-08-25T11:15").toISOString(),
      summary: "تأیید از مسیر بازیابی ثبت‌شده انجام شد.",
    }),
  );

  await user.selectOptions(
    screen.getByLabelText("نوع اقدام ثبت‌شده"),
    "permanent_account_action",
  );
  await user.type(
    screen.getByLabelText("زمان تکمیل اقدام"),
    "2026-08-25T11:20",
  );
  await user.type(
    screen.getByLabelText("خلاصه اقدام تکمیل‌شده"),
    "تکمیل حذف حساب در Django admin ثبت شد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت تکمیل اقدام" }));
  await waitFor(() =>
    expect(privacyActionBody).toEqual({
      action: "permanent_account_action",
      completed_at: new Date("2026-08-25T11:20").toISOString(),
      summary: "تکمیل حذف حساب در Django admin ثبت شد.",
    }),
  );
});

test("hides privacy controls after a sensitive intake is authoritatively corrected", async () => {
  const correctedRequest = {
    ...queueItem,
    intake_kind: "account_deletion",
    classification: "guidance",
    account_linked_at_intake: false,
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [correctedRequest],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...correctedRequest,
        message: "درخواست به اشتباه حذف حساب ثبت شده بود.",
        notes: [],
        external_contacts: [],
        identity_verifications: [],
        privacy_actions: [],
        history: [],
      }),
    ),
  );
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "سوابق و نتیجه رسیدگی" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("زمان تأیید هویت")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("نوع اقدام ثبت‌شده")).not.toBeInTheDocument();
  expect(screen.getByLabelText("نتیجه نهایی")).toBeVisible();
});
