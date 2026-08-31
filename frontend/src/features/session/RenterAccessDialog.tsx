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
  const [pendingPhone, setPendingPhone] = useState<{
    identifier: string;
    password: string;
    demoOtp?: string;
  }>();
  const [registrationResult, setRegistrationResult] = useState<string>();

  async function finishAuthentication(user: User) {
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
  }

  const mutation = useMutation({
    mutationFn: async ({
      identifier,
      password,
    }: {
      identifier: string;
      password: string;
    }) => {
      const response =
        mode === "login"
          ? await api.POST("/api/v1/auth/login/", {
              body: { identifier, password },
            })
          : await api.POST("/api/v1/auth/renter-register/", {
              body: { identifier, password },
            });
      if (response.error || !response.data) throw apiError(response.error);
      return response.data;
    },
    onSuccess: async (data, variables) => {
      if ("id" in data) {
        await finishAuthentication(data);
        return;
      }
      setRegistrationResult(data.detail);
      if (data.verification_method === "phone") {
        setPendingPhone({
          ...variables,
          demoOtp: data.demo_otp,
        });
      }
    },
  });
  const verification = useMutation({
    mutationFn: async (otp: string) => {
      if (!pendingPhone) throw new Error("شماره تلفن در دسترس نیست.");
      const verified = await api.POST("/api/v1/auth/verify-phone/", {
        body: { identifier: pendingPhone.identifier, otp },
      });
      if (verified.error || !verified.data) throw apiError(verified.error);
      const login = await api.POST("/api/v1/auth/login/", {
        body: {
          identifier: pendingPhone.identifier,
          password: pendingPhone.password,
        },
      });
      if (login.error || !login.data) throw apiError(login.error);
      return login.data;
    },
    onSuccess: finishAuthentication,
  });
  const fieldErrors =
    mutation.error instanceof ApiError ? mutation.error.fields : {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identifier = form.get("identifier");
    const password = form.get("password");
    mutation.mutate({
      identifier: typeof identifier === "string" ? identifier : "",
      password: typeof password === "string" ? password : "",
    });
  }

  function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = new FormData(event.currentTarget).get("otp");
    verification.mutate(typeof otp === "string" ? otp : "");
  }

  if (pendingPhone) {
    return (
      <form key="renter-phone-otp" className="grid gap-5" onSubmit={submitOtp}>
        <div className="grid gap-2">
          <Label htmlFor="renter-phone-otp">کد تأیید</Label>
          <Input
            id="renter-phone-otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
          {pendingPhone.demoOtp ? (
            <p className="text-muted-foreground text-sm">
              کد نمایشی: {pendingPhone.demoOtp}
            </p>
          ) : null}
        </div>
        {verification.error ? (
          <Alert variant="destructive">
            <AlertDescription>{verification.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button disabled={verification.isPending} type="submit">
          {verification.isPending ? "در حال تأیید…" : "تأیید و ادامه"}
        </Button>
      </form>
    );
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor={`renter-${mode}-identifier`}>ایمیل یا شماره تلفن</Label>
        <Input
          id={`renter-${mode}-identifier`}
          name="identifier"
          type="text"
          autoComplete="username"
          aria-describedby={
            fieldErrors.identifier
              ? `renter-${mode}-identifier-error`
              : undefined
          }
          aria-invalid={fieldErrors.identifier ? true : undefined}
          required
        />
        {fieldErrors.identifier ? (
          <p
            id={`renter-${mode}-identifier-error`}
            className="text-destructive text-sm"
            role="alert"
          >
            {fieldErrors.identifier}
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
      {registrationResult ? (
        <Alert>
          <AlertDescription>{registrationResult}</AlertDescription>
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
