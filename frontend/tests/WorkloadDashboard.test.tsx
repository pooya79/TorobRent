import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import {
  WorkloadDashboard,
  type WorkloadQueue,
} from "@/features/operator/WorkloadDashboard";

const queues: [WorkloadQueue, WorkloadQueue] = [
  {
    label: "آگهی‌ها",
    to: "/operator/submissions",
    isPending: false,
    isError: false,
    data: {
      unclaimed_count: 24,
      assigned_to_me_count: 8,
      aging_count: 6,
      aging_after_hours: 48,
    },
  },
  {
    label: "پشتیبانی",
    to: "/operator/support",
    isPending: false,
    isError: false,
    data: {
      unclaimed_count: 12,
      assigned_to_me_count: 5,
      aging_count: 4,
      aging_after_hours: 24,
      urgent_count: 3,
    },
  },
];

function show(items: WorkloadQueue[] = queues) {
  return render(
    <MemoryRouter>
      <WorkloadDashboard queues={items} />
    </MemoryRouter>,
  );
}

test("compares queues and switches to their distinct aging thresholds", async () => {
  const user = userEvent.setup();
  show();
  expect(screen.getByText("۳۶")).toBeVisible();
  expect(screen.getByText("۱۳")).toBeVisible();
  expect(
    screen.getByRole("img", {
      name: "آگهی‌ها: ۲۴ در انتظار مسئول، ۸ واگذارشده به من",
    }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "زمان انتظار" }));
  expect(screen.getByRole("button", { name: "زمان انتظار" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("img", {
      name: "آگهی‌ها: ۶ مورد با انتظار بیش از ۴۸ ساعت",
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("img", {
      name: "پشتیبانی: ۴ مورد با انتظار بیش از ۲۴ ساعت",
    }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: /درخواست فوری/ })).toHaveAttribute(
    "href",
    "/operator/support",
  );
});

test("withholds totals on partial failures while preserving available queue data", () => {
  show([queues[0], { ...queues[1], isError: true }]);
  expect(screen.getAllByText("—")).toHaveLength(3);
  expect(screen.getByRole("status")).toHaveTextContent(
    "آمار کامل در دسترس نیست",
  );
  expect(screen.getByRole("img", { name: /آگهی‌ها: ۲۴/ })).toBeVisible();
  expect(
    screen.queryByRole("img", { name: /پشتیبانی/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("مورد فوری یا با انتظار طولانی ندارید"),
  ).not.toBeInTheDocument();
});

test("handles empty workloads and hides analytics without accessible queues", () => {
  const { rerender } = show([
    {
      ...queues[0],
      data: {
        unclaimed_count: 0,
        assigned_to_me_count: 0,
        aging_count: 0,
        aging_after_hours: 48,
      },
    },
  ]);
  expect(
    screen.getByText("مورد فوری یا با انتظار طولانی ندارید"),
  ).toBeVisible();
  expect(within(screen.getByRole("img")).getAllByText("۰")).toHaveLength(2);
  rerender(
    <MemoryRouter>
      <WorkloadDashboard queues={[]} />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("region", { name: "تحلیل حجم کار" }),
  ).not.toBeInTheDocument();
});
