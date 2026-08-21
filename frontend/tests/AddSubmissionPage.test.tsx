import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { AddSubmissionPage } from "@/pages/AddSubmissionPage";

test("presents a resumable seven-step Submission with tri-state features", () => {
  render(
    <MemoryRouter>
      <AddSubmissionPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "ثبت آگهی اجاره" })).toBeVisible();
  expect(screen.getByText(/مرحله ۳ از ۷/)).toBeVisible();
  expect(screen.getByText("پیش‌نویس ذخیره شده")).toBeVisible();
  for (const state of ["دارد", "ندارد", "نمی‌دانم"]) {
    expect(screen.getByRole("radio", { name: state })).toBeVisible();
  }
});

test("connects Persian validation guidance to the invalid field", () => {
  render(
    <MemoryRouter
      initialEntries={["/add-submission?prototypeState=validation"]}
    >
      <AddSubmissionPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("متراژ را بررسی کنید");
  expect(screen.getByLabelText("متراژ")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByText("متراژ باید بیشتر از صفر باشد.")).toBeVisible();
});
