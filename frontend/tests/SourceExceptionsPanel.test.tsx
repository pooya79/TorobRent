import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { SourceExceptionsPanel } from "@/features/source-proposals/SourceExceptionsPanel";
import { server } from "./server";

const exception = {
  id: "one",
  canonical_url: "https://khaneh.example/listing/1",
  first_occurrence: "2026-09-06T10:00:00Z",
  state: "open",
  problem: "candidate_checks",
  detail: "اطلاعات نیازمند بررسی است",
  last_run: "run",
  last_attempt: 2,
  last_attempt_at: "2026-09-06T11:00:00Z",
  exclusion_reason: "",
  history: [
    {
      run: "run",
      attempt: 2,
      attempted_at: "2026-09-06T11:00:00Z",
      state: "open",
      problem: "candidate_checks",
      detail: "اطلاعات نیازمند بررسی است",
      is_current: true,
    },
  ],
};

function renderPanel(items = [exception], canRetry = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourceExceptionsPanel
        exceptions={items}
        proposalId="case"
        canRetry={canRetry}
      />
    </QueryClientProvider>,
  );
}

test("groups current problems and requests a bounded retry without fact editing", async () => {
  const user = userEvent.setup();
  let body: unknown;
  server.use(
    http.post(
      "*/api/v1/source-proposals/case/exceptions/retry/",
      async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([]);
      },
    ),
  );
  renderPanel();
  expect(
    screen.getByRole("heading", { name: /بررسی اطلاعات.*۱/ }),
  ).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "استخراج دوباره گروه" }));
  await waitFor(() => expect(body).toEqual({ exception_ids: ["one"] }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "درخواست استخراج دوباره ثبت شد",
  );
  await user.click(screen.getByText("تاریخچه تلاش‌ها"));
  expect(screen.getByText(/تلاش ۲/)).toBeVisible();
});

test("keeps excluded and resolved outcomes distinct and hides retries after revocation", () => {
  renderPanel(
    [
      exception,
      { ...exception, id: "two", state: "excluded" },
      { ...exception, id: "three", state: "resolved" },
    ],
    false,
  );
  expect(
    screen.getByRole("heading", { name: /کنار گذاشته شده.*۱/ }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: /رفع شده.*۱/ })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /استخراج دوباره/ }),
  ).not.toBeInTheDocument();
});

test("retains affected pages when retry authorization changes", async () => {
  server.use(
    http.post("*/api/v1/source-proposals/case/exceptions/retry/", () =>
      HttpResponse.json({ detail: "تخصیص تغییر کرده است" }, { status: 409 }),
    ),
  );
  renderPanel();
  await userEvent.click(
    screen.getByRole("button", { name: "استخراج دوباره صفحه" }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(
    screen.getByRole("link", { name: exception.canonical_url }),
  ).toBeVisible();
});

test("allows fresh extraction after an exclusion is removed while preserving its historical outcome", () => {
  renderPanel([{ ...exception, state: "excluded", exclusion_reason: "" }]);
  expect(
    screen.getByRole("heading", { name: /کنار گذاشته شده/ }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "استخراج دوباره صفحه" }),
  ).toBeEnabled();
});

test("representatives can inspect pages without treating failures as action requests", () => {
  renderPanel();
  expect(screen.getByText(/درخواست اقدام فقط در گفت‌وگوی منبع/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: exception.canonical_url }),
  ).toBeVisible();
  expect(screen.getByText(/مشکلات باز:.*۱/)).toBeVisible();
});
