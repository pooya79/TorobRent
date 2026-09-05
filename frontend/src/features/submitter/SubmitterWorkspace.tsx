import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CircleHelp,
  Globe2,
  LayoutDashboard,
  Mail,
  Plus,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Button } from "@/components/ui/button";
import { currentUserQuery } from "@/features/session/queries";
import { cn } from "@/lib/utils";

const links = [
  { to: "/dashboard", label: "آگهی‌های من", icon: LayoutDashboard, end: true },
  {
    to: "/dashboard/profile",
    label: "پروفایل من",
    icon: UserRound,
    end: false,
  },
  { to: "/messages", label: "پیام‌ها", icon: Mail, end: false },
  {
    to: "/source-proposal",
    label: "معرفی وب‌سایت اجاره",
    icon: Globe2,
    end: false,
  },
];

export function SubmitterWorkspace({ children }: { children: ReactNode }) {
  const user = useQuery(currentUserQuery);
  const name = user.data?.display_name || user.data?.first_name || "حساب من";
  const navigation = (
    <>
      <Button asChild className="mb-4 w-full rounded-xl">
        <Link to="/add-submission?new=1">
          <Plus aria-hidden="true" />
          ثبت آگهی جدید
        </Link>
      </Button>
      <nav
        aria-label="منوی حساب کاربری"
        className="grid grid-cols-2 gap-1 lg:grid-cols-1"
      >
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                isActive
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )
            }
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  );
  return (
    <PageMain className="max-w-360 py-6 lg:py-10">
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <aside
          className="bg-card rounded-2xl border p-4 lg:sticky lg:top-6"
          aria-label="پنل ثبت‌کننده"
        >
          <Link
            to="/dashboard/profile"
            className="mb-1 flex items-center gap-3 rounded-xl p-2 lg:mb-5"
          >
            <span className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-2xl">
              <UserRound aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{name}</span>
              <span className="text-muted-foreground mt-1 block text-xs">
                مدیریت حساب و آگهی‌ها
              </span>
            </span>
          </Link>
          <div className="hidden lg:block">{navigation}</div>
          <details className="lg:hidden">
            <summary className="min-h-11 cursor-pointer rounded-lg px-2 py-3 text-sm font-medium">
              منوی حساب کاربری
            </summary>
            <div className="mt-3">{navigation}</div>
          </details>
          <div className="text-muted-foreground mt-5 hidden border-t pt-5 text-xs leading-6 lg:block">
            <Building2 className="mb-2 size-5" aria-hidden="true" />
            آگهی شما پس از بررسی منتشر می‌شود. وضعیت و درخواست‌های اصلاح را از
            اینجا دنبال کنید.
            <Link
              to="/messages/new/support"
              className="text-foreground mt-3 flex min-h-11 items-center gap-2 font-medium"
            >
              <CircleHelp className="size-4" aria-hidden="true" />
              ارتباط با پشتیبانی
            </Link>
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </PageMain>
  );
}
