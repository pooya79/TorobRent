import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("guide", "routes/placeholder.tsx", { id: "guide" }),
  route("contact", "routes/placeholder.tsx", { id: "contact" }),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("verify-email", "routes/verify-email.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("privacy", "routes/placeholder.tsx", { id: "privacy" }),
  route("terms", "routes/placeholder.tsx", { id: "terms" }),
  route("add-submission", "routes/protected-add-submission.tsx"),
  route("search", "pages/ResultsPage.tsx"),
  route("properties/:propertyId/:slug?", "routes/property-detail.tsx"),
  route("dashboard", "routes/protected-dashboard.tsx"),
  route("operator/review", "pages/OperatorReviewPage.tsx"),
] satisfies RouteConfig;
