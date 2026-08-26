import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test } from "vitest";

import { ProductShell } from "@/app/ProductShell";
import { ThemeProvider } from "@/app/ThemeProvider";
import { HomePage } from "@/pages/HomePage";
import { server } from "./server";

function SearchLocationProbe() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return (
    <p>
      {location.pathname}|{params.get("location")}|
      {params.get("location_label")}|{params.get("property_type")}
    </p>
  );
}

function renderHomeShell(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <ProductShell>
            <HomePage />
          </ProductShell>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

test("presents Persian search and primary destinations", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  expect(
    screen.getByRole("heading", { name: "ملکی برای اجاره پیدا کنید" }),
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
  renderHomeShell(queryClient);

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
  renderHomeShell(queryClient);

  await user.click(await screen.findByRole("button", { name: "خروج" }));

  expect(loggedOut).toBe(true);
  expect(await screen.findByRole("link", { name: "ورود" })).toBeVisible();
});

test("selects a Persian autocomplete result and navigates to a shareable Results URL", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchLocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(
    screen.getByRole("combobox", { name: "شهر یا محله" }),
    "سعادت اباد",
  );
  await user.click(
    await screen.findByRole("option", {
      name: "سعادت‌آباد، منطقه ۲، تهران",
    }),
  );
  await user.selectOptions(screen.getByLabelText("نوع ملک"), "office");
  await user.click(screen.getByRole("button", { name: "جست‌وجوی ملک" }));

  expect(
    screen.getByText(
      "/search|30000000-0000-4000-8000-000000000043|سعادت‌آباد|office",
    ),
  ).toBeVisible();
});
