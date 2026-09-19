import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { DiscoveryUrlsTable } from "@/features/source-proposals/DiscoveryUrlsTable";
import type { OperatorSourceProposal } from "@/features/source-proposals/queries";

const proposal = {
  discovery: {
    pages: [
      {
        url: "https://example.com/current",
        classification: "rental_listing",
        description: "آگهی اجاره فعلی",
        is_current: true,
        last_fetched_at: "2026-09-19T09:00:00Z",
        http_status: 200,
      },
      {
        url: "https://example.com/previous",
        classification: "rental_index",
        description: "فهرست قبلی",
        is_current: false,
        last_fetched_at: null,
        http_status: null,
      },
    ],
  },
} as OperatorSourceProposal;

test("shows metadata and filters by run, class and description", async () => {
  const user = userEvent.setup();
  render(<DiscoveryUrlsTable proposal={proposal} />);
  const current = screen
    .getByRole("link", { name: "https://example.com/current" })
    .closest("tr")!;
  expect(within(current).getByText("جدید")).toBeVisible();
  expect(within(current).getByText("آگهی اجاره")).toBeVisible();
  expect(within(current).getByText("200")).toBeVisible();
  const previous = screen
    .getByRole("link", { name: "https://example.com/previous" })
    .closest("tr")!;
  expect(within(previous).getByText("قدیمی")).toBeVisible();
  expect(within(previous).getByText("ثبت نشده")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("فیلتر تازگی نشانی"), "old");
  expect(screen.queryByText("آگهی اجاره فعلی")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("فیلتر تازگی نشانی"), "all");
  await user.selectOptions(
    screen.getByLabelText("فیلتر کلاس صفحه"),
    "rental_listing",
  );
  expect(screen.queryByText("فهرست قبلی")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("فیلتر کلاس صفحه"), "all");
  await user.type(screen.getByLabelText("جست‌وجوی نشانی‌ها"), "فهرست قبلی");
  expect(screen.getByText("فهرست قبلی")).toBeVisible();
  expect(screen.queryByText("آگهی اجاره فعلی")).not.toBeInTheDocument();
});

test("keeps every URL accessible through pagination", async () => {
  const user = userEvent.setup();
  const many = {
    discovery: {
      pages: Array.from({ length: 26 }, (_, i) => ({
        ...proposal.discovery!.pages[0]!,
        url: `https://example.com/${i}`,
      })),
    },
  } as OperatorSourceProposal;
  render(<DiscoveryUrlsTable proposal={many} />);
  expect(screen.getAllByRole("link")).toHaveLength(25);
  await user.click(screen.getByRole("button", { name: "بعدی" }));
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(
    screen.getByRole("link", { name: "https://example.com/25" }),
  ).toBeVisible();
  await user.type(screen.getByLabelText("جست‌وجوی نشانی‌ها"), "/0");
  expect(
    screen.getByRole("link", { name: "https://example.com/0" }),
  ).toBeVisible();
});

test("translates legacy reasons and explains rows without saved details", () => {
  const legacy = {
    discovery: {
      pages: [
        {
          ...proposal.discovery!.pages[0]!,
          description:
            "Rental terminology is present؛ Property details found: اجاره ماهانه, listing id؛ The page links to 21 listing-like pages",
        },
        { ...proposal.discovery!.pages[1]!, description: "" },
      ],
    },
  } as OperatorSourceProposal;
  render(<DiscoveryUrlsTable proposal={legacy} />);
  expect(screen.getByText(/واژه‌های مربوط به رهن و اجاره/)).toHaveTextContent(
    "۲۱ صفحه مشابه آگهی",
  );
  expect(screen.getByText(/مشخصات ملک در صفحه/)).toHaveTextContent(
    "شناسه آگهی",
  );
  expect(
    screen.getByText(/این صفحه فهرستی از آگهی‌های اجاره است/),
  ).toBeVisible();
  expect(
    screen.queryByText(/Rental terminology|listing id/),
  ).not.toBeInTheDocument();
});
