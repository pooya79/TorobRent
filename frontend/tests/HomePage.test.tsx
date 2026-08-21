import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { ProductShell } from "@/app/ProductShell";
import { HomePage } from "@/pages/HomePage";

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
