import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DevelopmentMailHint } from "@/features/session/DevelopmentMailHint";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("does not advertise a development inbox when none is configured", () => {
  vi.stubEnv("VITE_MAILPIT_URL", "");

  render(<DevelopmentMailHint />);

  expect(
    screen.queryByRole("link", { name: "صندوق ایمیل Mailpit" }),
  ).not.toBeInTheDocument();
});
