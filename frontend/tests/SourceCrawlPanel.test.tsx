import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { SourceCrawlPanel } from "@/features/source-proposals/SourceCrawlPanel";
import type { OperatorSourceProposal } from "@/features/source-proposals/queries";
import { server } from "./server";

test("retains the reviewed schedule revision when background polling updates the source", async () => {
  let body: unknown;
  const client = new QueryClient();
  const proposal = {
    id: "case",
    website_url: "https://example.com/rentals",
    assignment: {
      source: {
        processing_paused: false,
        crawl_interval_hours: 0,
        crawl_schedule_revision: 2,
      },
    },
  } as unknown as OperatorSourceProposal;
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/case/crawl/",
      async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { detail: "برنامه تغییر کرده است" },
          { status: 409 },
        );
      },
    ),
  );
  const panel = (value: OperatorSourceProposal) => (
    <QueryClientProvider client={client}>
      <SourceCrawlPanel
        proposal={value}
        onUpdate={() => {}}
        onExclusions={() => {}}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(panel(proposal));
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("فاصله دریافت اطلاعات"), "6");
  rerender(
    panel({
      ...proposal,
      assignment: {
        ...proposal.assignment!,
        source: {
          ...proposal.assignment!.source,
          crawl_interval_hours: 24,
          crawl_schedule_revision: 3,
        },
      },
    }),
  );
  await user.click(screen.getByRole("button", { name: "ذخیره برنامه دریافت" }));
  await waitFor(() =>
    expect(body).toEqual({
      action: "schedule",
      interval_hours: 6,
      reviewed_schedule_revision: 2,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "برنامه تغییر کرده است",
  );
  expect(screen.getByLabelText("فاصله دریافت اطلاعات")).toHaveValue("24");
});
