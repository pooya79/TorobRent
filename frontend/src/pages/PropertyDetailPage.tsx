import { AlertTriangle, Building2, CheckCircle2, MapPin } from "lucide-react";
import { useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { prototypeRepository } from "@/features/prototype/fixtures";

export function PropertyDetailPage() {
  const { propertyId = "saadat-abad-101" } = useParams();
  const property = prototypeRepository.getProperty(propertyId);
  const listings = prototypeRepository.getListings(propertyId);

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-360 px-4 py-8 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,.55fr)]">
        <div>
          <div className="bg-muted text-muted-foreground flex aspect-[16/9] items-center justify-center rounded-xl">
            <div className="flex flex-col items-center gap-3 text-sm">
              <Building2 className="size-12" aria-hidden="true" />
              تصویر تأییدشده‌ای برای این ملک وجود ندارد
            </div>
          </div>
          <header className="py-7">
            <div className="text-muted-foreground mb-3 flex items-center gap-2 text-sm">
              <MapPin className="size-4" aria-hidden="true" />{" "}
              {property.location}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {property.title}
            </h1>
            <p className="text-muted-foreground mt-3">
              {property.facts.join(" · ")}
            </p>
          </header>
        </div>

        <Card className="h-fit shadow-none lg:sticky lg:top-8">
          <CardHeader>
            <Badge variant="secondary" className="w-fit">
              تازه‌ترین شرایط اجاره
            </Badge>
            <p className="text-xl font-semibold">{property.depositLabel}</p>
            <p>{property.rentLabel}</p>
          </CardHeader>
          <CardContent>
            <Button className="w-full rounded-full">مشاهده راه ارتباطی</Button>
            <p className="text-muted-foreground mt-3 text-xs">
              اطلاعات تماس فقط پس از درخواست شما نمایش داده می‌شود.
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="mt-10" aria-labelledby="listing-comparison-title">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2
            id="listing-comparison-title"
            className="text-2xl font-semibold tracking-tight"
          >
            مقایسه {property.listingCountLabel}
          </h2>
          <Badge variant="outline">
            <CheckCircle2 aria-hidden="true" /> اطلاعات منابع جدا نگه داشته
            شده‌اند
          </Badge>
        </div>
        <Alert className="mb-5" variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>اختلاف در مبلغ ودیعه</AlertTitle>
          <AlertDescription>
            یکی از منابع مبلغ متفاوتی اعلام کرده است. پیش از ادامه شرایط را
            بررسی کنید.
          </AlertDescription>
        </Alert>
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-180 border-collapse text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="p-4 text-start font-medium">منبع</th>
                <th className="p-4 text-start font-medium">ودیعه</th>
                <th className="p-4 text-start font-medium">اجاره ماهانه</th>
                <th className="p-4 text-start font-medium">تازگی</th>
                <th className="p-4 text-start font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr className="border-border border-t" key={listing.source}>
                  <th className="p-4 text-start font-semibold">
                    {listing.source}
                  </th>
                  <td className="p-4">{listing.deposit}</td>
                  <td className="p-4">{listing.rent}</td>
                  <td className="p-4">{listing.freshness}</td>
                  <td className="p-4">
                    <Badge variant="secondary">{listing.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default PropertyDetailPage;
