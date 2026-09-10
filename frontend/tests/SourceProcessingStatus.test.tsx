import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SourceProcessingStatus } from "@/features/source-proposals/SourceProcessingStatus";
import type { OperatorSourceProposal } from "@/features/source-proposals/queries";

function source(
  state?: string,
  options: { paused?: boolean; current?: boolean } = {},
) {
  return {
    assignment: {
      state: "active",
      review_mode: "approval_required",
      source: { processing_paused: options.paused ?? false },
      recent_requests: state
        ? [
            {
              id: "request",
              state,
              is_current: options.current ?? true,
              created_at: "2026-09-10T12:00:00Z",
              canonical_url: "https://example.com/rent",
              run: {
                attempted_pages: 12,
                extracted: 8,
                published: 0,
                needs_attention: 2,
                errors: [],
              },
            },
          ]
        : [],
    },
  } as unknown as OperatorSourceProposal;
}

test.each([
  [undefined, "استخراجی در درخواست‌های اخیر در حال اجرا نیست"],
  ["queued", "در صف شروع استخراج"],
  ["running", "در حال استخراج"],
  ["complete", "استخراجی در درخواست‌های اخیر در حال اجرا نیست"],
  ["failed", "آخرین استخراج ناموفق بود"],
])(
  "distinguishes processing permission from reported %s activity",
  (state, label) => {
    render(
      <SourceProcessingStatus proposal={source(state)} onResults={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(label);
  },
);

test("pause and superseded requests do not claim extraction is running", () => {
  const { rerender } = render(
    <SourceProcessingStatus
      proposal={source("running", { paused: true })}
      onResults={() => {}}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("متوقف");
  rerender(
    <SourceProcessingStatus
      proposal={source("running", { current: false })}
      onResults={() => {}}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "استخراجی در درخواست‌های اخیر در حال اجرا نیست",
  );
  expect(screen.getByText(/مربوط به پردازش قبلی/)).toBeVisible();
});

test("reflects refreshed activity, shows counts, and opens results", async () => {
  const onResults = vi.fn();
  const { rerender } = render(
    <SourceProcessingStatus
      proposal={source("queued")}
      onResults={onResults}
    />,
  );
  rerender(
    <SourceProcessingStatus
      proposal={source("running")}
      onResults={onResults}
      updatedAt={Date.parse("2026-09-10T12:00:00Z")}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("در حال استخراج");
  expect(screen.getByText("۱۲")).toBeVisible();
  expect(screen.getByText("۸")).toBeVisible();
  expect(screen.getByText(/آخرین دریافت وضعیت/)).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "مشاهده نتایج و خطاها" }),
  );
  expect(onResults).toHaveBeenCalledOnce();
  rerender(
    <SourceProcessingStatus
      proposal={source("complete")}
      onResults={onResults}
      stale
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "استخراجی در درخواست‌های اخیر در حال اجرا نیست",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("ممکن است قدیمی باشد");
});
