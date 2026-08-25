import { redirect } from "react-router";

export function loader() {
  return redirect("/operator/submissions");
}

export default function OperatorReviewRedirect() {
  return null;
}
