import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";

export function RouteFocus() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      document.querySelector<HTMLElement>("main")?.focus();
      previousPath.current = pathname;
    }
  }, [pathname]);

  return <Outlet />;
}
