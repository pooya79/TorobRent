import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { expect, test, vi } from "vitest";

import {
  RenterAccessProvider,
  useRenterAccess,
} from "@/features/session/RenterAccessDialog";
import { server } from "./server";

function AccessHarness({ onResume }: { onResume: () => void }) {
  const { requestRenterAccess } = useRenterAccess();
  const location = useLocation();
  return (
    <>
      <button onClick={() => requestRenterAccess(onResume)} type="button">
        علاقه‌مندی‌ها
      </button>
      <output aria-label="مسیر جاری">{`${location.pathname}${location.search}`}</output>
    </>
  );
}

function renderAccess(onResume = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/search?property_type=house"]}>
        <RenterAccessProvider>
          <AccessHarness onResume={onResume} />
        </RenterAccessProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onResume, queryClient };
}

test("keeps discovery state in place and restores focus when dismissed", async () => {
  const user = userEvent.setup();
  const scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
  renderAccess();
  const trigger = screen.getByRole("button", { name: "علاقه‌مندی‌ها" });

  await user.click(trigger);

  const dialog = screen.getByRole("dialog", { name: "ورود به ترب‌رنت" });
  expect(dialog).toBeVisible();
  expect(screen.getByLabelText("مسیر جاری")).toHaveTextContent(
    "/search?property_type=house",
  );
  for (let index = 0; index < 10; index += 1) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(screen.getByLabelText("مسیر جاری")).toHaveTextContent(
    "/search?property_type=house",
  );
  expect(window.scrollY).toBe(640);
  if (scrollDescriptor)
    Object.defineProperty(window, "scrollY", scrollDescriptor);
});

test("registers a Renter, updates the session in place, and resumes pending intent", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "rotated-token" }),
    ),
    http.post("*/api/v1/auth/renter-register/", async ({ request }) => {
      submitted = await request.json();
      await delay(100);
      return HttpResponse.json(
        {
          id: "10000000-0000-4000-8000-000000000056",
          email: "renter@example.com",
          first_name: "",
          last_name: "",
          email_verified: false,
          is_submitter: false,
        },
        { status: 201 },
      );
    }),
  );
  const { onResume, queryClient } = renderAccess();

  await user.click(screen.getByRole("button", { name: "علاقه‌مندی‌ها" }));
  await user.click(screen.getByRole("button", { name: "ساخت حساب" }));
  await user.type(screen.getByLabelText("ایمیل"), "renter@example.com");
  await user.type(screen.getByLabelText("گذرواژه"), "123");
  await user.click(screen.getByRole("button", { name: "ساخت حساب و ادامه" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "در حال ساخت حساب…",
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "علاقه‌مندی‌ها" })).toHaveFocus();
  expect(submitted).toEqual({
    email: "renter@example.com",
    password: "123",
  });
  expect(queryClient.getQueryData(["session"])).toMatchObject({
    authenticated: true,
    csrf_token: "rotated-token",
  });
  expect(onResume).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("مسیر جاری")).toHaveTextContent(
    "/search?property_type=house",
  );
});

test("announces field validation errors without closing the login dialog", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/auth/login/", () =>
      HttpResponse.json(
        {
          type: "validation_error",
          title: "Validation error",
          status: 400,
          detail: "ایمیل معتبر نیست.",
          code: "validation_error",
          request_id: "10000000-0000-4000-8000-000000000057",
          errors: {
            email: [{ message: "ایمیل معتبر نیست.", code: "invalid" }],
          },
        },
        { status: 400 },
      ),
    ),
  );
  renderAccess();

  await user.click(screen.getByRole("button", { name: "علاقه‌مندی‌ها" }));
  await user.type(screen.getByLabelText("ایمیل"), "renter@example.com");
  await user.type(screen.getByLabelText("گذرواژه"), "incorrect-password");
  await user.click(screen.getByRole("button", { name: "ورود و ادامه" }));

  expect(await screen.findByText("ایمیل معتبر نیست.")).toHaveAttribute(
    "role",
    "alert",
  );
  expect(screen.getByLabelText("ایمیل")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByRole("dialog", { name: "ورود به ترب‌رنت" })).toBeVisible();
});
