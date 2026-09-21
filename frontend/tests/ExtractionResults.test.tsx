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
  expect(within(row).getByRole("link", { name: "بررسی آگهی" })).toHaveAttribute(
    "href",
    "/operator/source-proposals/proposal?candidate=candidate-25#exceptions",
  );
  await user.type(screen.getByLabelText("جست‌وجوی عنوان یا نشانی آگهی"), "25");
  expect(screen.getByText(/۱ نتیجه مطابق فیلتر/)).toHaveAttribute(
    "role",
    "status",
  );
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
  const confirmation = screen.getByRole("checkbox", {
    name: /نتایج را بررسی و انتشار همه موارد/,
  });
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
  expect(
    screen.getByRole("checkbox", { name: /نتایج را بررسی و انتشار همه موارد/ }),
  ).not.toBeChecked();
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

test("history keeps each run's publication breakdown separate", () => {
  const requests = [
    {
      id: "first",
      canonical_url: "https://example.com/first",
      created_at: "2026-09-11T12:00:00Z",
      state: "complete",
      run: {
        ...run,
        published: 10,
        publication_outcomes: {
          new: 10,
          updated: 0,
          unchanged: 0,
          unclassified: 0,
        },
      },
    },
    {
      id: "second",
      canonical_url: "https://example.com/second",
      created_at: "2026-09-12T12:00:00Z",
      state: "complete",
      run: {
        ...run,
        published: 10,
        publication_outcomes: {
          new: 0,
          updated: 1,
          unchanged: 9,
          unclassified: 0,
        },
      },
    },
  ] as unknown as Request[];
  render(<ExtractionHistory requests={requests} />, { wrapper: setup() });
  const first = within(screen.getByRole("row", { name: /example.com\/first/ }));
  const second = within(
    screen.getByRole("row", { name: /example.com\/second/ }),
  );
  expect(first.getByText("آگهی جدید").parentElement).toHaveTextContent("۱۰");
  expect(second.getByText("آگهی جدید").parentElement).toHaveTextContent("۰");
  expect(second.getByText("به‌روزرسانی‌شده").parentElement).toHaveTextContent(
    "۱",
  );
  expect(second.getByText("بدون تغییر").parentElement).toHaveTextContent("۹");
});

test("fetches only the requested result page and sends search and filters to the server", async () => {
  const { http, HttpResponse } = await import("msw");
  const { server } = await import("./server");
  const requests: URL[] = [];
  server.use(
    http.get(
      "*/api/v1/operator/source-proposals/:id/results/",
      ({ request }) => {
        const url = new URL(request.url);
        requests.push(url);
        const page = Number(url.searchParams.get("page"));
        return HttpResponse.json({
          count: 25,
          results:
            page === 2 ? run.candidates.slice(20) : run.candidates.slice(0, 20),
        });
      },
    ),
  );
  const user = userEvent.setup();
  render(
    <ExtractionRunReview
      remote
      properties={[]}
      proposalId="proposal"
      canApprove={false}
    />,
    { wrapper: setup() },
  );
  expect(await screen.findByText("آگهی 20")).toBeVisible();
  expect(screen.queryByText("آگهی 25")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "صفحه بعد" }));
  expect(await screen.findByText("آگهی 25")).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("page")).toBe("2");
  await user.click(screen.getByRole("button", { name: "نیازمند رسیدگی" }));
  expect(requests.at(-1)?.searchParams.get("status")).toBe("issues");
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  await user.type(screen.getByLabelText("جست‌وجوی عنوان یا نشانی آگهی"), "25");
  expect(requests.at(-1)?.searchParams.get("q")).toBe("25");
});
