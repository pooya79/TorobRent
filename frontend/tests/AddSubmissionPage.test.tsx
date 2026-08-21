import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("lets reviewers navigate the guided Submission steps", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/add-submission?step=3"]}>
      <AddSubmissionPage />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("link", { name: "ادامه به شرایط اجاره" }));

  expect(screen.getByText(/مرحله ۴ از ۷/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "شرایط اجاره" })).toBeVisible();
  expect(screen.getByLabelText("ودیعه، تومان")).toBeVisible();
  expect(screen.getByLabelText("اجاره ماهانه، تومان")).toBeVisible();
});
