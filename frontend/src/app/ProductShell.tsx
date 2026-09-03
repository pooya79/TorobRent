import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  BriefcaseBusiness,
  Camera,
  Check,
  Heart,
  LogOut,
  Menu,
  MessageCircle,
  Send,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import { currentUserQuery, sessionQuery } from "@/features/session/queries";
import {
  mapPropertySearchPages,
  type PropertySearchData,
  type PropertySearchPage,
} from "@/features/catalog/property-search-cache";
import { unreadMessageCountQuery } from "@/features/messages/queries";
import { cn } from "@/lib/utils";
import type { components } from "@/lib/api/schema";

type CurrentUser = components["schemas"]["CurrentUser"];

function withoutFavoriteState(page: PropertySearchPage) {
  return {
    ...page,
    results: page.results.map((property) => ({
      ...property,
      is_favorite: false,
    })),
  };
}

function withoutFavorites(data: PropertySearchData | undefined) {
  return mapPropertySearchPages(data, withoutFavoriteState);
}

const navigation = [
  { label: "خانه", to: "/" },
  { label: "جست‌وجو", to: "/search" },
  { label: "راهنما", to: "/guide" },
  { label: "تماس", to: "/contact" },
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
      className="flex min-h-11 items-center gap-3 font-bold"
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

const footerLinks = [
  { label: "درباره ترب‌رنت", to: "/about" },
  { label: "راهنما", to: "/guide" },
  { label: "تماس با پشتیبانی", to: "/contact" },
  { label: "حریم خصوصی", to: "/privacy" },
  { label: "شرایط استفاده", to: "/terms" },
] as const;

const socialPlaceholders = [
  { label: "Instagram", icon: Camera },
  { label: "Telegram", icon: Send },
  { label: "LinkedIn", icon: BriefcaseBusiness },
  { label: "X", icon: null },
] as const;

function PrimaryNavigation({
  authenticated,
  currentUser,
  logout,
  mobile = false,
  onNavigate,
  unreadCount,
}: {
  authenticated: boolean;
  currentUser?: CurrentUser;
  logout: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
  unreadCount: number;
}) {
  const links = (
    <>
      {navigation.map((item) => {
        const link = (
          <NavLink
            className={navigationClass}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
          >
            {item.label}
          </NavLink>
        );
        return <span key={item.to}>{link}</span>;
      })}
      {authenticated ? (
        <NavLink
          className={navigationClass}
          onClick={onNavigate}
          to="/favorites"
        >
          <Heart className="size-5" aria-hidden="true" />
          <span className={cn(!mobile && "sr-only")}>علاقه‌مندی‌ها</span>
        </NavLink>
      ) : null}
      {authenticated ? (
        currentUser ? (
          <AuthenticatedControls
            currentUser={currentUser}
            logout={logout}
            mobile={mobile}
            onNavigate={onNavigate}
            unreadCount={unreadCount}
          />
        ) : (
          <span className="text-muted-foreground px-3 text-sm" role="status">
            در حال بارگذاری حساب…
          </span>
        )
      ) : (
        <>
          <NavLink className={navigationClass} onClick={onNavigate} to="/login">
            ورود
          </NavLink>
          <NavLink
            className={navigationClass}
            onClick={onNavigate}
            to="/register"
          >
            ثبت‌نام
          </NavLink>
        </>
      )}
    </>
  );

  return (
    <nav
      className={cn(mobile ? "grid gap-1" : "flex items-center gap-1")}
      aria-label="راهبری اصلی"
    >
      {links}
      <Button asChild className={cn("min-h-11 rounded-full", mobile && "mt-4")}>
        <NavLink onClick={onNavigate} to="/advertise">
          می‌خواهم آگهی ثبت کنم
        </NavLink>
      </Button>
    </nav>
  );
}

function ComingSoonControl({
  label,
  icon: Icon,
  compact = false,
}: {
  label: string;
  icon: typeof MessageCircle;
  compact?: boolean;
}) {
  const accessibleLabel = `${label} — به‌زودی`;
  return (
    <Button
      aria-disabled="true"
      aria-label={accessibleLabel}
      className={cn("min-h-11", compact ? "px-3" : "justify-start px-3")}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden="true" />
      <span className={cn(compact && "sr-only")}>{label}</span>
      <span
        className={cn("text-muted-foreground text-xs", compact && "sr-only")}
      >
        به‌زودی
      </span>
    </Button>
  );
}

function messageLinkLabel(unreadCount: number) {
  return unreadCount > 0
    ? `پیام‌ها، ${unreadCount.toLocaleString("fa-IR")} خوانده‌نشده`
    : "پیام‌ها";
}

function MessageCenterLink({
  compact = false,
  onNavigate,
  unreadCount,
}: {
  compact?: boolean;
  onNavigate?: () => void;
  unreadCount: number;
}) {
  return (
    <NavLink
      aria-label={messageLinkLabel(unreadCount)}
      className={navigationClass}
      onClick={onNavigate}
      to="/messages"
    >
      <span className="relative">
        <MessageCircle className="size-5" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="bg-primary text-primary-foreground absolute -end-3 -top-3 min-w-5 rounded-full px-1 text-center text-[0.65rem] leading-5">
            {unreadCount.toLocaleString("fa-IR")}
          </span>
        ) : null}
      </span>
      <span className={cn(compact && "sr-only")}>پیام‌ها</span>
    </NavLink>
  );
}

