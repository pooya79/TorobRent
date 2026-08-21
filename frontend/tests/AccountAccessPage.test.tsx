import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";

import { AccountAccessPage } from "@/pages/AccountAccessPage";
import { server } from "./server";

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

  await user.type(screen.getByLabelText("ایمیل"), "person@example.com");
  await user.type(screen.getByLabelText("گذرواژه"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "ورود" }));

  expect(submitted).toEqual({
    email: "person@example.com",
    password: "correct-horse-battery",
  });
  expect(
    await screen.findByRole("heading", { name: "مقصد محافظت‌شده" }),
  ).toBeVisible();
});
