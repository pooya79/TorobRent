import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test } from "vitest";

import { ProtectedMessageCenterRoute } from "@/features/messages/ProtectedMessageCenterRoute";

function LoginDestination() {
  const location = useLocation();
  return <p>ورود: {location.search}</p>;
}

test("restores the requested Message Center URL after login", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/messages/message-1?from=badge"]}>
        <Routes>
          <Route
            path="messages/:messageId"
            element={
              <ProtectedMessageCenterRoute>
                <h1>پیام‌ها</h1>
              </ProtectedMessageCenterRoute>
            }
          />
          <Route path="login" element={<LoginDestination />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText(
      "ورود: ?returnTo=%2Fmessages%2Fmessage-1%3Ffrom%3Dbadge",
    ),
  ).toBeVisible();
});
