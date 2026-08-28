import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { currentUserQuery, sessionQuery } from "@/features/session/queries";

export function ProtectedSubmitterRoute({ children }: { children: ReactNode }) {
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
        <p>در حال بررسی حساب…</p>
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

  if (!currentUser.data?.email_verified) {
    return (
      <main
        id="main-content"
        className="mx-auto w-full max-w-432 px-4 py-12"
        tabIndex={-1}
      >
        <Alert>
          <AlertTitle>تأیید ایمیل لازم است</AlertTitle>
          <AlertDescription>
            برای ثبت آگهی، ابتدا ایمیل خود را تأیید کنید.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!currentUser.data.is_submitter) {
    return (
      <main
        id="main-content"
        className="mx-auto w-full max-w-432 px-4 py-12"
        tabIndex={-1}
      >
        <Alert>
          <AlertTitle>حساب ارسال‌کننده لازم است</AlertTitle>
          <AlertDescription>
            برای ثبت آگهی باید ابتدا مسیر ارسال‌کننده را آغاز کنید.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return children;
}
