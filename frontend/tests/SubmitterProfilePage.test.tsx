import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { SubmitterProfilePage } from "@/pages/SubmitterProfilePage";
import { server } from "./server";

const account = {
  id: "account-1",
  display_name: "علی",
  first_name: "",
  last_name: "",
  email: "owner@example.com",
  phone: "09123456789",
  email_verified: true,
  phone_verified: true,
  is_submitter: true,
  operator_capabilities: [],
};

function renderProfile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard/profile"]}>
        <SubmitterProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("saves a trimmed display name and refreshes the sidebar identity", async () => {
  const user = userEvent.setup();
  let name = account.display_name;
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({ ...account, display_name: name }),
    ),
    http.put("*/api/v1/users/me/display-name/", async ({ request }) => {
      const body = (await request.json()) as { display_name: string };
      name = body.display_name;
      return HttpResponse.json({ display_name: name });
    }),
  );
  renderProfile();
  const input = await screen.findByLabelText("نام نمایشی");
  await user.clear(input);
  await user.type(input, "  علی رضایی  ");
  await user.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  expect(await screen.findByText("نام نمایشی شما ذخیره شد.")).toBeVisible();
  await waitFor(() => expect(name).toBe("علی رضایی"));
  expect(screen.getByRole("link", { name: /علی رضایی/ })).toBeVisible();
  expect(screen.getByLabelText("شماره همراه")).toHaveAttribute("readonly");
});

test("keeps the edited name when saving fails", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/users/me/", () => HttpResponse.json(account)),
    http.put("*/api/v1/users/me/display-name/", () =>
      HttpResponse.json({}, { status: 500 }),
    ),
  );
  renderProfile();
  const input = await screen.findByLabelText("نام نمایشی");
  await user.clear(input);
  await user.type(input, "نام تازه");
  await user.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(input).toHaveValue("نام تازه");
});
