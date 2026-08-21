import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { SubmitterDashboardPage } from "@/pages/SubmitterDashboardPage";

test("shows a Submitter the status and next action for each Submission", () => {
  render(
    <MemoryRouter>
      <SubmitterDashboardPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "آگهی‌های من" })).toBeVisible();
  for (const status of ["نیازمند اصلاح", "در انتظار بررسی", "منتشر شده"]) {
    expect(screen.getByText(status)).toBeVisible();
  }
  expect(
    screen.getByRole("link", { name: "رفع ایرادهای آگهی سعادت‌آباد" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "مشاهده جزئیات آگهی یوسف‌آباد" }),
  ).toHaveAttribute("href", "/dashboard?submission=yousef-abad");
});

test("expands the Submission selected by the dashboard action URL", () => {
  render(
    <MemoryRouter initialEntries={["/dashboard?submission=yousef-abad"]}>
      <SubmitterDashboardPage />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "جزئیات ارسال آگهی یوسف‌آباد" }),
  ).toBeVisible();
  expect(
    screen.getByText("گام بعدی: منتظر بررسی اپراتور بمانید."),
  ).toBeVisible();
});
