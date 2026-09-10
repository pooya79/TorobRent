import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { SourceAssignmentSummary } from "@/features/source-proposals/SourceAssignmentSummary";
import type { components } from "@/lib/api/schema";

test("summarizes publication per request and only expands published URLs", async () => {
  const assignment = {
    state: "active",
    source: { processing_paused: false },
    active_profile_version: { number: 4 },
    max_pages: 999,
    exceptions: [{ detail: "internal diagnostic" }],
    recent_requests: [
      {
        id: "request",
        state: "complete",
        is_current: true,
        canonical_url: "https://example.com/rent",
        created_at: "2026-09-10T12:00:00Z",
        run: {
          published: 2,
          extracted: 7,
          attempts: 3,
          errors: [{ detail: "internal diagnostic" }],
          candidates: [
            {
              state: "published",
              external_url: "https://example.com/accepted",
            },
            {
              state: "published",
              external_url: "https://example.com/accepted",
            },
            { state: "pending", external_url: "https://example.com/pending" },
            { state: "rejected", external_url: "https://example.com/rejected" },
          ],
        },
      },
    ],
  } as unknown as components["schemas"]["SourceAssignment"];
  render(<SourceAssignmentSummary assignment={assignment} />);
  expect(
    screen.getByText("۲ آگهی در این درخواست منتشر شده است."),
  ).toBeVisible();
  expect(screen.queryByText("internal diagnostic")).not.toBeInTheDocument();
  expect(screen.queryByText(/نسخه فعال پروفایل/)).not.toBeInTheDocument();
  expect(screen.queryByText(/تعداد تلاش/)).not.toBeInTheDocument();
  expect(screen.getByRole("link")).not.toBeVisible();
  await userEvent.click(screen.getByText("مشاهده نشانی آگهی‌های منتشرشده"));
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    "https://example.com/accepted",
  );
  expect(
    screen.queryByText("https://example.com/pending"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("https://example.com/rejected"),
  ).not.toBeInTheDocument();
});

test.each(["queued", "running"])(
  "does not present %s extraction as approval",
  (state) => {
    const assignment = {
      state: "active",
      source: {},
      recent_requests: [
        {
          id: "request",
          state,
          is_current: true,
          run: null,
          canonical_url: "https://example.com/rent",
          created_at: "2026-09-10T12:00:00Z",
        },
      ],
    } as unknown as components["schemas"]["SourceAssignment"];
    render(<SourceAssignmentSummary assignment={assignment} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "در حال بررسی آگهی‌های وب‌سایت شما هستیم",
    );
    expect(screen.getByText("هنوز نتیجه‌ای ثبت نشده است.")).toBeVisible();
    expect(
      screen.queryByText(/آگهی در این درخواست منتشر شده/),
    ).not.toBeInTheDocument();
  },
);
