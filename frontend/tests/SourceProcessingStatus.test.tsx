import type { components } from "@/lib/api/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SourceProcessingStatus } from "@/features/source-proposals/SourceProcessingStatus";
import type { OperatorSourceProposal } from "@/features/source-proposals/queries";

function source(
  state?: string,
  options: {
    run?: Partial<components["schemas"]["ExtractionRun"]>;
    paused?: boolean;
    current?: boolean;
    deliveryError?: string;
    schedule?: {
      crawl_interval_hours: number;
      next_crawl_at: string;
      crawl_schedule_error?: string;
    };
  } = {},
) {
  return {
    assignment: {
      state: "active",
      review_mode: "approval_required",
      source: {
        processing_paused: options.paused ?? false,
        ...options.schedule,
      },
      recent_requests: state
        ? [
            {
              id: "request",
              delivery_error: options.deliveryError ?? "",
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
                ...options.run,
              },
            },
          ]
        : [],
    },
  } as unknown as OperatorSourceProposal;
}

test.each([
  [undefined, "درخواست اخیر فعالی نیست"],
  ["queued", "در صف شروع استخراج"],
  ["running", "در حال استخراج"],
  ["complete", "درخواست اخیر فعالی نیست"],
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
    "درخواست اخیر فعالی نیست",
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
    "درخواست اخیر فعالی نیست",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("ممکن است قدیمی باشد");
});

test("shows the exact next scheduled fetch timestamp", () => {
  render(
    <SourceProcessingStatus
      proposal={source(undefined, {
        schedule: {
          crawl_interval_hours: 6,
          next_crawl_at: "2026-09-13T12:00:00Z",
        },
      })}
      onResults={() => {}}
      updatedAt={Date.parse("2026-09-12T06:00:00Z")}
    />,
  );
  const timestamp = screen.getByText(/۱۴۰۵\/۶\/۲۲/);
  expect(timestamp).toHaveAttribute("datetime", "2026-09-13T12:00:00Z");
  expect(screen.getByText(/دریافت از نشانی اصلی هر ۶ ساعت/)).toBeVisible();
  expect(screen.queryByText(/نوبت سررسید شده است/)).not.toBeInTheDocument();
});

test("reports an overdue schedule as awaiting dispatch rather than running", () => {
  render(
    <SourceProcessingStatus
      proposal={source(undefined, {
        schedule: {
          crawl_interval_hours: 6,
          next_crawl_at: "2026-09-13T12:00:00Z",
        },
      })}
      onResults={() => {}}
      updatedAt={Date.parse("2026-09-13T12:01:00Z")}
    />,
  );
  expect(
    screen.getByText(
      /نوبت سررسید شده است؛ در انتظار ثبت درخواست توسط زمان‌بندی/,
    ),
  ).toBeVisible();
  expect(screen.getByText("درخواست اخیر فعالی نیست")).toBeVisible();
  expect(screen.queryByText("در حال استخراج")).not.toBeInTheDocument();
});

test("shows a paused schedule without claiming its overdue slot will dispatch", () => {
  render(
    <SourceProcessingStatus
      proposal={source(undefined, {
        paused: true,
        schedule: {
          crawl_interval_hours: 6,
          next_crawl_at: "2026-09-13T12:00:00Z",
        },
      })}
      onResults={() => {}}
      updatedAt={Date.parse("2026-09-13T12:01:00Z")}
    />,
  );
  expect(screen.getByText("برنامه در حالت توقف")).toBeVisible();
  expect(screen.queryByText(/نوبت سررسید شده است/)).not.toBeInTheDocument();
});

test("surfaces the scheduler dispatch failure to the operator", () => {
  render(
    <SourceProcessingStatus
      proposal={source(undefined, {
        schedule: {
          crawl_interval_hours: 6,
          next_crawl_at: "2026-09-13T12:00:00Z",
          crawl_schedule_error: "صف پردازش در دسترس نیست",
        },
      })}
      onResults={() => {}}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "آخرین نوبت وارد صف نشد: صف پردازش در دسترس نیست",
  );
});

test("shows delivery failure and automatic retry guidance for a queued request", () => {
  render(
    <SourceProcessingStatus
      proposal={source("queued", {
        deliveryError:
          "ارسال به صف ممکن نشد؛ سامانه هر دقیقه دوباره تلاش می‌کند.",
      })}
      onResults={() => {}}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("در صف شروع استخراج");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "ارسال به صف ممکن نشد؛ سامانه هر دقیقه دوباره تلاش می‌کند.",
  );
});

test("reports publication changes separately from successful publications", () => {
  const proposal = source("complete", {
    run: {
      published: 8,
      publication_outcomes: {
        new: 2,
        updated: 1,
        unchanged: 5,
        unclassified: 0,
      },
    },
  });
  render(<SourceProcessingStatus proposal={proposal} onResults={() => {}} />);
  for (const [label, count] of [
    ["آگهی جدید", "۲"],
    ["به‌روزرسانی‌شده", "۱"],
    ["بدون تغییر", "۵"],
  ]) {
    expect(screen.getByText(label!).parentElement).toHaveTextContent(count!);
  }
  expect(screen.queryByText(/انتشار قدیمی/)).not.toBeInTheDocument();
});

test("does not invent a breakdown for historical publications", () => {
  const proposal = source("complete", {
    run: {
      published: 8,
      publication_outcomes: {
        new: 0,
        updated: 0,
        unchanged: 0,
        unclassified: 8,
      },
    },
  });
  render(<SourceProcessingStatus proposal={proposal} onResults={() => {}} />);
  expect(
    screen.getByText(/تفکیک نتیجه برای ۸ انتشار قدیمی ثبت نشده است/),
  ).toBeInTheDocument();
  expect(screen.getByText("آگهی جدید").parentElement).toHaveTextContent("—");
});
