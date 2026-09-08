import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";

import { SourceConversationButton } from "@/features/source-proposals/SourceConversationButton";
import { SourceConversationPicker } from "@/features/messages/SourceConversationPicker";
import { server } from "./server";

function renderAction(component: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <Routes>
          <Route path="/" element={component} />
          <Route path="/messages/thread-id" element={<h1>گفت‌وگوی منبع</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test.each([false])(
  "source detail opens its conversation (operator=%s)",
  async (operator) => {
    const user = userEvent.setup();
    let proposalId = "";
    server.use(
      http.post(
        "*/api/v1/messages/source-conversations/",
        async ({ request }) => {
          proposalId = ((await request.json()) as { proposal_id: string })
            .proposal_id;
          return HttpResponse.json({
            id: "thread-id",
            href: "/messages/thread-id",
          });
        },
      ),
    );
    renderAction(
      <SourceConversationButton proposalId="proposal-id" operator={operator} />,
    );
    await user.click(
      screen.getByRole("button", {
        name: operator ? "گفت‌وگو با نماینده منبع" : "تماس با تیم بررسی",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "گفت‌وگوی منبع" }),
    ).toBeInTheDocument();
    expect(proposalId).toBe("proposal-id");
  },
);

test("Message Center selects a source and retains a recoverable open error", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/messages/source-conversations/", () =>
      HttpResponse.json([
        {
          proposal_id: "proposal-id",
          website_name: "خانه‌یاب",
          operator: false,
        },
      ]),
    ),
    http.post("*/api/v1/messages/source-conversations/", () =>
      HttpResponse.json({ detail: "unavailable" }, { status: 404 }),
    ),
  );
  renderAction(<SourceConversationPicker />);
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "انتخاب منبع برای گفت‌وگو" }),
    "proposal-id",
  );
  await user.click(screen.getByRole("button", { name: "تماس با تیم بررسی" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "گفت‌وگو در دسترس نیست",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "تماس با تیم بررسی" }),
    ).toBeEnabled(),
  );
});

test("operator reads and replies without leaving source review", async () => {
  const user = userEvent.setup();
  let replyBody = "";
  server.use(
    http.post("*/api/v1/messages/source-conversations/", () =>
      HttpResponse.json({ id: "thread-id", href: "/messages/thread-id" }),
    ),
    http.get("*/api/v1/messages/thread-id/", () =>
      HttpResponse.json({
        id: "thread-id",
        kind: "source_conversation",
        title: "گفت‌وگوی منبع",
        reply_allowed: true,
        entries: [
          {
            id: "entry-1",
            author_name: "نماینده منبع",
            body: replyBody || "سلام تیم بررسی",
            created_at: "2026-09-08T10:00:00Z",
            mine: false,
          },
        ],
      }),
    ),
    http.post(
      "*/api/v1/messages/source-conversations/thread-id/replies/",
      async ({ request }) => {
        replyBody = ((await request.json()) as { body: string }).body;
        return HttpResponse.json({ id: "reply-id" }, { status: 201 });
      },
    ),
  );
  renderAction(
    <>
      <h1>بررسی منبع</h1>
      <SourceConversationButton proposalId="proposal-id" operator />
    </>,
  );
  await user.click(
    screen.getByRole("button", { name: "گفت‌وگو با نماینده منبع" }),
  );
  expect(await screen.findByText("سلام تیم بررسی")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "بررسی منبع" }),
  ).toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "ادامه گفت‌وگو" }),
    "لطفا نشانی را بفرستید",
  );
  await user.click(screen.getByRole("button", { name: "ارسال پیام" }));
  expect(await screen.findByText("لطفا نشانی را بفرستید")).toBeInTheDocument();
  expect(replyBody).toBe("لطفا نشانی را بفرستید");
  expect(
    screen.getByRole("heading", { name: "بررسی منبع" }),
  ).toBeInTheDocument();
});

test("operator can retry loading and sees read-only conversations in place", async () => {
  const user = userEvent.setup();
  let unavailable = true;
  server.use(
    http.post("*/api/v1/messages/source-conversations/", () =>
      HttpResponse.json({ id: "thread-id", href: "/messages/thread-id" }),
    ),
    http.get("*/api/v1/messages/thread-id/", () =>
      unavailable
        ? HttpResponse.json({ detail: "unavailable" }, { status: 503 })
        : HttpResponse.json({
            id: "thread-id",
            kind: "source_conversation",
            reply_allowed: false,
            entries: [],
          }),
    ),
  );
  renderAction(<SourceConversationButton proposalId="proposal-id" operator />);
  await user.click(
    screen.getByRole("button", { name: "گفت‌وگو با نماینده منبع" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "بارگذاری گفت‌وگو انجام نشد",
  );
  unavailable = false;
  await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));
  expect(
    await screen.findByText("این گفت‌وگو فقط خواندنی است."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
