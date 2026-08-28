import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { apiError, ApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { sessionQuery } from "@/features/session/queries";

type User = components["schemas"]["User"];
type AccessMode = "login" | "register";
type PendingIntent = () => void;

const accessContent = {
  login: {
    title: "ورود به ترب‌رنت",
    action: "ورود و ادامه",
    pending: "در حال ورود…",
    passwordAutocomplete: "current-password",
  },
  register: {
    title: "ساخت حساب اجاره‌جو",
    action: "ساخت حساب و ادامه",
    pending: "در حال ساخت حساب…",
    passwordAutocomplete: "new-password",
  },
} as const;

const RenterAccessContext = createContext<
  { requestRenterAccess: (pendingIntent?: PendingIntent) => void } | undefined
>(undefined);

function AccessForm({
  mode,
  onAuthenticated,
}: {
  mode: AccessMode;
  onAuthenticated: (user: User) => void;
}) {
  const queryClient = useQueryClient();
  const content = accessContent[mode];
  const mutation = useMutation({
    mutationFn: async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      const response =
        mode === "login"
          ? await api.POST("/api/v1/auth/login/", { body: { email, password } })
          : await api.POST("/api/v1/auth/renter-register/", {
              body: { email, password },
            });
      if (response.error || !response.data) throw apiError(response.error);
      return response.data;
    },
    onSuccess: async (user) => {
      queryClient.setQueryData(
        ["session"],
        (
          current: { authenticated: boolean; csrf_token: string } | undefined,
        ) => ({
          authenticated: true,
          csrf_token: current?.csrf_token ?? "",
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.fetchQuery(sessionQuery);
      void queryClient.invalidateQueries({ queryKey: ["current-user"] });
      await queryClient.invalidateQueries({
        queryKey: ["catalog", "properties"],
      });
      onAuthenticated(user);
    },
  });
  const fieldErrors =
    mutation.error instanceof ApiError ? mutation.error.fields : {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    mutation.mutate({
      email: typeof email === "string" ? email : "",
      password: typeof password === "string" ? password : "",
    });
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor={`renter-${mode}-email`}>ایمیل</Label>
        <Input
          id={`renter-${mode}-email`}
          name="email"
          type="email"
          autoComplete="email"
          aria-describedby={
            fieldErrors.email ? `renter-${mode}-email-error` : undefined
          }
          aria-invalid={fieldErrors.email ? true : undefined}
          required
        />
        {fieldErrors.email ? (
          <p
            id={`renter-${mode}-email-error`}
            className="text-destructive text-sm"
            role="alert"
          >
            {fieldErrors.email}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`renter-${mode}-password`}>گذرواژه</Label>
        <Input
          id={`renter-${mode}-password`}
          name="password"
          type="password"
          autoComplete={content.passwordAutocomplete}
          aria-describedby={
            fieldErrors.password ? `renter-${mode}-password-error` : undefined
          }
          aria-invalid={fieldErrors.password ? true : undefined}
          required
        />
        {fieldErrors.password ? (
          <p
            id={`renter-${mode}-password-error`}
            className="text-destructive text-sm"
            role="alert"
          >
            {fieldErrors.password}
          </p>
        ) : null}
      </div>
      {mutation.error && Object.keys(fieldErrors).length === 0 ? (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button disabled={mutation.isPending} type="submit">
        {content.action}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {mutation.isPending ? content.pending : ""}
      </span>
    </form>
  );
}

function RenterAccessDialog({
  open,
  onOpenChange,
  onAuthenticated,
  restoreFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: (user: User) => void;
  restoreFocus: () => void;
}) {
  const [mode, setMode] = useState<AccessMode>("login");
  const content = accessContent[mode];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setMode("login");
      }}
    >
      <DialogContent
        dir="rtl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <div className="grid gap-2 pe-10">
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription>
            برای نگهداری علاقه‌مندی‌ها وارد شوید یا یک حساب اجاره‌جو بسازید.
          </DialogDescription>
        </div>
        <div
          className="bg-muted grid grid-cols-2 rounded-lg p-1"
          role="group"
          aria-label="روش دسترسی"
        >
          <Button
            aria-pressed={mode === "login"}
            onClick={() => setMode("login")}
            type="button"
            variant={mode === "login" ? "secondary" : "ghost"}
          >
            ورود
          </Button>
          <Button
            aria-pressed={mode === "register"}
            onClick={() => setMode("register")}
            type="button"
            variant={mode === "register" ? "secondary" : "ghost"}
          >
            ساخت حساب
          </Button>
        </div>
        <AccessForm key={mode} mode={mode} onAuthenticated={onAuthenticated} />
      </DialogContent>
    </Dialog>
  );
}

export function RenterAccessProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pendingIntent = useRef<PendingIntent | undefined>(undefined);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  return (
    <RenterAccessContext.Provider
      value={{
        requestRenterAccess: (intent) => {
          pendingIntent.current = intent;
          restoreFocusTo.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          setOpen(true);
        },
      }}
    >
      {children}
      <RenterAccessDialog
        open={open}
        onOpenChange={setOpen}
        restoreFocus={() => restoreFocusTo.current?.focus()}
        onAuthenticated={() => {
          const intent = pendingIntent.current;
          pendingIntent.current = undefined;
          setOpen(false);
          intent?.();
        }}
      />
    </RenterAccessContext.Provider>
  );
}

export function useRenterAccess() {
  const access = useContext(RenterAccessContext);
  if (!access)
    throw new Error("useRenterAccess must be used within RenterAccessProvider");
  return access;
}
