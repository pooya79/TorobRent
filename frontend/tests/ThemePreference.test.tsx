import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";

import { THEME_STORAGE_KEY, ThemeProvider } from "@/app/ThemeProvider";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

let setSystemDark: (dark: boolean) => void;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.remove();
  });
  const themeColor = document.createElement("meta");
  themeColor.name = "theme-color";
  document.head.append(themeColor);

  let dark = false;
  const listeners = new Set<EventListener>();
  const colorScheme = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: EventListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => colorScheme,
  });
  setSystemDark = (next) => {
    dark = next;
    listeners.forEach((listener) => listener(new Event("change")));
  };
});

test("user can choose a device-local dark theme", async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );

  const switcher = screen.getByRole("combobox", {
    name: "پوستهٔ نمایش: سیستم",
  });

  await user.click(switcher);
  await user.click(screen.getByRole("option", { name: "تیره" }));

  await waitFor(() => {
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  expect(
    screen.getByRole("combobox", { name: "پوستهٔ نمایش: تیره" }),
  ).toBeVisible();
});

test("stored preference is restored and reacts to browser storage changes", async () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );

  await waitFor(() => {
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
  expect(
    screen.getByRole("combobox", { name: "پوستهٔ نمایش: روشن" }),
  ).toBeVisible();

  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: THEME_STORAGE_KEY,
      newValue: "dark",
      storageArea: window.localStorage,
    }),
  );

  await waitFor(() => {
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
  expect(
    screen.getByRole("combobox", { name: "پوستهٔ نمایش: تیره" }),
  ).toBeVisible();
});

test("System preference follows operating-system theme changes", async () => {
  render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );

  const switcher = screen.getByRole("combobox", {
    name: "پوستهٔ نمایش: سیستم",
  });
  const themeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  await waitFor(() => expect(themeColor).toHaveAttribute("content", "#ffffff"));
  expect(switcher).toBeVisible();
  expect(document.documentElement).not.toHaveAttribute("data-theme");

  setSystemDark(true);

  await waitFor(() => expect(themeColor).toHaveAttribute("content", "#121214"));
  expect(switcher).toBeVisible();
  expect(document.documentElement).not.toHaveAttribute("data-theme");
});
