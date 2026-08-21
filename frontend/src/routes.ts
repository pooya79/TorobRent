import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("guide", "routes/placeholder.tsx", { id: "guide" }),
  route("contact", "routes/placeholder.tsx", { id: "contact" }),
  route("login", "routes/placeholder.tsx", { id: "login" }),
  route("privacy", "routes/placeholder.tsx", { id: "privacy" }),
  route("terms", "routes/placeholder.tsx", { id: "terms" }),
  route("add-submission", "pages/AddSubmissionPage.tsx"),
  route("search", "pages/ResultsPage.tsx"),
  route("properties/:propertyId", "pages/PropertyDetailPage.tsx"),
  route("dashboard", "pages/SubmitterDashboardPage.tsx"),
  route("operator/review", "pages/OperatorReviewPage.tsx"),
] satisfies RouteConfig;