function accountName(currentUser: CurrentUser) {
  return [currentUser.first_name, currentUser.last_name]
    .filter(Boolean)
    .join(" ");
}

function AccountIdentity({ currentUser }: { currentUser: CurrentUser }) {
  const name = accountName(currentUser);
  return (
    <>
      {name ? <p className="font-semibold">{name}</p> : null}
      <p className="text-muted-foreground text-sm font-normal" dir="ltr">
        {currentUser.email ?? currentUser.phone}
      </p>
    </>
  );
}

function MobileAccountPanel({
  currentUser,
  logout,
  onNavigate,
  unreadCount,
}: {
  currentUser: CurrentUser;
  logout: () => void;
  onNavigate?: () => void;
  unreadCount: number;
}) {
  const isOperator = currentUser.operator_capabilities.length > 0;

  return (
    <div
      aria-label="فهرست حساب کاربری"
      className="border-border bg-popover text-popover-foreground grid min-w-72 gap-1 rounded-xl border p-2 shadow-lg"
      role="region"
    >
      <div className="border-border mb-1 border-b px-3 py-2">
        <AccountIdentity currentUser={currentUser} />
      </div>
      <ComingSoonControl label="نمایه" icon={UserRound} />
      <MessageCenterLink onNavigate={onNavigate} unreadCount={unreadCount} />
      <Button asChild className="justify-start px-3" variant="ghost">
        <NavLink onClick={onNavigate} to="/guide">
          راهنما
        </NavLink>
      </Button>
      <Button asChild className="justify-start px-3" variant="ghost">
        <NavLink onClick={onNavigate} to="/contact">
          تماس با پشتیبانی
        </NavLink>
      </Button>
      {isOperator ? (
        <Button asChild className="justify-start px-3" variant="ghost">
          <NavLink onClick={onNavigate} to="/operator">
            فضای کاری اپراتور
          </NavLink>
        </Button>
      ) : null}
      <Button
        className="justify-start px-3"
        onClick={logout}
        type="button"
        variant="ghost"
      >
        <LogOut aria-hidden="true" /> خروج
      </Button>
    </div>
  );
}

