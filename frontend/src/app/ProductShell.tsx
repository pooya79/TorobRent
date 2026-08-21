import { useQuery } from "@tanstack/react-query";
import { Building2, Check } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";

const navigation = [
  { label: "خانه", to: "/" },
  { label: "راهنما", to: "/guide" },
  { label: "تماس", to: "/contact" },
  { label: "ورود", to: "/login" },
] as const;

export function ProductShell({ children }: { children: ReactNode }) {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/system/ready/");
      if (error || !data) return { status: "unavailable" as const };
      return data;
    },
  });

  return (
    <div className="site-shell">
      <header className="site-header">
        <NavLink className="wordmark" to="/" aria-label="ترب‌رنت، خانه">
          <span className="wordmark-mark" aria-hidden="true">
            <Building2 />
          </span>
          <span>ترب‌رنت</span>
        </NavLink>

        <nav className="primary-nav" aria-label="راهبری اصلی">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              {item.label}
            </NavLink>
          ))}
          <Button asChild size="sm">
            <NavLink to="/add-submission">ثبت آگهی</NavLink>
          </Button>
        </nav>
      </header>

      {children}

      <footer className="site-footer">
        <p>ترب‌رنت؛ راه ساده‌تر پیدا کردن خانه اجاره‌ای</p>
        <span
          className={`surface surface--feedback health-status status-indicator health-status--${health.data?.status === "ok" ? "ready" : "pending"}`}
        >
          {health.data?.status === "ok" ? (
            <>
              <Check aria-hidden="true" /> سامانه در دسترس است
            </>
          ) : health.isPending ? (
            "در حال بررسی سامانه…"
          ) : (
            "سامانه موقتاً در دسترس نیست"
          )}
        </span>
      </footer>
    </div>
  );
}
