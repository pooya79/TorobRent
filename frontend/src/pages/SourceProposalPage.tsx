import { discoveryStageLabels } from "@/features/source-proposals/discovery-labels";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Globe2, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  autosaveSourceProposalDraft,
  generateSourceProposalPreview,
  getSourceProposal,
  resumeOrCreateSourceProposal,
  saveSourceProposalDetails,
  submitSourceProposal,
  type SourceProposal,
  type SourceProposalDetails,
  type SourceProposalDraft,
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
  const [proposalOverride, setProposal] = useState<SourceProposal>();
  const [detailsOverride, setDetails] =
    useState<Required<SourceProposalDetails>>();
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const resume = useQuery({
    queryKey: ["source-proposal-resume", proposalId, startNew],
    queryFn: () =>
      proposalId
        ? getSourceProposal(proposalId)
        : resumeOrCreateSourceProposal(startNew),
    retry: false,
  });
  const proposal = proposalOverride ?? resume.data;
  const details =
    detailsOverride ??
    (proposal ? detailsFromProposal(proposal) : emptyDetails);
  const autosave = useMutation({
    mutationFn: (body: SourceProposalDraft) => {
      if (!proposal) throw new Error("Source Proposal هنوز آماده نیست.");
      return autosaveSourceProposalDraft(proposal.id, body);
    },
    onSuccess: (data) => setProposal(data),
  });
  const preview = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Source Proposal هنوز آماده نیست.");
      await saveSourceProposalDetails(proposal.id, details);
      return generateSourceProposalPreview(proposal.id);
    },
    onSuccess: (data) => {
      setProposal(data);
      setPreviewConfirmed(false);
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Source Proposal هنوز آماده نیست.");
      return submitSourceProposal(proposal.id);
    },
    onSuccess: (data) => {
      setProposal(data);
      queryClient.setQueryData<SourceProposal[]>(
        ["source-proposals"],
        (current) =>
          current
            ? current.map((item) => (item.id === data.id ? data : item))
            : [data],
      );
    },
  });

  useEffect(() => {
    if (resume.data && startNew) setSearchParams({}, { replace: true });
  }, [resume.data, setSearchParams, startNew]);

  if (resume.isError) {
    return (
      <PageFrame>
        <ErrorAlert error={resume.error} />
      </PageFrame>
    );
  }
  if (resume.isPending || !proposal) {
    return (
      <PageFrame>
        <p role="status">در حال بازیابی Source Proposal…</p>
      </PageFrame>
    );
  }
  if (proposal.state === "pending") {
    return (
      <PageFrame>
        <Card className="mx-auto max-w-2xl shadow-none">
          <CardContent className="space-y-5 pt-6 text-center">
            <CheckCircle2
              className="text-primary mx-auto size-12"
              aria-hidden="true"
            />
            <h1 className="text-2xl font-semibold">در انتظار بررسی اپراتور</h1>
            <p role="status">
              {discoveryStageLabels[proposal.discovery_stage ?? "awaiting_url"]}
            </p>
            <p className="text-muted-foreground leading-7">
              Source Proposal وب‌سایت {proposal.website_name} ثبت شده است. کشف
              اطلاعات به معنی تأیید منبع یا انتشار آگهی نیست.
            </p>
            <Button asChild>
              <Link to="/dashboard">مشاهده وضعیت در داشبورد</Link>
            </Button>
          </CardContent>
        </Card>
      </PageFrame>
    );
  }

  const previewData = proposal.preview;
  const showPreview = !!previewData;
  const setField = <K extends keyof typeof details>(
    key: K,
    value: (typeof details)[K],
  ) => setDetails((current) => ({ ...(current ?? details), [key]: value }));
  const autosaveField = <K extends keyof SourceProposalDraft>(
    key: K,
    value: SourceProposalDraft[K],
  ) => autosave.mutate({ [key]: value });
  const handleDetails = (event: FormEvent) => {
    event.preventDefault();
    preview.mutate();
  };

  return (
    <PageFrame>
      <header className="mb-8 max-w-3xl">
        <p className="text-primary mb-2 text-sm font-semibold">
          معرفی منبع بیرونی
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Source Proposal وب‌سایت اجاره
        </h1>
        <p className="text-muted-foreground mt-3 leading-8">
          اطلاعات وب‌سایت و رابطه خود را ثبت کنید. دریافت صفحات تنها پس از تأیید
          نشانی توسط اپراتور آغاز می‌شود.
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
                  onBlur={() =>
                    autosaveField("website_name", details.website_name)
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
                  onBlur={() =>
                    autosaveField("website_url", details.website_url)
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
                    autosaveField("relationship", value);
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
                    autosaveField("inventory_range", value);
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
                  onBlur={() =>
                    autosaveField("sitemap_url", details.sitemap_url)
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
                  onBlur={() =>
                    autosaveField("operator_note", details.operator_note)
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
                    autosaveField("authority_declared", value);
                  }}
                />
                <Label htmlFor="authority" className="leading-6">
                  اعلام می‌کنم اختیار معرفی این وب‌سایت را برای بررسی ترب‌رنت
                  دارم.
                </Label>
              </div>
              {preview.isError && <ErrorAlert error={preview.error} />}
              {autosave.isError && <ErrorAlert error={autosave.error} />}
              {autosave.isSuccess && (
                <p className="text-muted-foreground text-sm" role="status">
                  پیش‌نویس ذخیره شد.
                </p>
              )}
              <Button
                type="submit"
                disabled={preview.isPending || !details.authority_declared}
              >
                {preview.isPending
                  ? "در حال ساخت پیش‌نمایش…"
                  : "ذخیره و مشاهده پیش‌نمایش"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className="h-fit shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe2 aria-hidden="true" /> پیش‌نمایش
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!showPreview && (
              <p className="text-muted-foreground">
                پس از ذخیره، اطلاعات وب‌سایت برای تأیید نهایی نمایش داده می‌شود.
              </p>
            )}
            {showPreview && (
              <>
                <Alert>
                  <ShieldCheck aria-hidden="true" />
                  <AlertTitle>{previewData.title}</AlertTitle>
                  <AlertDescription>{previewData.disclaimer}</AlertDescription>
                </Alert>
                <p className="text-sm">
                  این بازه فقط اطلاعات برنامه‌ریزی است؛ تعداد قطعی یا
                  تضمین‌شده‌ای برای کشف اعلام نمی‌شود.
                </p>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="preview-confirmed"
                    checked={previewConfirmed}
                    onCheckedChange={(checked) =>
                      setPreviewConfirmed(checked === true)
                    }
                  />
                  <Label htmlFor="preview-confirmed" className="leading-6">
                    این اطلاعات را بررسی کردم و می‌خواهم پیشنهاد را ارسال کنم.
                  </Label>
                </div>
                {submit.isError && <ErrorAlert error={submit.error} />}
                <Button
                  type="button"
                  disabled={!previewConfirmed || submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  ارسال برای بررسی
                </Button>
              </>
            )}
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
          "ذخیره Source Proposal انجام نشد. اطلاعات واردشده حفظ شده است.",
        )}
      </AlertDescription>
    </Alert>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      {children}
    </main>
  );
}

export default SourceProposalPage;