function AuthenticatedControls({
  currentUser,
  logout,
  mobile,
  onNavigate,
  unreadCount,
}: {
  currentUser: CurrentUser;
  logout: () => void;
  mobile: boolean;
  onNavigate?: () => void;
  unreadCount: number;
}) {
  if (mobile) {
    return (
      <>
        <MessageCenterLink onNavigate={onNavigate} unreadCount={unreadCount} />
        <div className="border-border mt-3 border-t pt-3">
          <p className="px-3 py-2 text-sm font-semibold">حساب کاربری</p>
          <MobileAccountPanel
            currentUser={currentUser}
            logout={logout}
            onNavigate={onNavigate}
            unreadCount={unreadCount}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <MessageCenterLink compact unreadCount={unreadCount} />
      <AccountMenu
        currentUser={currentUser}
        logout={logout}
        unreadCount={unreadCount}
      />
    </>
  );
}

function AccountMenu({
  currentUser,
  logout,
  unreadCount,
}: {
  currentUser: CurrentUser;
  logout: () => void;
  unreadCount: number;
}) {
  const isOperator = currentUser.operator_capabilities.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="حساب کاربری"
          className="px-3"
          type="button"
          variant="ghost"
        >
          <UserRound aria-hidden="true" />
          <span className="sr-only">حساب</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="فهرست حساب کاربری"
        className="w-72"
      >
        <DropdownMenuLabel>
          <AccountIdentity currentUser={currentUser} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ComingSoonMenuItem label="نمایه" icon={UserRound} />
        <DropdownMenuItem asChild>
          <NavLink aria-label={messageLinkLabel(unreadCount)} to="/messages">
            <MessageCircle aria-hidden="true" />
            <span>پیام‌ها</span>
            {unreadCount > 0 ? (
              <span className="bg-primary text-primary-foreground ms-auto rounded-full px-2 py-0.5 text-xs">
                {unreadCount.toLocaleString("fa-IR")}
              </span>
            ) : null}
          </NavLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <NavLink to="/guide">راهنما</NavLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <NavLink to="/contact">تماس با پشتیبانی</NavLink>
        </DropdownMenuItem>
        {isOperator ? (
          <DropdownMenuItem asChild>
            <NavLink to="/operator">فضای کاری اپراتور</NavLink>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={logout}>
          <LogOut aria-hidden="true" /> خروج
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComingSoonMenuItem({
  label,
  icon: Icon,
}: {
  label: string;
  icon: typeof MessageCircle;
}) {
  const accessibleLabel = `${label} — به‌زودی`;
  return (
    <DropdownMenuItem
      aria-disabled="true"
      aria-label={accessibleLabel}
      onSelect={(event) => event.preventDefault()}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <span className="text-muted-foreground text-xs">به‌زودی</span>
    </DropdownMenuItem>
  );
}

export function ProductShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const isSearchPage = pathname === "/search";
  const session = useQuery(sessionQuery);
  const authenticated = session.data?.authenticated === true;
  const currentUser = useQuery({
    ...currentUserQuery,
    enabled: authenticated,
  });
  const unreadMessages = useQuery({
    ...unreadMessageCountQuery,
    enabled:
      authenticated &&
      Boolean(
        currentUser.data?.email_verified || currentUser.data?.phone_verified,
      ),
  });
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const logout = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/auth/logout/");
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["current-user"] });
      queryClient.setQueriesData<PropertySearchData>(
        { queryKey: ["catalog", "properties"] },
        withoutFavorites,
      );
      queryClient.setQueryData(["session"], (current: typeof session.data) =>
        current ? { ...current, authenticated: false } : current,
      );
      void queryClient.invalidateQueries({
        queryKey: ["catalog", "properties"],
      });
    },
  });
  const health = useQuery({
    queryKey: ["health"],
    enabled: !isSearchPage,
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
    <div
      className={cn(
        "overflow-x-clip",
        isSearchPage ? "flex h-dvh flex-col overflow-y-hidden" : "min-h-screen",
      )}
    >
      <header
        aria-label="راهبری عمومی"
        className="border-border bg-background/95 sticky top-0 z-30 shrink-0 border-b backdrop-blur"
      >
        <div className="mx-auto flex min-h-18 w-full max-w-432 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          <Brand />
          <div className="flex items-center gap-2">
            <div className="hidden xl:block">
              <PrimaryNavigation
                authenticated={authenticated}
                currentUser={currentUser.data}
                logout={() => logout.mutate()}
                unreadCount={unreadMessages.data?.count ?? 0}
              />
            </div>
            <ThemeSwitcher />
            <div className="xl:hidden">
              <Sheet
                onOpenChange={setMobileNavigationOpen}
                open={mobileNavigationOpen}
              >
                <SheetTrigger asChild>
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label="باز کردن فهرست راهبری"
                  >
                    <Menu aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[min(88vw,22rem)] pt-14"
                >
                  <SheetHeader className="text-start">
                    <SheetTitle>راهبری ترب‌رنت</SheetTitle>
                    <SheetDescription>به بخش موردنظر بروید.</SheetDescription>
                  </SheetHeader>
                  <div className="mt-6">
                    <PrimaryNavigation
                      authenticated={authenticated}
                      currentUser={currentUser.data}
                      logout={() => {
                        setMobileNavigationOpen(false);
                        logout.mutate();
                      }}
                      mobile
                      unreadCount={unreadMessages.data?.count ?? 0}
                      onNavigate={() => setMobileNavigationOpen(false)}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      <div className={isSearchPage ? "min-h-0 flex-1 overflow-hidden" : ""}>
        {children}
        {!isSearchPage && (
          <footer className="border-border mx-auto mt-16 grid w-full max-w-432 gap-8 border-t px-4 py-10 text-sm sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:px-10">
            <div>
              <p className="font-semibold">ترب‌رنت</p>
              <p className="text-muted-foreground mt-2 max-w-md leading-7">
                جست‌وجو و مقایسه شفاف‌تر ملک‌های مسکونی و تجاری برای اجاره
              </p>
            </div>
            <div className="grid gap-7 sm:grid-cols-2">
              <nav aria-label="اطلاعات ترب‌رنت">
                <p className="font-semibold">اطلاعات</p>
                <div className="text-muted-foreground mt-2 grid grid-cols-2 gap-x-5">
                  {footerLinks.map((link) => (
                    <NavLink
                      key={link.to}
                      className="hover:text-foreground inline-flex min-h-11 items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                      to={link.to}
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>
              </nav>
              <div>
                <p className="font-semibold">دنبال کردن ترب‌رنت</p>
                <div
                  aria-label="شبکه‌های اجتماعی"
                  className="mt-3 flex flex-wrap gap-2"
                  role="group"
                >
                  {socialPlaceholders.map(({ label, icon: Icon }) => (
                    <Button
                      key={label}
                      aria-disabled="true"
                      aria-label={label}
                      className="size-11"
                      title={label}
                      type="button"
                      variant="outline"
                    >
                      {Icon ? (
                        <Icon aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true" className="font-semibold">
                          X
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div
              aria-label="وضعیت آمادگی سامانه"
              className="text-muted-foreground flex items-center gap-2 text-xs lg:col-span-2"
              role="status"
              aria-live="polite"
            >
              {health.data?.status === "ok" ? (
                <>
                  <Check className="size-3" aria-hidden="true" /> سامانه در
                  دسترس است
                </>
              ) : health.isPending ? (
                "در حال بررسی سامانه…"
              ) : (
                "سامانه موقتاً در دسترس نیست"
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
