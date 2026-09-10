import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { ExtractionHistory } from "@/features/source-proposals/ExtractionHistory";
import { ExtractionRunReview } from "@/features/source-proposals/ExtractionRunReview";
import type { components } from "@/lib/api/schema";

type Run = components["schemas"]["ExtractionRun"];
type Request = components["schemas"]["ExtractionRequest"];
const run = {
  id: "run",
  revision: 1,
  state: "complete",
  errors: [],
  published: 0,
  extracted: 25,
  candidates: Array.from({ length: 25 }, (_, index) => ({
    id: `candidate-${index + 1}`,
    title: `آگهی ${index + 1}`,
    external_url: `https://example.com/${index + 1}`,
    state: "pending",
    superseded: false,
    exclusion_reason: "",
    validation_errors: index === 24 ? { area: ["متراژ را اصلاح کنید"] } : {},
    media: [],
  })),
} as unknown as Run;

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

test("makes results beyond the first five inspectable with pagination, search, and status filters", async () => {
  const user = userEvent.setup();
  render(<ExtractionRunReview run={run} proposalId="proposal" canApprove />, {
    wrapper: setup(),
  });
  expect(screen.getByText("آگهی 20")).toBeVisible();
  expect(screen.queryByText("آگهی 25")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "صفحه بعد" }));
  const row = screen.getByRole("row", { name: /آگهی 25 / });
  expect(row).toHaveTextContent("نیازمند رسیدگی");
  await user.click(within(row).getByRole("button", { name: "جزئیات" }));
  expect(screen.getByText("جزئیات آگهی 25")).toBeVisible();
  expect(
    within(row).getByRole("link", { name: "پرونده آگهی" }),
  ).toHaveAttribute(
    "href",
    "/operator/external-listings?proposal=proposal&candidate=candidate-25",
  );
  await user.type(screen.getByLabelText("جست‌وجوی عنوان یا نشانی آگهی"), "25");
  expect(screen.getByRole("status")).toHaveTextContent("۱ نتیجه مطابق فیلتر");
  expect(screen.getByText(/این اقدام همه ۲۴ نتیجه/)).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: /آماده تأیید انتشار ·/ }),
  );
  expect(
    screen.getByText("نتیجه‌ای مطابق جست‌وجو یا فیلتر پیدا نشد."),
  ).toBeVisible();
  await user.clear(screen.getByLabelText("جست‌وجوی عنوان یا نشانی آگهی"));
  expect(screen.getByText("آگهی 1")).toBeVisible();
});

test("requires fresh confirmation when refreshed results have a new revision", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ExtractionRunReview run={run} proposalId="proposal" canApprove />,
    { wrapper: setup() },
  );
  const confirmation = screen.getByRole("checkbox");
  await user.click(confirmation);
  expect(
    screen.getByRole("button", { name: "انتشار همه نتایج معتبر" }),
  ).toBeEnabled();
  rerender(
    <ExtractionRunReview
      run={{ ...run, revision: 2 }}
      proposalId="proposal"
      canApprove
    />,
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "انتشار همه نتایج معتبر" }),
  ).toBeDisabled();
});

test("selects a current run awaiting review and prevents publication of historical results", async () => {
  const user = userEvent.setup();
  const requests = [
    {
      id: "old",
      state: "complete",
      is_current: false,
      created_at: "2026-09-09T12:00:00Z",
      canonical_url: "https://example.com/old",
      run: { ...run, id: "old-run" },
    },
    {
      id: "current",
      state: "complete",
      is_current: true,
      created_at: "2026-09-10T12:00:00Z",
      canonical_url: "https://example.com/current",
      run,
    },
  ] as unknown as Request[];
  render(
    <ExtractionHistory
      requests={requests}
      review={{ proposalId: "proposal", canApprove: true }}
    />,
    { wrapper: setup() },
  );
  const table = screen.getByRole("table", {
    name: "نوبت‌های اخیر استخراج، از تازه به قدیمی",
  });
  expect(
    within(
      within(table).getByRole("row", { name: /example.com\/current/ }),
    ).getByRole("button"),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(
    within(
      within(table).getByRole("row", { name: /example.com\/old/ }),
    ).getByRole("button"),
  );
  expect(
    screen.getByText("سابقه استخراج؛ مجوز انتشار این نتایج پایان یافته است."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "انتشار همه نتایج معتبر" }),
  ).not.toBeInTheDocument();
});
