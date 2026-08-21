import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Check,
  CircleHelp,
  Home,
  LayoutDashboard,
  LogIn,
  Mail,
  Menu,
  Plus,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "خانه", to: "/", icon: Home },
  { label: "جست‌وجو", to: "/search", icon: Search },
  { label: "راهنما", to: "/guide", icon: CircleHelp },
  { label: "تماس", to: "/contact", icon: Mail },
  { label: "ورود", to: "/login", icon: LogIn },
] as const;

const navigationClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
    isActive
      ? "bg-primary/10 text-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

function Brand() {
  return (
    <NavLink
      className="flex items-center gap-3 font-bold"
      to="/"
      aria-label="ترب‌رنت، خانه"
    >
      <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl">
        <Building2 className="size-5" aria-hidden="true" />
      </span>
      <span className="text-lg">ترب‌رنت</span>
    </NavLink>
  );
}

function PrimaryNavigation({ mobile = false }: { mobile?: boolean }) {
  const links = (
    <>
      {navigation.map((item) => {
        const Icon = item.icon;
        const link = (
          <NavLink
            className={navigationClass}
            to={item.to}
            end={item.to === "/"}
          >
            <Icon className="size-5" aria-hidden="true" />
            {item.label}
          </NavLink>
        );
        return mobile ? (
          <SheetClose asChild key={item.to}>
            {link}
          </SheetClose>
        ) : (
          <span key={item.to}>{link}</span>
        );
      })}
    </>
  );

  return (
    <nav className="grid gap-1" aria-label="راهبری اصلی">
      {links}
      <Button asChild className="mt-4 min-h-11 rounded-full" variant="outline">
        <NavLink to="/add-submission">
          <Plus aria-hidden="true" /> ثبت آگهی
        </NavLink>
      </Button>
      <Button asChild variant="outline" className="min-h-11">
        <NavLink to="/dashboard">
          <LayoutDashboard aria-hidden="true" /> آگهی‌های من
        </NavLink>
      </Button>
    </nav>
  );
}

export function ProductShell({ children }: { children: ReactNode }) {
  const health = useQuery({
    queryKey: ["health"],
    refetchInterval: (query) =>
      query.state.status === "error" ? 1_000 : false,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/system/ready/");
      if (error || !data) {
        throw new Error("Readiness check failed");
      }
      return data;
    },
  });

  return (
    <div className="min-h-screen overflow-x-clip">
      <aside className="border-border bg-background fixed inset-y-0 start-0 z-30 hidden w-72 border-e px-5 py-6 lg:flex lg:flex-col">
        <Brand />
        <div className="mt-10 flex-1">
          <PrimaryNavigation />
        </div>
        <p className="text-muted-foreground text-xs leading-6">
          جست‌وجو و مقایسه شفاف آگهی‌های اجاره
        </p>
      </aside>

      <header className="border-border bg-background/95 sticky top-0 z-30 flex min-h-18 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
        <Brand />
        <Sheet>
          <SheetTrigger asChild>
            <Button
              size="icon"
              variant="secondary"
              aria-label="باز کردن فهرست راهبری"
            >
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[min(88vw,22rem)] pt-14">
            <SheetHeader className="text-start">
              <SheetTitle>راهبری ترب‌رنت</SheetTitle>
              <SheetDescription>به بخش موردنظر بروید.</SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <PrimaryNavigation mobile />
            </div>
          </SheetContent>
        </Sheet>
      </header>

      <div className="lg:ps-72">
        {children}
        <footer className="border-border mx-auto mt-16 flex w-full max-w-360 flex-col gap-5 border-t px-4 py-8 text-sm sm:px-6 lg:px-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p>ترب‌رنت؛ راه شفاف‌تر پیدا کردن خانه اجاره‌ای</p>
            <div className="text-muted-foreground flex flex-wrap gap-4">
              <NavLink
                className="inline-flex min-h-11 items-center"
                to="/guide"
              >
                راهنما
              </NavLink>
              <NavLink
                className="inline-flex min-h-11 items-center"
                to="/contact"
              >
                تماس
              </NavLink>
              <NavLink
                className="inline-flex min-h-11 items-center"
                to="/privacy"
              >
                حریم خصوصی
              </NavLink>
              <NavLink
                className="inline-flex min-h-11 items-center"
                to="/terms"
              >
                شرایط استفاده
              </NavLink>
            </div>
          </div>
          <div
            className="text-muted-foreground flex items-center gap-2 text-xs"
            role="status"
            aria-live="polite"
          >
            {health.data?.status === "ok" ? (
              <>
                <Check className="size-3" aria-hidden="true" /> سامانه در دسترس
                است
              </>
            ) : health.isPending ? (
              "در حال بررسی سامانه…"
            ) : (
              "سامانه موقتاً در دسترس نیست"
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
