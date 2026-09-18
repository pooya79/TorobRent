import { ProtectedAccountRoute } from "@/features/account/ProtectedAccountRoute";
import { FavoritesPage } from "@/pages/FavoritesPage";

export default function DashboardFavoritesRoute() {
  return (
    <ProtectedAccountRoute>
      <FavoritesPage />
    </ProtectedAccountRoute>
  );
}
