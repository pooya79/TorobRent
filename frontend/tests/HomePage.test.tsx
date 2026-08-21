import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
  expect(screen.getByRole("searchbox", { name: "شهر یا محله" })).toBeVisible();

  for (const name of ["خانه", "راهنما", "تماس", "ورود", "ثبت آگهی"]) {
    expect(screen.getByRole("link", { name })).toBeVisible();
  }

  expect(await screen.findByText("سامانه در دسترس است")).toBeVisible();
});

test("recovers when the readiness check fails during startup", async () => {
  let attempts = 0;
  server.use(
    http.get("*/api/v1/system/ready/", () => {
      attempts += 1;
      return attempts === 1
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

  expect(await screen.findByText("سامانه در دسترس است")).toBeVisible();
  expect(attempts).toBe(2);
});
