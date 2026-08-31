import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test } from "vitest";

import { SubmitterOnboardingPage } from "@/pages/SubmitterOnboardingPage";
import { server } from "./server";

function LocationProbe() {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}`}</p>;
}

test("sends an anonymous visitor to login and preserves the complete onboarding destination", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          "/submitter/get-started?returnTo=%2Fadd-submission%3Fstep%3Dcontact",
        ]}
      >
        <Routes>
          <Route
            path="submitter/get-started"
            element={<SubmitterOnboardingPage />}
          />
          <Route path="login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText(
      "/login?returnTo=%2Fsubmitter%2Fget-started%3FreturnTo%3D%252Fadd-submission%253Fstep%253Dcontact",
    ),
  ).toBeVisible();
});

test("upgrades a verified Renter without another login or phone challenge and shows both paths", async () => {
  let activated = false;
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: false,
        phone_verified: true,
        selected_path: null,
      }),
    ),
    http.post("*/api/v1/users/me/submitter-onboarding/", () => {
      activated = true;
      return HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: null,
      });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/submitter/get-started"]}>
        <SubmitterOnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("button", { name: /ثبت یک ملک/ }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: /معرفی وب‌سایت اجاره/ }),
  ).toBeVisible();
  expect(activated).toBe(true);
  expect(screen.queryByLabelText("شماره تلفن")).toBeNull();
});

test("adds and verifies a phone on an email-authenticated account before granting eligibility", async () => {
  const user = userEvent.setup();
  let requested: unknown;
  let verified: unknown;
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: false,
        phone_verified: false,
        selected_path: null,
      }),
    ),
    http.post(
      "*/api/v1/auth/phone-verification/request/",
      async ({ request }) => {
        requested = await request.json();
        return HttpResponse.json(
          { detail: "کد ارسال شد.", demo_otp: "314159" },
          { status: 202 },
        );
      },
    ),
    http.post("*/api/v1/auth/verify-phone/", async ({ request }) => {
      verified = await request.json();
      return HttpResponse.json({ detail: "شماره تلفن تأیید شد." });
    }),
    http.post("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: null,
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/submitter/get-started"]}>
        <SubmitterOnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(await screen.findByLabelText("شماره تلفن"), "۰۹۱۲۳۴۵۶۷۸۹");
  await user.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));
  expect(await screen.findByText("کد نمایشی: 314159")).toBeVisible();
  await user.type(screen.getByLabelText("کد تأیید"), "314159");
  await user.click(screen.getByRole("button", { name: "تأیید و ادامه" }));

  expect(
    await screen.findByRole("button", { name: /ثبت یک ملک/ }),
  ).toBeVisible();
  expect(requested).toEqual({
    identifier: "۰۹۱۲۳۴۵۶۷۸۹",
    purpose: "submitter_onboarding",
  });
  expect(verified).toEqual({ identifier: "۰۹۱۲۳۴۵۶۷۸۹", otp: "314159" });
});

test("persists and restores the Source Proposal choice", async () => {
  const user = userEvent.setup();
  const selectedPaths: string[] = [];
  let selectedPath: "submission" | "source_proposal" | null = "source_proposal";
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: selectedPath,
      }),
    ),
    http.post(
      "*/api/v1/users/me/submitter-onboarding/",
      async ({ request }) => {
        const body = (await request.json()) as {
          selected_path: typeof selectedPath;
        };
        selectedPath = body.selected_path;
        selectedPaths.push(selectedPath ?? "");
        return HttpResponse.json({
          eligible: true,
          phone_verified: true,
          selected_path: selectedPath,
        });
      },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/submitter/get-started"]}>
        <SubmitterOnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const website = await screen.findByRole("button", {
    name: /معرفی وب‌سایت اجاره/,
  });
  expect(website).toHaveAttribute("aria-pressed", "true");

  await user.click(website);
  expect(website).toHaveAttribute("aria-pressed", "true");
  expect(selectedPaths).toEqual(["source_proposal"]);
});

test("continues the Register one Property choice into the relationship step", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: null,
      }),
    ),
    http.post("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: "submission",
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/submitter/get-started"]}>
        <Routes>
          <Route
            path="submitter/get-started"
            element={<SubmitterOnboardingPage />}
          />
          <Route path="add-submission" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click(await screen.findByRole("button", { name: /ثبت یک ملک/ }));

  expect(await screen.findByText("/add-submission")).toBeVisible();
});

test("resumes a safe protected destination after the path is saved", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: null,
      }),
    ),
    http.post("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: "submission",
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          "/submitter/get-started?returnTo=%2Fadd-submission%3Fstep%3Dcontact",
        ]}
      >
        <Routes>
          <Route
            path="submitter/get-started"
            element={<SubmitterOnboardingPage />}
          />
          <Route path="add-submission" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click(
    await screen.findByRole("button", {
      name: /ثبت یک ملک/,
    }),
  );

  expect(await screen.findByText("/add-submission?step=contact")).toBeVisible();
});

test("resumes without another click when the path was already saved", async () => {
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: true,
        phone_verified: true,
        selected_path: "submission",
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          "/submitter/get-started?returnTo=%2Fadd-submission%3Fstep%3Dcontact",
        ]}
      >
        <Routes>
          <Route
            path="submitter/get-started"
            element={<SubmitterOnboardingPage />}
          />
          <Route path="add-submission" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("/add-submission?step=contact")).toBeVisible();
});

test("shows a private support path when the phone belongs to another account", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/submitter-onboarding/", () =>
      HttpResponse.json({
        eligible: false,
        phone_verified: false,
        selected_path: null,
      }),
    ),
    http.post("*/api/v1/auth/phone-verification/request/", () =>
      HttpResponse.json(
        {
          type: "https://example.com/problems/phone_ownership_conflict",
          title: "Request failed",
          status: 409,
          detail:
            "این شماره به حساب دیگری متصل است. برای بررسی مالکیت با پشتیبانی تماس بگیرید.",
          code: "phone_ownership_conflict",
          request_id: null,
        },
        { status: 409 },
      ),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/submitter/get-started"]}>
        <SubmitterOnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(await screen.findByLabelText("شماره تلفن"), "09123456789");
  await user.click(screen.getByRole("button", { name: "ارسال کد تأیید" }));

  expect(
    await screen.findByText(
      "این شماره به حساب دیگری متصل است. برای بررسی مالکیت با پشتیبانی تماس بگیرید.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/example.com/)).toBeNull();
});
