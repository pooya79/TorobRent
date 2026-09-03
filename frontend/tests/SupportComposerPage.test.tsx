import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";

import { SupportComposerPage } from "@/pages/SupportComposerPage";
import { server } from "./server";

test("creates a Support Request without asking for account identity", async () => {
  let submitted: Record<string, unknown> | undefined;
  server.use(
    http.post("*/api/v1/messages/support-requests/", async ({ request }) => {
      submitted = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          id: "10000000-0000-4000-8000-000000000097",
          href: "/messages/10000000-0000-4000-8000-000000000097",
        },
        { status: 201 },
      );
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/messages/new/support"]}>
        <Routes>
          <Route
            path="messages/new/support"
            element={<SupportComposerPage />}
          />
          <Route
            path="messages/:messageId"
            element={<p>رشته پشتیبانی باز شد</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();

  expect(screen.queryByRole("textbox", { name: /نام|ایمیل/ })).toBeNull();
  await user.type(
    screen.getByRole("textbox", { name: "موضوع کوتاه" }),
    "مشکل حساب",
  );
  await user.type(
    screen.getByRole("textbox", { name: "پیام نخست" }),
    "برای ورود به حساب راهنمایی می‌خواهم.",
  );
  await user.click(
    screen.getByRole("button", { name: "ثبت درخواست پشتیبانی" }),
  );

  expect(await screen.findByText("رشته پشتیبانی باز شد")).toBeVisible();
  expect(submitted).toEqual({
    intake_kind: "general",
    subject: "مشکل حساب",
    message: "برای ورود به حساب راهنمایی می‌خواهم.",
  });
});
