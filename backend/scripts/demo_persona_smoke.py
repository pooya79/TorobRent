import json
import sys
from http.cookiejar import CookieJar
from urllib.request import HTTPCookieProcessor, Request, build_opener


def request_json(opener, request: Request) -> object:
    with opener.open(request, timeout=10) as response:
        if response.status >= 400:
            raise RuntimeError(f"Demo request failed with HTTP {response.status}")
        return json.load(response)


def authenticated_opener(base_url: str, *, identifier: str, password: str):
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    session = request_json(opener, Request(f"{base_url}/api/v1/auth/session/"))
    if not isinstance(session, dict) or not isinstance(session.get("csrf_token"), str):
        raise RuntimeError("Demo session did not return a CSRF token")
    body = json.dumps({"identifier": identifier, "password": password}).encode()
    login = Request(
        f"{base_url}/api/v1/auth/login/",
        data=body,
        headers={"Content-Type": "application/json", "X-CSRFToken": session["csrf_token"]},
        method="POST",
    )
    request_json(opener, login)
    return opener


def main() -> None:
    base_url = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://nginx"
    submitter = authenticated_opener(
        base_url,
        identifier="submitter@torobrent.local",
        password="demo-submitter",
    )
    submissions = request_json(submitter, Request(f"{base_url}/api/v1/submissions/"))
    if not isinstance(submissions, list) or not submissions:
        raise RuntimeError("Submitter demo queue is unavailable")

    operator = authenticated_opener(
        base_url,
        identifier="operator@torobrent.local",
        password="demo-operator",
    )
    review_queue = request_json(
        operator,
        Request(f"{base_url}/api/v1/operator/submissions/?state=pending"),
    )
    if not isinstance(review_queue, list) or len(review_queue) != 1:
        raise RuntimeError("Operator demo queue is unavailable")
    print("Demo personas authenticated and accessed their prepared queues.")


if __name__ == "__main__":
    main()
