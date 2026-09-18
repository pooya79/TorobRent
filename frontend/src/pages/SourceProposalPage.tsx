import { SourceConversationButton } from "@/features/source-proposals/SourceConversationButton";
import { CurrentWebsiteStatus } from "@/features/source-proposals/CurrentWebsiteStatus";
import { SourceAssignmentSummary } from "@/features/source-proposals/SourceAssignmentSummary";
import { AccountWorkspace } from "@/features/account/AccountWorkspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSourceProposal,
  getSourceProposal,
  listSourceProposals,
  submitSourceProposal,
  type SourceProposal,
  type SourceProposalDetails,
} from "@/features/source-proposals/queries";
import { errorMessage } from "@/lib/api/errors";

const emptyDetails: Required<SourceProposalDetails> = {
  website_name: "",
  website_url: "",
  relationship: "website_owner",
  inventory_range: "unknown",
  sitemap_url: "",
  operator_note: "",
  authority_declared: false,
};

function detailsFromProposal(
  proposal: SourceProposal,
): Required<SourceProposalDetails> {
  return {
    website_name: proposal.website_name ?? "",
    website_url: proposal.website_url ?? "",
    relationship:
      proposal.relationship === "website_manager" ||
      proposal.relationship === "authorized_representative"
        ? proposal.relationship
        : "website_owner",
    inventory_range:
      proposal.inventory_range === "1_10" ||
      proposal.inventory_range === "11_50" ||
      proposal.inventory_range === "51_200" ||
      proposal.inventory_range === "more_than_200"
        ? proposal.inventory_range
        : "unknown",
    sitemap_url: proposal.sitemap_url ?? "",
    operator_note: proposal.operator_note ?? "",
    authority_declared: proposal.authority_declared ?? false,
  };
}

