import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PreferenceControls } from "@/features/catalog/PreferenceControls";

test("preference shortcuts and area slider submit numeric targets and preserve filters", async () => {
  const user = userEvent.setup();
  const setSearchParams = vi.fn();
  render(
    <PreferenceControls
      searchParams={new URLSearchParams("area_min=50&page=2")}
      setSearchParams={setSearchParams}
    />,
  );
  await user.click(screen.getByRole("button", { name: "ترجیحات من" }));
  for (const label of [
    "متراژ",
    "تعداد اتاق خواب",
    "سال ساخت",
    "تازگی تایید موجود بودن",
  ]) {
    await user.click(
      within(
        screen.getByRole("radiogroup", { name: `اهمیت ${label}` }),
      ).getByRole("radio", { name: "ترجیح می‌دهم" }),
    );
  }
  await user.click(screen.getByRole("button", { name: "۱۲۰ متر" }));
  expect(
    screen.getByLabelText("متر مربع دلخواه", { selector: "input" }),
  ).toHaveValue("۱۲۰");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "135" } });
  await user.click(screen.getByRole("button", { name: "بدون اتاق" }));
  await user.click(screen.getByRole("button", { name: "از ۱۴۰۰" }));
  await user.click(screen.getByRole("button", { name: "۷ روز" }));
  await user.click(
    screen.getByRole("button", { name: "اعمال و مرتب‌سازی ترجیحات" }),
  );
  const params = setSearchParams.mock.calls[0]![0] as URLSearchParams;
  expect(JSON.parse(params.get("preferences")!)).toEqual({
    area: { priority: "preferred", target: 135 },
    bedroom_count: { priority: "preferred", target: 0 },
    construction_year: { priority: "preferred", target: 1400 },
    freshness: { priority: "preferred", target: 7 },
  });
  expect(params.get("area_min")).toBe("50");
  expect(params.has("page")).toBe(false);
});

test("saved large areas stay exact and Persian custom values override presets", async () => {
  const user = userEvent.setup();
  const setSearchParams = vi.fn();
  render(
    <PreferenceControls
      searchParams={
        new URLSearchParams({
          preferences: JSON.stringify({
            area: { priority: "preferred", target: 750 },
          }),
        })
      }
      setSearchParams={setSearchParams}
    />,
  );
  await user.click(screen.getByRole("button", { name: "ترجیحات من" }));
  expect(screen.getByRole("slider")).toHaveValue("750");
  const input = screen.getByLabelText("متر مربع دلخواه", { selector: "input" });
  await user.clear(input);
  await user.type(input, "۱۲۷");
  expect(screen.getByRole("slider")).toHaveValue("127");
  await user.click(
    screen.getByRole("button", { name: "اعمال و مرتب‌سازی ترجیحات" }),
  );
  const params = setSearchParams.mock.calls[0]![0] as URLSearchParams;
  expect(JSON.parse(params.get("preferences")!)).toEqual({
    area: { priority: "preferred", target: 127 },
  });
});
