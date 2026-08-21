import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { ProductShell } from "@/app/ProductShell";
import { HomePage } from "@/pages/HomePage";
import { server } from "./server";

test("presents Persian search and primary destinations", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProductShell>
          <HomePage />
        </ProductShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    screen.getByRole("heading", { name: "خانه‌ای برای اجاره پیدا کنید" }),
  ).toBeVisible();
  expect(screen.getByRole("combobox", { name: "شهر یا محله" })).toBeVisible();

  const navigation = screen.getByRole("navigation", { name: "راهبری اصلی" });
  for (const name of ["خانه", "راهنما", "تماس", "ورود", "ثبت آگهی"]) {
    expect(within(navigation).getByRole("link", { name })).toBeVisible();
  }

  expect(await screen.findByText("سامانه در دسترس است")).toBeVisible();
});

test("recovers when the readiness check fails during startup", async () => {
  let attempts = 0;
  server.use(
    http.get("*/api/v1/system/ready/", () => {
      attempts += 1;
      return attempts <= 2
        ? HttpResponse.json({ status: "unavailable" }, { status: 503 })
        : HttpResponse.json({ status: "ok" });
    }),
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProductShell>
          <HomePage />
        </ProductShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText("سامانه در دسترس است", undefined, {
      timeout: 2_500,
    }),
  ).toBeVisible();
  expect(attempts).toBe(3);
});

test("lets an authenticated Submitter log out from primary navigation", async () => {
  const user = userEvent.setup();
  let loggedOut = false;
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.post("*/api/v1/auth/logout/", () => {
      loggedOut = true;
      return HttpResponse.json({ detail: "با موفقیت خارج شدید." });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProductShell>
          <HomePage />
        </ProductShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click(await screen.findByRole("button", { name: "خروج" }));

  expect(loggedOut).toBe(true);
  expect(await screen.findByRole("link", { name: "ورود" })).toBeVisible();
});