export function SourceProposalPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [proposalId] = useState(() => searchParams.get("proposal"));
  const [startNew] = useState(
    () => !proposalId && searchParams.get("new") === "1",
  );
  const [detailsOverride, setDetails] =
    useState<Required<SourceProposalDetails>>();
  const resume = useQuery({
    queryKey: ["source-proposal-resume", proposalId, startNew],
    queryFn: async () => {
      if (proposalId) return getSourceProposal(proposalId);
      const proposals = await listSourceProposals();
      return (
        proposals.find(
          (candidate) => candidate.is_current && !candidate.discarded_at,
        ) ?? null
      );
    },
    refetchInterval: (query) =>
      query.state.data?.assignment?.state === "active" ||
      query.state.data?.state === "pending"
        ? 5000
        : false,
    retry: false,
  });
  const proposal = resume.data;
  const details =
    detailsOverride ??
    (proposal ? detailsFromProposal(proposal) : emptyDetails);
  const submit = useMutation({
    mutationFn: () =>
      proposal
        ? submitSourceProposal(proposal.id, details)
        : createSourceProposal(details),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["source-proposal-resume", proposalId, startNew],
        data,
      );
      setSearchParams({ proposal: data.id }, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ["source-proposals"] });
    },
  });

  if (resume.isError) {
    return (
      <PageFrame>
        <ErrorAlert error={resume.error} />
        <Link className="underline" to="/dashboard">
          مشاهده وب‌سایت‌ها و رفع تعارض در داشبورد
        </Link>
      </PageFrame>
    );
  }
  if (resume.isPending) {
    return (
      <PageFrame>
        <p role="status">در حال بازیابی پیشنهاد وب‌سایت…</p>
      </PageFrame>
    );
  }
  if (
    proposal &&
    (proposal.current_website_conflict ||
      proposal.assignment?.state === "active" ||
      proposal.discarded_at ||
      ["approved", "rejected", "revoked"].includes(proposal.state ?? ""))
  ) {
    return (
      <PageFrame>
        <Card className="mx-auto max-w-2xl shadow-none">
          <CardContent className="grid gap-5 pt-6">
            <h1 className="text-2xl font-semibold">
              {proposal.website_name || "وب‌سایت شما"}
            </h1>
            <CurrentWebsiteStatus proposal={proposal} />
            {(proposal.state !== "draft" || (proposal.revision ?? 1) > 1) && (
              <SourceConversationButton proposalId={proposal.id} />
            )}
            <p dir="ltr" className="break-all">
              {proposal.website_url}
            </p>
            {proposal.assignment && (
              <SourceAssignmentSummary
                assignment={proposal.assignment}
                proposalId={proposal.id}
              />
            )}
            <Button asChild>
              <Link to="/dashboard">مشاهده وضعیت و سوابق در داشبورد</Link>
            </Button>
          </CardContent>
        </Card>
      </PageFrame>
    );
  }
  if (proposal?.state === "pending") {
    return (
      <PageFrame>
        <Card className="mx-auto max-w-2xl shadow-none">
          <CardContent className="space-y-5 pt-6 text-center">
            <CheckCircle2
              className="text-info mx-auto size-12"
              aria-hidden="true"
            />
            <h1 className="text-2xl font-semibold">در انتظار بررسی اپراتور</h1>
            <CurrentWebsiteStatus proposal={proposal} />
            <SourceConversationButton proposalId={proposal.id} />
            <p className="text-muted-foreground leading-7">
              پیشنهاد وب‌سایت {proposal.website_name} ثبت شده است.{" "}
              {proposal.discovery_message
                ? "پیام تیم بررسی را بخوانید."
                : "نتیجه بررسی همین‌جا نمایش داده می‌شود؛ فعلاً نیازی به اقدام شما نیست."}
            </p>
            {proposal.discovery_message && (
              <p className="rounded-lg border p-3 text-start">
                {proposal.discovery_message}
              </p>
            )}
            <Button asChild>
              <Link to="/dashboard">مشاهده وضعیت در داشبورد</Link>
            </Button>
          </CardContent>
        </Card>
      </PageFrame>
    );
  }

  const setField = <K extends keyof typeof details>(
    key: K,
    value: (typeof details)[K],
  ) => setDetails((current) => ({ ...(current ?? details), [key]: value }));
  const handleDetails = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate();
  };

  return (
    <PageFrame>
      {proposal && <CurrentWebsiteStatus proposal={proposal} />}
      {proposal &&
        (proposal.state !== "draft" || (proposal.revision ?? 1) > 1) && (
          <SourceConversationButton proposalId={proposal.id} />
        )}
      <header className="mb-8 max-w-3xl">
        <p className="text-info mb-2 text-sm font-semibold">
          معرفی منبع بیرونی
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          معرفی وب‌سایت اجاره
        </h1>
        <p className="text-muted-foreground mt-3 leading-8">
          اطلاعات وب‌سایت و رابطه خود را کامل کنید و برای بررسی بفرستید. دریافت
          صفحات تنها پس از تأیید نشانی توسط اپراتور آغاز می‌شود.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>اطلاعات وب‌سایت و اختیار معرفی</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleDetails}>
              <Field label="نام وب‌سایت" htmlFor="website-name">
                <Input
                  id="website-name"
                  required
                  value={details.website_name}
                  onChange={(event) =>
                    setField("website_name", event.target.value)
                  }
                />
              </Field>
              <Field label="نشانی صفحه اصلی یا کاتالوگ" htmlFor="website-url">
                <Input
                  id="website-url"
                  type="url"
                  required
                  dir="ltr"
                  value={details.website_url}
                  onChange={(event) =>
                    setField("website_url", event.target.value)
                  }
                />
              </Field>
              <Field label="رابطه شما با وب‌سایت" htmlFor="relationship">
                <select
                  id="relationship"
                  className="border-input bg-background h-11 w-full rounded-md border px-3"
                  value={details.relationship}
                  onChange={(event) => {
                    const value = event.target
                      .value as typeof details.relationship;
                    setField("relationship", value);
                  }}
                >
                  <option value="website_owner">مالک وب‌سایت</option>
                  <option value="website_manager">مدیر وب‌سایت</option>
                  <option value="authorized_representative">
                    نماینده مجاز
                  </option>
                </select>
              </Field>
              <Field label="تعداد تقریبی ملک‌ها" htmlFor="inventory-range">
                <select
                  id="inventory-range"
                  className="border-input bg-background h-11 w-full rounded-md border px-3"
                  value={details.inventory_range}
                  onChange={(event) => {
                    const value = event.target
                      .value as typeof details.inventory_range;
                    setField("inventory_range", value);
                  }}
                >
                  <option value="1_10">۱ تا ۱۰</option>
                  <option value="11_50">۱۱ تا ۵۰</option>
                  <option value="51_200">۵۱ تا ۲۰۰</option>
                  <option value="more_than_200">بیش از ۲۰۰</option>
                  <option value="unknown">نمی‌دانم</option>
                </select>
              </Field>
              <Field
                label="نشانی نقشه سایت یا خوراک (اختیاری)"
                htmlFor="sitemap-url"
              >
                <Input
                  id="sitemap-url"
                  type="url"
                  dir="ltr"
                  value={details.sitemap_url}
                  onChange={(event) =>
                    setField("sitemap_url", event.target.value)
                  }
                />
              </Field>
              <Field
                label="یادداشت برای اپراتور (اختیاری)"
                htmlFor="operator-note"
              >
                <textarea
                  id="operator-note"
                  className="border-input min-h-28 w-full rounded-md border bg-transparent p-3"
                  value={details.operator_note}
                  onChange={(event) =>
                    setField("operator_note", event.target.value)
                  }
                />
              </Field>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="authority"
                  checked={details.authority_declared}
                  onCheckedChange={(checked) => {
                    const value = checked === true;
                    setField("authority_declared", value);
                  }}
                />
                <Label htmlFor="authority" className="leading-6">
                  اعلام می‌کنم اختیار معرفی این وب‌سایت را برای بررسی ترب‌رنت
                  دارم.
                </Label>
              </div>
              {submit.isError && <ErrorAlert error={submit.error} />}
              <Button
                type="submit"
                disabled={submit.isPending || !details.authority_declared}
              >
                {submit.isPending
                  ? "در حال ارسال…"
                  : proposal
                    ? "ارسال مجدد برای بررسی"
                    : "ارسال برای بررسی"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className="h-fit shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" /> پس از ارسال چه می‌شود؟
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-7">
            <p>
              پیشنهاد شما مستقیماً برای بررسی اپراتور ثبت می‌شود. نتیجه و
              درخواست اصلاح را در داشبورد می‌بینید.
            </p>
            <p>
              تا پیش از تأیید نشانی توسط اپراتور هیچ درخواستی به وب‌سایت ارسال
              نمی‌شود.
            </p>
            <p className="text-muted-foreground">
              تعداد تقریبی ملک‌ها فقط برای برنامه‌ریزی است و تعداد قطعی یا
              تضمین‌شده کشف نیست.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function ErrorAlert({ error }: { error: unknown }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {errorMessage(
          error,
          "ارسال پیشنهاد وب‌سایت انجام نشد. اطلاعات واردشده حفظ شده است.",
        )}
      </AlertDescription>
    </Alert>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return <AccountWorkspace>{children}</AccountWorkspace>;
}

export default SourceProposalPage;
