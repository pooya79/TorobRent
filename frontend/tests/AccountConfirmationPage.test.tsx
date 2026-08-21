import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { AccountConfirmationPage } from "@/pages/AccountConfirmationPage";
import { server } from "./server";

function renderPage(mode: "verify" | "reset", path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AccountConfirmationPage mode={mode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("verifies the email token from the followed link", async () => {
  let submitted: unknown;
  server.use(
    http.post("*/api/v1/auth/verify-email/", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({ detail: "ایمیل شما تأیید شد." });
    }),
  );

  renderPage("verify", "/verify-email?token=signed-email-token");

  expect(await screen.findByText("ایمیل شما تأیید شد.")).toBeVisible();
  expect(submitted).toEqual({ token: "signed-email-token" });
  expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("sets a new password with the reset token", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  server.use(
    http.post("*/api/v1/auth/password-reset/confirm/", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({ detail: "گذرواژه شما تغییر کرد." });
    }),
  );
  renderPage("reset", "/reset-password?token=signed-reset-token");

  await user.type(
    screen.getByLabelText("گذرواژه جدید"),
    "a-new-correct-horse-battery",
  );
  await user.click(screen.getByRole("button", { name: "تغییر گذرواژه" }));

  expect(await screen.findByText("گذرواژه شما تغییر کرد.")).toBeVisible();
  expect(submitted).toEqual({
    token: "signed-reset-token",
    new_password: "a-new-correct-horse-battery",
  });
});

test("shows the Persian field error for an invalid token", async () => {
  server.use(
    http.post("*/api/v1/auth/verify-email/", () =>
      HttpResponse.json(
        {
          type: "https://example.com/problems/validation_error",
          title: "Bad request",
          status: 400,
          detail: "Bad request",
          code: "validation_error",
          request_id: null,
          errors: {
            token: [
              {
                code: "invalid",
                message: "پیوند تأیید نامعتبر است یا اعتبار آن تمام شده است.",
              },
            ],
          },
        },
        { status: 400 },
      ),
    ),
  );

  renderPage("verify", "/verify-email?token=invalid-token");

  expect(
    await screen.findByText(
      "پیوند تأیید نامعتبر است یا اعتبار آن تمام شده است.",
    ),
  ).toBeVisible();
  expect(screen.queryByText("Bad request")).not.toBeInTheDocument();
});
