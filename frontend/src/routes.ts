import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("guide", "routes/placeholder.tsx", { id: "guide" }),
  route("contact", "routes/placeholder.tsx", { id: "contact" }),
  route("login", "routes/placeholder.tsx", { id: "login" }),
  route("add-submission", "routes/placeholder.tsx", { id: "add-submission" }),
  route("search", "routes/placeholder.tsx", { id: "search" }),
] satisfies RouteConfig;
