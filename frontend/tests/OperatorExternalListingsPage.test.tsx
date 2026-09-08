import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { OperatorExternalListingsPage } from "@/pages/OperatorExternalListingsPage";
import { server } from "./server";

const proposals = [
  {
    id: "blue",
    website_name: "خانه آبی",
    submitter: { display_name: "علی کریمی", account_label: "ali@example.com" },
    responsibility: { operator: "me", operator_label: "me@example.com" },
    assignment: { state: "active", review_operator: "me" },
  },
  {
    id: "green",
    website_name: "خانه سبز",
    submitter: {
      display_name: "سارا احمدی",
      account_label: "sara@example.com",
    },
    responsibility: { operator: "other", operator_label: "other@example.com" },
    assignment: { state: "active", review_operator: "other" },
  },
];
const candidates = [
  {
    id: "one",
    source_proposal_id: "blue",
    extraction_run: "run",
    title: "آپارتمان نورگیر",
    source: { display_name: "خانه آبی", domain: "blue.example" },
    state: "pending",
    area_sqm: 85,
    property_type: "apartment",
    deposit_rial: 0,
    monthly_rent_rial: null,
    external_url: "https://blue.example/one",
    created_at: "2026-09-01T08:00:00Z",
    revision: 1,
    media: [],
    history: [],
    validation_errors: {},
  },
  {
    id: "two",
    source_proposal_id: "green",
    extraction_run: "run",
    title: "دفتر اداری",
    source: { display_name: "خانه سبز", domain: "green.example" },
    state: "pending",
    area_sqm: null,
    property_type: "office",
    deposit_rial: 8000000000,
    monthly_rent_rial: 250000000,
    external_url: "https://green.example/two",
    created_at: "2026-09-02T08:00:00Z",
    revision: 1,
    media: [],
    history: [],
    validation_errors: { area_sqm: ["متراژ ثبت نشده"] },
  },
];
function setup(path = "/operator/external-listings", items = candidates) {
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "me",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json(proposals),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json(items),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <OperatorExternalListingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("shows representative, source, operator and rental terms without mounting review forms", async () => {
  setup();
  const row = await screen.findByRole("article", { name: "آپارتمان نورگیر" });
  expect(await within(row).findByText("علی کریمی")).toBeVisible();
  expect(within(row).getByText("واگذارشده به من")).toBeVisible();
  expect(within(row).getByText("۰ تومان")).toBeVisible();
  expect(within(row).getByText("نامشخص")).toBeVisible();
  expect(within(row).getByRole("link", { name: "خانه آبی" })).toHaveAttribute(
    "href",
    "/operator/source-proposals/blue",
  );
  expect(
    screen.queryByRole("button", { name: "شروع بررسی آپارتمان نورگیر" }),
  ).not.toBeInTheDocument();
});

test("combines assignment, attention, source and Persian-normalized representative search", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByText("علی کریمی");
  await user.type(
    screen.getByLabelText("جست‌وجوی آگهی و نماینده"),
    "علي كريمي",
  );
  expect(screen.getAllByRole("article")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "پاک کردن فیلترها" }));
  await user.click(screen.getByRole("button", { name: /واگذارشده به من/ }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(
    screen.getByRole("article", { name: "آپارتمان نورگیر" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /نیازمند اصلاح/ }));
  expect(screen.getByRole("article", { name: "دفتر اداری" })).toBeVisible();
  await user.selectOptions(screen.getByLabelText("منبع"), "blue");
  expect(screen.getByText("آگهی مطابق این فیلترها پیدا نشد")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "پاک کردن فیلترها" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
});

test("keeps source filters when opening and closing review and restores focus", async () => {
  const user = userEvent.setup();
  setup("/operator/external-listings?proposal=green");
  const open = await screen.findByRole("button", {
    name: "مشاهده و بررسی دفتر اداری",
  });
  await user.click(open);
  const dialog = screen.getByRole("dialog", { name: "بررسی آگهی" });
  expect(await within(dialog).findByText("سارا احمدی")).toBeVisible();
  expect(within(dialog).getByText("other@example.com")).toBeVisible();
  expect(
    within(dialog).getByRole("button", { name: "شروع بررسی دفتر اداری" }),
  ).toBeDisabled();
  expect(
    within(dialog).getByText(/تصمیم‌گیری این آگهی با اپراتور مسئول/),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(open).toHaveFocus();
  expect(screen.getByLabelText("منبع")).toHaveValue("green");
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

test("supports review deep links, sorts and paginates the queue", async () => {
  const user = userEvent.setup();
  setup("/operator/external-listings?candidate=two", [
    ...candidates,
    ...Array.from({ length: 20 }, (_, i) => ({
      ...candidates[0]!,
      id: `extra-${i}`,
      title: `ملک ${i}`,
      created_at: "2026-09-03T08:00:00Z",
    })),
  ]);
  expect(
    await screen.findByRole("dialog", { name: "بررسی آگهی" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "بستن" }));
  expect(screen.getAllByRole("article")).toHaveLength(20);
  await user.click(screen.getByRole("button", { name: "صفحه بعد" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
  await user.selectOptions(screen.getByLabelText("ترتیب نمایش"), "newest");
  expect(screen.getAllByRole("article")).toHaveLength(20);
  expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("ملک 0");
});

test("keeps the queue usable when source identities fail to load", async () => {
  setup();
  server.use(
    http.get(
      "*/api/v1/operator/source-proposals/",
      () => new HttpResponse(null, { status: 503 }),
    ),
  );
  expect(
    await screen.findByText(/اطلاعات نماینده و مسئول منابع بارگذاری نشد/),
  ).toBeVisible();
  const row = screen.getByRole("article", { name: "آپارتمان نورگیر" });
  expect(within(row).getByText("اطلاعات نماینده در دسترس نیست")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "تلاش دوباره برای منابع" }),
  ).toBeVisible();
});
