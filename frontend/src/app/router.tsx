import { createBrowserRouter } from "react-router";

import { ErrorPage } from "@/pages/ErrorPage";
import { HomePage } from "@/pages/HomePage";

export const router = createBrowserRouter([
  { path: "/", element: <HomePage />, errorElement: <ErrorPage /> },
]);
