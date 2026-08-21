import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { OperatorReviewPage } from "@/pages/OperatorReviewPage";

test("presents the Operator queue with reasons and review history", () => {
  render(
    <MemoryRouter>
      <OperatorReviewPage />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "صف بررسی آگهی‌ها" }),
  ).toBeVisible();
  expect(screen.getByText("۱۲ مورد در انتظار بررسی")).toBeVisible();
  expect(screen.getByText("مدرک مالکیت نیاز به بررسی دارد")).toBeVisible();
  expect(screen.getByRole("heading", { name: "تاریخچه وضعیت" })).toBeVisible();
  expect(screen.getByRole("button", { name: "تأیید و انتشار" })).toBeVisible();
  expect(screen.getByRole("button", { name: "درخواست اصلاح" })).toBeVisible();
});

test("does not expose the review queue without Operator permission", () => {
  render(
    <MemoryRouter
      initialEntries={["/operator/review?prototypeState=permission"]}
    >
      <OperatorReviewPage />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "دسترسی اپراتور لازم است" }),
  ).toBeVisible();
  expect(
    screen.queryByText("مدرک مالکیت نیاز به بررسی دارد"),
  ).not.toBeInTheDocument();
});

test("asks the Operator to confirm a review decision", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <OperatorReviewPage />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "درخواست اصلاح" }));

  expect(
    screen.getByRole("heading", { name: "درخواست اصلاح ارسال شود؟" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "انصراف" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "ارسال درخواست اصلاح" }),
  ).toBeVisible();
});
