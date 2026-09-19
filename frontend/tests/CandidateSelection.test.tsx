import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { ExtractionRunReview } from "@/features/source-proposals/ExtractionRunReview";
import { server } from "./server";

function renderTable(enabled = true) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <ExtractionRunReview
          proposalId="source"
          properties={[]}
          remote
          canApprove={enabled}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function mockRows(count = 22) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `ad-${index}`,
    title: `آگهی ${index}`,
    revision: 3,
    external_url: `https://example.com/${index}`,
    state: "pending",
    is_current: true,
    validation_errors: {},
  }));
  server.use(
    http.get(
      "*/api/v1/operator/source-proposals/source/results/",
      ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
        return HttpResponse.json({
          count: rows.length,
          results: rows.slice((page - 1) * 20, page * 20),
        });
      },
    ),
  );
  return rows;
}

test("selects across pages, rejects without a note and clears selections before a fresh review", async () => {
  const rows = mockRows();
  const bodies: unknown[] = [];
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/source/results/decide/",
      async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          succeeded: rows.slice(0, 21).map((row) => row.id),
          failed: [{ id: "ad-21", detail: "نتیجه تغییر کرده است" }],
        });
      },
    ),
  );
  renderTable();
  const user = userEvent.setup();
  await screen.findByText("آگهی 0");
  await user.click(
    screen.getByRole("button", {
      name: "انتخاب همه آگهی‌های قابل بررسی مطابق فیلتر",
    }),
  );
  await screen.findByText("۲۲ آگهی انتخاب شده");
  await user.click(screen.getByRole("button", { name: "رد انتخاب‌شده‌ها" }));
  await screen.findByText(/۲۱ تصمیم ثبت شد/);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toEqual({
    action: "reject",
    reason: "",
    confirmed: false,
    items: rows.map((row) => ({ id: row.id, reviewed_revision: 3 })),
  });
  expect(screen.getByText("۰ آگهی انتخاب شده")).toBeVisible();
  expect(screen.getByText(/نتیجه تغییر کرده است/)).toBeVisible();
});

test("approves only checked ads after confirmation and clears selection on filter changes", async () => {
  mockRows(2);
  const bodies: unknown[] = [];
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/source/results/decide/",
      async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ succeeded: ["ad-0"], failed: [] });
      },
    ),
  );
  renderTable();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("checkbox", { name: "انتخاب آگهی 0" }),
  );
  expect(
    screen.getByRole("button", { name: "تأیید و انتشار انتخاب‌شده‌ها" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: "آگهی‌های انتخاب‌شده را بررسی و انتشار آن‌ها را تأیید می‌کنم",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "تأیید و انتشار انتخاب‌شده‌ها" }),
  );
  await screen.findByText("۱ تصمیم ثبت شد.");
  expect(bodies).toEqual([
    {
      action: "approve",
      reason: "",
      confirmed: true,
      items: [{ id: "ad-0", reviewed_revision: 3 }],
    },
  ]);
  await user.click(
    screen.getByRole("checkbox", {
      name: "انتخاب همه آگهی‌های قابل بررسی این صفحه",
    }),
  );
  expect(screen.getByText("۲ آگهی انتخاب شده")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "نیازمند رسیدگی" }));
  await waitFor(() =>
    expect(screen.getByText("۰ آگهی انتخاب شده")).toBeVisible(),
  );
});

test("read-only operators have no selection controls", async () => {
  mockRows(1);
  renderTable(false);
  await screen.findByText("آگهی 0");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /انتخاب همه/ })).toBeNull();
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("keeps bulk decisions busy after leaving and returning to the table", async () => {
  const rows = mockRows(2);
  const pending = deferred();
  const started = deferred();
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/source/results/decide/",
      async () => {
        started.resolve();
        await pending.promise;
        return HttpResponse.json({
          succeeded: rows.map((row) => row.id),
          failed: [],
        });
      },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (visible: boolean) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {visible && (
          <ExtractionRunReview
            proposalId="source"
            properties={[]}
            remote
            canApprove
          />
        )}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view(true));
  const user = userEvent.setup();
  await screen.findByText("آگهی 0");
  await user.click(
    screen.getByRole("button", {
      name: "انتخاب همه آگهی‌های قابل بررسی مطابق فیلتر",
    }),
  );
  await screen.findByText("۲ آگهی انتخاب شده");
  await user.click(
    screen.getByRole("checkbox", {
      name: "آگهی‌های انتخاب‌شده را بررسی و انتشار آن‌ها را تأیید می‌کنم",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "تأیید و انتشار انتخاب‌شده‌ها" }),
  );
  await started.promise;
  try {
    rerender(view(false));
    rerender(view(true));
    await screen.findByText("آگهی 0");
    expect(
      screen.getByRole("button", {
        name: "انتخاب همه آگهی‌های قابل بررسی مطابق فیلتر",
      }),
    ).toBeDisabled();
  } finally {
    pending.resolve();
  }
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "انتخاب همه آگهی‌های قابل بررسی مطابق فیلتر",
      }),
    ).toBeEnabled(),
  );
});

test("summarizes repeated conflicts and clears stale selections", async () => {
  const rows = mockRows(22);
  server.use(
    http.post("*/api/v1/operator/source-proposals/source/results/decide/", () =>
      HttpResponse.json({
        succeeded: [],
        failed: rows.map((row) => ({
          id: row.id,
          detail: "Another decision already changed this candidate.",
        })),
      }),
    ),
  );
  renderTable();
  const user = userEvent.setup();
  await screen.findByText("آگهی 0");
  await user.click(
    screen.getByRole("button", {
      name: "انتخاب همه آگهی‌های قابل بررسی مطابق فیلتر",
    }),
  );
  await screen.findByText("۲۲ آگهی انتخاب شده");
  await user.click(screen.getByRole("button", { name: "رد انتخاب‌شده‌ها" }));
  const summary = await screen.findByText(/۰ تصمیم ثبت شد/);
  expect(summary.textContent.length).toBeLessThan(500);
  expect(screen.getByText("۰ آگهی انتخاب شده")).toBeVisible();
});
