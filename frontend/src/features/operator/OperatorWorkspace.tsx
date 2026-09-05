import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Home, Link2, Menu, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
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
import {
  operatorModules,
  type OperatorCapability,
} from "@/features/operator/modules";
import { currentUserQuery, sessionQuery } from "@/features/session/queries";
import { cn } from "@/lib/utils";

export type { OperatorCapability } from "@/features/operator/modules";

function WorkspaceState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-12"
      tabIndex={-1}
    >
      <Alert>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    </main>
  );
}

function navigationClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    isActive
      ? "bg-primary/10 text-primary ring-primary/15 ring-1"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

function WorkspaceNavigation({
  capabilities,
  mobile = false,
}: {
  capabilities: OperatorCapability[];
  mobile?: boolean;
}) {
  const navigation = [
    { label: "نمای کلی", to: "/operator", icon: Home },
    ...operatorModules.filter(({ capabilities: required }) =>
      required.some((capability) => capabilities.includes(capability)),
    ),
    {
      label: "بررسی پیوندها · به‌زودی",
      to: "/operator/links",
      icon: Link2,
    },
  ];

  return (
    <nav className="grid gap-2" aria-label="راهبری فضای اپراتور">
      {navigation.map(({ label, to, icon: Icon }) => {
        const link = (
          <NavLink className={navigationClass} to={to} end={to === "/operator"}>
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        );
        return mobile ? (
          <SheetClose asChild key={to}>
            {link}
          </SheetClose>
        ) : (
          <span key={to}>{link}</span>
        );
      })}
    </nav>
  );
}

function OperatorShell({
  capabilities,
}: {
  capabilities: OperatorCapability[];
}) {
  const location = useLocation();
  const currentSection =
    operatorModules.find(({ to }) => location.pathname.startsWith(to))?.label ??
    (location.pathname === "/operator/links" ? "بررسی پیوندها" : "نمای کلی");
  return (
    <div dir="rtl" className="bg-muted/30 min-h-screen">
      <a
        href="#main-content"
        className="bg-background text-primary fixed start-3 top-3 z-50 rounded-lg px-4 py-3 shadow-lg not-focus:sr-only"
      >
        رفتن به محتوای اصلی
      </a>
      <aside className="border-border bg-background fixed inset-y-0 start-0 z-30 hidden w-72 overflow-y-auto border-e px-5 py-6 lg:flex lg:flex-col">
        <NavLink
          className="flex min-h-11 items-center gap-3 font-bold"
          to="/operator"
          aria-label="فضای اپراتور، نمای کلی"
        >
          <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-lg">فضای اپراتور</span>
            <span className="text-muted-foreground block text-xs font-normal">
              ترب‌رنت
            </span>
          </span>
        </NavLink>
        <div className="mt-10 flex-1">
          <p className="text-muted-foreground mb-3 px-3 text-xs font-medium">
            بخش‌های کاری
          </p>
          <WorkspaceNavigation capabilities={capabilities} />
        </div>
        <Button asChild variant="ghost" className="min-h-11 justify-start">
          <NavLink to="/">
            <ExternalLink aria-hidden="true" /> بازگشت به سایت
          </NavLink>
        </Button>
      </aside>

      <header className="border-border bg-background/95 sticky top-0 z-30 flex min-h-18 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
        <NavLink
          className="flex min-h-11 items-center gap-2 font-bold"
          to="/operator"
        >
          <ShieldCheck className="text-primary size-5" aria-hidden="true" />
          فضای اپراتور
        </NavLink>
        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                size="icon"
                variant="secondary"
                aria-label="باز کردن راهبری اپراتور"
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(88vw,22rem)] pt-14">
              <SheetHeader className="text-start">
                <SheetTitle>فضای اپراتور</SheetTitle>
                <SheetDescription>
                  فقط مسئولیت‌های واگذارشده نمایش داده می‌شوند.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <WorkspaceNavigation capabilities={capabilities} mobile />
                <SheetClose asChild>
                  <Button
                    asChild
                    variant="ghost"
                    className="mt-6 w-full justify-start"
                  >
                    <NavLink to="/">
                      <ExternalLink aria-hidden="true" />
                      بازگشت به سایت
                    </NavLink>
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
          <ThemeSwitcher />
        </div>
      </header>

      <div className="lg:ps-72">
        <div
          className="border-border bg-background/80 hidden min-h-18 items-center gap-3 border-b px-10 text-sm lg:flex"
          aria-label="موقعیت فعلی"
        >
          <NavLink
            to="/operator"
            className="text-muted-foreground hover:text-foreground"
          >
            میز کار
          </NavLink>
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="font-medium">{currentSection}</span>
          <div className="ms-auto">
            <ThemeSwitcher />
          </div>
        </div>
        <Outlet />
      </div>
    </div>
  );
}

export function OperatorWorkspace() {
  const location = useLocation();
  const session = useQuery(sessionQuery);
  const currentUser = useQuery({
    ...currentUserQuery,
    enabled: session.data?.authenticated === true,
  });

  if (
    session.isPending ||
    (session.data?.authenticated && currentUser.isPending)
  ) {
    return (
      <WorkspaceState
        title="در حال بررسی حساب…"
        description="لطفاً کمی صبر کنید."
      />
    );
  }

  if (!session.data?.authenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  if (!currentUser.data?.email_verified) {
    return (
      <WorkspaceState
        title="تأیید ایمیل لازم است"
        description="برای ورود به فضای اپراتور، ابتدا ایمیل این حساب را تأیید کنید."
      />
    );
  }

  const capabilities = currentUser.data.operator_capabilities;
  if (capabilities.length === 0) {
    return (
      <WorkspaceState
        title="دسترسی به فضای اپراتور داده نشده است"
        description="این حساب هیچ مسئولیت عملیاتی فعالی ندارد."
      />
    );
  }

  return <OperatorShell capabilities={capabilities} />;
}

export function OperatorCapabilityRoute({
  capability,
  children,
}: {
  capability: OperatorCapability | OperatorCapability[];
  children: ReactNode;
}) {
  const currentUser = useQuery(currentUserQuery);
  const required = Array.isArray(capability) ? capability : [capability];
  const available = currentUser.data?.operator_capabilities;

  if (!available?.some((item) => required.includes(item))) {
    return (
      <WorkspaceState
        title="دسترسی به این بخش داده نشده است"
        description="مسئولیت لازم برای این بخش به حساب شما واگذار نشده است."
      />
    );
  }

  return children;
}
