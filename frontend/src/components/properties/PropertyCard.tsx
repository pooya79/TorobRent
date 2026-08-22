import { Building2, MapPin } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
export type PropertyCardData = {
  id: string;
  title: string;
  location: string;
  facts: readonly string[];
  imageUrl?: string;
  listingCountLabel: string;
  rentalTerms: {
    depositLabel: string;
    monthlyRentLabel: string;
  };
  freshnessLabel: string;
  detailHref?: string;
};

export function PropertyCard({ property }: { property: PropertyCardData }) {
  return (
    <Card className="group relative gap-0 overflow-hidden border-0 py-0 shadow-none">
      <div className="bg-muted relative aspect-[4/3] overflow-hidden rounded-xl">
        {property.imageUrl ? (
          <img
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
            src={property.imageUrl}
            alt=""
          />
        ) : (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-3">
            <Building2 className="size-10" aria-hidden="true" />
            <span className="text-sm">تصویر این ملک هنوز منتشر نشده است</span>
          </div>
        )}
        <Badge className="bg-card text-foreground hover:bg-card absolute start-3 top-3 shadow-sm">
          {property.listingCountLabel}
        </Badge>
      </div>
      <CardHeader className="gap-2 px-0 pt-4 pb-2">
        <div className="text-muted-foreground flex items-center gap-1 text-sm">
          <MapPin className="size-4" aria-hidden="true" />
          {property.location}
        </div>
        <h2 className="text-lg font-semibold tracking-tight">
          <Link
            className="after:absolute after:inset-0 focus-visible:rounded-sm"
            to={property.detailHref ?? `/properties/${property.id}`}
          >
            {property.title}
          </Link>
        </h2>
        <p className="text-muted-foreground text-sm">
          {property.facts.join(" · ")}
        </p>
      </CardHeader>
      <CardContent className="space-y-1 px-0 pb-3 text-sm">
        <p className="font-semibold">
          ودیعه {property.rentalTerms.depositLabel}
        </p>
        <p>اجاره ماهانه {property.rentalTerms.monthlyRentLabel}</p>
      </CardContent>
      <CardFooter className="text-muted-foreground border-border border-t px-0 py-3 text-xs">
        {property.freshnessLabel}
      </CardFooter>
    </Card>
  );
}
