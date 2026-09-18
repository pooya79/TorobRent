import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return redirect(`/dashboard/website${url.search}${url.hash}`);
}
