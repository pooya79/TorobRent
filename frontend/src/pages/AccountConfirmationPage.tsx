import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sessionQuery } from "@/features/session/queries";
import {
  safeInternalReturnTo,
  withReturnTo,
} from "@/features/session/return-destination";
import { api } from "@/lib/api/client";
import { apiError, errorMessage } from "@/lib/api/errors";

export function AccountConfirmationPage({
  mode,
}: {
  mode: "verify" | "reset";
}) {
  const session = useQuery(sessionQuery);
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const returnTo = safeInternalReturnTo(searchParams.get("returnTo"));
  const startedVerification = useRef(false);
  const mutation = useMutation({
    mutationFn: async (newPassword?: string) => {
      if (!token) throw new Error("missing-token");
      if (mode === "verify") {
        const { data, error } = await api.POST("/api/v1/auth/verify-email/", {
          body: { token },
        });
        if (error || !data) throw apiError(error);
        return data;
      }
      const { data, error } = await api.POST(
        "/api/v1/auth/password-reset/confirm/",
        {
          body: { token, new_password: newPassword ?? "" },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
  });

  useEffect(() => {
    if (
      mode === "verify" &&
      session.isSuccess &&
      !startedVerification.current
    ) {
      startedVerification.current = true;
      mutation.mutate(undefined);
    }
  }, [mode, mutation, session.isSuccess]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = form.get("new_password");
    mutation.mutate(typeof newPassword === "string" ? newPassword : "");
  }

  const title = mode === "verify" ? "تأیید ایمیل" : "انتخاب گذرواژه جدید";
  const pending = session.isPending || mutation.isPending;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-432 items-center px-4 py-12 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <Card className="mx-auto w-full max-w-lg shadow-none">
        <CardHeader>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        </CardHeader>
        <CardContent className="grid gap-5">
          {mode === "reset" && !mutation.data ? (
            <form className="grid gap-5" onSubmit={submit}>
              <div className="grid gap-2">
                <Label htmlFor="new-password">گذرواژه جدید</Label>
                <Input
                  id="new-password"
                  name="new_password"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button type="submit" disabled={pending || !token}>
                {mutation.isPending ? "در حال ارسال…" : "تغییر گذرواژه"}
              </Button>
            </form>
          ) : null}
          {mode === "verify" && pending ? <p>در حال تأیید ایمیل…</p> : null}
          {mutation.data ? (
            <Alert>
              <AlertDescription>{mutation.data.detail}</AlertDescription>
            </Alert>
          ) : null}
          {mutation.error || !token ? (
            <Alert variant="destructive">
              <AlertDescription>
                {!token
                  ? "پیوند ناقص است."
                  : errorMessage(
                      mutation.error,
                      "پیوند نامعتبر است یا اعتبار آن تمام شده است.",
                    )}
              </AlertDescription>
            </Alert>
          ) : null}
          {mutation.data ? (
            <Button asChild>
              <Link to={withReturnTo("/login", returnTo)}>ورود</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
