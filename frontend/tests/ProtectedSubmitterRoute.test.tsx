import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test } from "vitest";

import { ProtectedSubmitterRoute } from "@/features/session/ProtectedSubmitterRoute";
import { server } from "./server";

function LoginDestination() {
  const location = useLocation();
  return <p>ورود: {location.search}</p>;
}

test("redirects an anonymous Submitter to login with the intended destination", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/add-submission?step=3"]}>
        <Routes>
          <Route
            path="add-submission"
            element={
              <ProtectedSubmitterRoute>
                <h1>ثبت آگهی</h1>
              </ProtectedSubmitterRoute>
            }
          />
          <Route path="login" element={<LoginDestination />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText("ورود: ?returnTo=%2Fadd-submission%3Fstep%3D3"),
  ).toBeVisible();
});

test("prevents an authenticated but unverified account from beginning a Submission", async () => {
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "1f77778d-c15f-4bd1-9c84-1ffea15ca80f",
        email: "person@example.com",
        first_name: "",
        last_name: "",
        email_verified: false,
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/add-submission"]}>
        <ProtectedSubmitterRoute>
          <h1>ثبت آگهی</h1>
        </ProtectedSubmitterRoute>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText("برای ثبت آگهی، ابتدا ایمیل خود را تأیید کنید."),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "ثبت آگهی" }),
  ).not.toBeInTheDocument();
});
