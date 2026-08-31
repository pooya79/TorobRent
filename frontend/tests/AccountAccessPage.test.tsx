import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { AccountAccessPage } from "@/pages/AccountAccessPage";
import { server } from "./server";

beforeEach(() => {
  vi.stubEnv("VITE_MAILPIT_URL", "http://localhost:8025");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderAccessPage(mode: "login" | "register" | "recovery") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AccountAccessPage mode={mode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("allows a simple password when creating a demo account", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  server.use(
    http.post("*/api/v1/auth/register/", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({ detail: "حساب ساخته شد." }, { status: 201 });
    }),
  );
  renderAccessPage("register");

  await user.type(
    screen.getByLabelText("ایمیل یا شماره تلفن"),
    "demo@example.com",
  );
  await user.type(screen.getByLabelText("گذرواژه"), "123");
  await user.click(screen.getByRole("button", { name: "ساخت حساب" }));

  expect(submitted).toEqual({
    identifier: "demo@example.com",
    password: "123",
  });
  expect(await screen.findByText("حساب ساخته شد.")).toBeVisible();
});

test("verifies a phone registration with a demo OTP", async () => {
  const user = userEvent.setup();
  let verification: unknown;
  server.use(
    http.post("*/api/v1/auth/register/", () =>
      HttpResponse.json(
        {
          detail: "کد تأیید ارسال شد.",
          verification_method: "phone",
          demo_otp: "314159",
        },
        { status: 201 },
      ),
    ),
    http.post("*/api/v1/auth/verify-phone/", async ({ request }) => {
      verification = await request.json();
      return HttpResponse.json({ detail: "شماره تلفن تأیید شد." });
    }),
  );
  renderAccessPage("register");

  await user.type(screen.getByLabelText("ایمیل یا شماره تلفن"), "۰۹۱۲۳۴۵۶۷۸۹");
  await user.type(screen.getByLabelText("گذرواژه"), "123");
  await user.click(screen.getByRole("button", { name: "ساخت حساب" }));

  expect(await screen.findByText("کد نمایشی: 314159")).toBeVisible();
  await user.type(screen.getByLabelText("کد تأیید"), "314159");
  await user.click(screen.getByRole("button", { name: "تأیید شماره" }));

  expect(await screen.findByText("شماره تلفن تأیید شد.")).toBeVisible();
  expect(verification).toEqual({
    identifier: "۰۹۱۲۳۴۵۶۷۸۹",
    otp: "314159",
  });
});

test("does not render an OTP secret when the server omits demo disclosure", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/auth/register/", () =>
      HttpResponse.json(
        { detail: "کد تأیید ارسال شد.", verification_method: "phone" },
        { status: 201 },
      ),
    ),
  );
  renderAccessPage("register");

  await user.type(screen.getByLabelText("ایمیل یا شماره تلفن"), "09123456789");
  await user.type(screen.getByLabelText("گذرواژه"), "123");
  await user.click(screen.getByRole("button", { name: "ساخت حساب" }));

  expect(await screen.findByLabelText("کد تأیید")).toBeVisible();
  expect(screen.queryByText(/کد نمایشی/)).toBeNull();
});

test("logs in a verified Submitter and preserves the protected destination", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  server.use(
    http.post("*/api/v1/auth/login/", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({
        id: "1f77778d-c15f-4bd1-9c84-1ffea15ca80f",
        email: "person@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
      });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={["/login?returnTo=%2Fadd-submission%3Fstep%3D3"]}
      >
        <Routes>
          <Route path="login" element={<AccountAccessPage mode="login" />} />
          <Route path="add-submission" element={<h1>مقصد محافظت‌شده</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(
    screen.getByLabelText("ایمیل یا شماره تلفن"),
    "person@example.com",
  );
  await user.type(screen.getByLabelText("گذرواژه"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "ورود" }));

  expect(submitted).toEqual({
    identifier: "person@example.com",
    password: "correct-horse-battery",
  });
  expect(
    await screen.findByRole("heading", { name: "مقصد محافظت‌شده" }),
  ).toBeVisible();
});

test("carries a safe onboarding destination through registration", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  server.use(
    http.post("*/api/v1/auth/register/", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json(
        {
          detail: "حساب ساخته شد. ایمیل خود را بررسی کنید.",
          verification_method: "email",
        },
        { status: 201 },
      );
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          "/register?returnTo=%2Fsubmitter%2Fget-started%3FreturnTo%3D%252Fadd-submission",
        ]}
      >
        <AccountAccessPage mode="register" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(
    screen.getByLabelText("ایمیل یا شماره تلفن"),
    "person@example.com",
  );
  await user.type(screen.getByLabelText("گذرواژه"), "123");
  await user.click(screen.getByRole("button", { name: "ساخت حساب" }));

  expect(submitted).toEqual({
    identifier: "person@example.com",
    password: "123",
    return_to: "/submitter/get-started?returnTo=%2Fadd-submission",
  });
  expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute(
    "href",
    "/login?returnTo=%2Fsubmitter%2Fget-started%3FreturnTo%3D%252Fadd-submission",
  );
});

test("links to the development inbox after Submitter registration", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/auth/register/", () =>
      HttpResponse.json(
        { detail: "حساب ساخته شد. ایمیل خود را بررسی کنید." },
        { status: 201 },
      ),
    ),
  );
  renderAccessPage("register");

  await user.type(
    screen.getByLabelText("ایمیل یا شماره تلفن"),
    "person@example.com",
  );
  await user.type(screen.getByLabelText("گذرواژه"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "ساخت حساب" }));

  expect(
    await screen.findByRole("link", { name: "صندوق ایمیل Mailpit" }),
  ).toHaveAttribute("href", "http://localhost:8025");
});

test("links to the development inbox after a password-reset request", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/auth/password-reset/", () =>
      HttpResponse.json(
        { detail: "اگر حساب وجود داشته باشد، پیوند بازیابی ارسال می‌شود." },
        { status: 202 },
      ),
    ),
  );
  renderAccessPage("recovery");

  await user.type(screen.getByLabelText("ایمیل"), "person@example.com");
  await user.click(screen.getByRole("button", { name: "ارسال پیوند بازیابی" }));

  expect(
    await screen.findByRole("link", { name: "صندوق ایمیل Mailpit" }),
  ).toHaveAttribute("href", "http://localhost:8025");
});
