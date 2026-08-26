import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { createFakeMapAdapter } from "@/features/map/adapter";
import { SearchMapPanel } from "@/features/map/SearchMapPanel";

afterEach(() => vi.useRealTimers());

test("degrades compactly, keeps attribution visible, and retries the provider", async () => {
  const user = userEvent.setup();
  const onAvailabilityChange = vi.fn();
  const FakeMapAdapter = createFakeMapAdapter({ failAttempts: 1 });

  render(
    <SearchMapPanel
      adapter={FakeMapAdapter}
      markers={[]}
      clusters={[]}
      onAvailabilityChange={onAvailabilityChange}
    />,
  );

  expect(await screen.findByText("نقشه موقتاً در دسترس نیست")).toBeVisible();
  expect(onAvailabilityChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("link", { name: "نشان" })).toBeVisible();

  await user.click(
    screen.getByRole("button", { name: "تلاش دوباره برای نقشه" }),
  );

  expect(
    await screen.findByRole("application", { name: "نقشه تعاملی ملک‌ها" }),
  ).toBeVisible();
  expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);
});

test("automatically retries without requiring Renter action", () => {
  vi.useFakeTimers();
  const FakeMapAdapter = createFakeMapAdapter({ failAttempts: 1 });

  render(
    <SearchMapPanel adapter={FakeMapAdapter} markers={[]} clusters={[]} />,
  );

  expect(screen.getByText("نقشه موقتاً در دسترس نیست")).toBeVisible();

  void act(() => vi.advanceTimersByTime(5_000));

  expect(
    screen.getByRole("application", { name: "نقشه تعاملی ملک‌ها" }),
  ).toBeVisible();
});
