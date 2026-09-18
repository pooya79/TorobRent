import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return redirect(`/dashboard${url.pathname}${url.search}${url.hash}`);
}
