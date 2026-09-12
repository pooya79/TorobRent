import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";
import { CatalogCurationPage } from "@/pages/CatalogCurationPage";

export default function OperatorCatalogCurationRoute() {
  return (
    <OperatorCapabilityRoute capability="curate_catalog">
      <CatalogCurationPage />
    </OperatorCapabilityRoute>
  );
}
