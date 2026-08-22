import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { AddSubmissionPage } from "@/pages/AddSubmissionPage";
import { server } from "./server";

const draft = {
  id: "10000000-0000-4000-8000-000000000010",
  role: "owner",
  state: "draft",
  current_step: "location",
  media_complete: false,
  location: null,
  property_facts: null,
  rental_terms: null,
  features: {
    parking: "unknown",
    elevator: "unknown",
    storage: "unknown",
    balcony: "unknown",
    furnished: "unknown",
  },
  description: "",
  contact: null,
  review: {},
  created_at: "2026-08-22T08:00:00Z",
  updated_at: "2026-08-22T08:00:00Z",
};

function renderPage(entry = "/add-submission") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <AddSubmissionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("creates an Owner draft and presents the seven server-backed steps", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/submissions/", () =>
      HttpResponse.json(draft, { status: 201 }),
    ),
    http.get("*/api/v1/submissions/:id/", () => HttpResponse.json(draft)),
  );
  renderPage();

  await user.click(
    screen.getByRole("button", { name: "ساخت پیش‌نویس و ادامه" }),
  );

  expect(await screen.findByText(/مرحله ۱ از ۷/)).toBeVisible();
  for (const step of [
    "نشانی ملک",
    "مشخصات ملک",
    "شرایط اجاره",
    "امکانات و توضیحات",
    "تصاویر",
    "اطلاعات تماس",
    "بازبینی",
  ]) {
    expect(screen.getAllByText(step).length).toBeGreaterThan(0);
  }
});

test("attaches localized validation to the relevant field and preserves valid input", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "property_facts" }),
    ),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=property_facts`);

  const area = await screen.findByLabelText("متراژ");
  await user.type(area, "۰");
  await user.type(screen.getByLabelText("تعداد اتاق خواب"), "۲");
  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "متراژ باید بیشتر از صفر باشد.",
  );
  expect(area).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("تعداد اتاق خواب")).toHaveValue("۲");
});

test("normalizes Persian Toman input before saving and resumes at the next step", async () => {
  const user = userEvent.setup();
  let savedBody: unknown;
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "rental_terms" }),
    ),
    http.patch("*/api/v1/submissions/:id/", async ({ request }) => {
      savedBody = await request.json();
      return HttpResponse.json({
        ...draft,
        current_step: "features_description",
      });
    }),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=rental_terms`);

  await user.type(
    await screen.findByLabelText("ودیعه، تومان"),
    "۱٬۰۰۰٬۰۰۰٬۰۰۰",
  );
  await user.type(screen.getByLabelText("اجاره ماهانه، تومان"), "۲۵٬۰۰۰٬۰۰۰");
  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));

  await waitFor(() =>
    expect(savedBody).toMatchObject({
      completed_step: "rental_terms",
      rental_terms: {
        deposit_toman: 1_000_000_000,
        monthly_rent_toman: 25_000_000,
      },
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "امکانات و توضیحات" }),
  ).toBeVisible();
});

test("attaches server validation to the field that failed", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "property_facts" }),
    ),
    http.patch("*/api/v1/submissions/:id/", () =>
      HttpResponse.json(
        {
          detail: "تعداد اتاق خواب نامعتبر است.",
          errors: {
            "property_facts.room_count": [
              {
                code: "min_value",
                message: "تعداد اتاق خواب نمی‌تواند منفی باشد.",
              },
            ],
          },
        },
        { status: 400 },
      ),
    ),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=property_facts`);

  await user.type(await screen.findByLabelText("متراژ"), "۱۱۰");
  await user.type(screen.getByLabelText("تعداد اتاق خواب"), "-۱");
  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));

  expect(
    (await screen.findAllByText("تعداد اتاق خواب نمی‌تواند منفی باشد."))[0],
  ).toBeVisible();
  expect(screen.getByLabelText("تعداد اتاق خواب")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("متراژ")).toHaveAttribute(
    "aria-invalid",
    "false",
  );
});

test("hydrates persisted final review data when a draft is resumed", async () => {
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({
        ...draft,
        current_step: "review",
        review: { accuracy_confirmed: true },
      }),
    ),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=review`);

  expect(
    await screen.findByLabelText(
      "اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.",
    ),
  ).toBeChecked();
});
