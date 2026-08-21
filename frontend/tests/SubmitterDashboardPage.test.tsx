import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { SubmitterDashboardPage } from "@/pages/SubmitterDashboardPage";

test("shows a Submitter the status and next action for each Submission", () => {
  render(<SubmitterDashboardPage />);

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
