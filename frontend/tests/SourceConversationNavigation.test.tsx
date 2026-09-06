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

test.each([false, true])(
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
