import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { currentUserQuery, sessionQuery } from "@/features/session/queries";

export function ProtectedMessageCenterRoute({
  children,
}: {
  children: ReactNode;
}) {
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
      <main
        id="main-content"
        className="mx-auto w-full max-w-432 px-4 py-12"
        tabIndex={-1}
      >
        <p role="status">در حال بررسی حساب…</p>
      </main>
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

  if (!currentUser.data?.email_verified && !currentUser.data?.phone_verified) {
    return (
      <main
        id="main-content"
        className="mx-auto w-full max-w-432 px-4 py-12"
        tabIndex={-1}
      >
        <h1 className="text-2xl font-semibold">تأیید حساب لازم است</h1>
        <p className="text-muted-foreground mt-3">
          برای مشاهده مرکز پیام، ایمیل یا شماره تلفن حساب خود را تأیید کنید.
        </p>
      </main>
    );
  }

  return children;
}
