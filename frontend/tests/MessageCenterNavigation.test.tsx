import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { ProductShell } from "@/app/ProductShell";
import { ThemeProvider } from "@/app/ThemeProvider";
import { server } from "./server";

test("desktop, mobile, and account navigation expose the unread Message Center badge", async () => {
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "10000000-0000-4000-8000-000000000001",
        email: "person@example.com",
        phone: null,
        first_name: "",
        last_name: "",
        email_verified: true,
        phone_verified: false,
        is_submitter: false,
        operator_capabilities: [],
      }),
    ),
    http.get("*/api/v1/messages/unread-count/", () =>
      HttpResponse.json({ count: 3 }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProductShell>
            <main />
          </ProductShell>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  const header = screen.getByRole("banner", { name: "راهبری عمومی" });

  const desktopLink = await within(header).findByRole("link", {
    name: "پیام‌ها، ۳ خوانده‌نشده",
  });
  expect(desktopLink).toHaveAttribute("href", "/messages");

  await user.click(within(header).getByRole("button", { name: "حساب کاربری" }));
  expect(
    await screen.findByRole("menuitem", { name: "پیام‌ها، ۳ خوانده‌نشده" }),
  ).toHaveAttribute("href", "/messages");
  await user.keyboard("{Escape}");

  await user.click(
    within(header).getByRole("button", { name: "باز کردن فهرست راهبری" }),
  );
  expect(
    (await screen.findAllByRole("link", { name: "پیام‌ها، ۳ خوانده‌نشده" }))
      .length,
  ).toBeGreaterThanOrEqual(2);
});
