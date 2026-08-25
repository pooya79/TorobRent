# API contract

## Conventions

- Public application endpoints live below `/api/v1/` and use JSON with `snake_case` fields.
- The OpenAPI 3.1 document in `contracts/openapi.yaml` is generated from Django and committed.
- Successful object responses are not wrapped. Future list endpoints use
  `{count, next, previous, results}`, with a default page size of 25 and maximum of 100. An
  endpoint-specific operational default may override 25 when its OpenAPI contract documents it;
  the Support Request queue defaults to 50.
- Identifiers are UUID strings. Times are UTC RFC 3339 strings. Decimal values are strings.
- Query filtering and ordering must be explicitly described in OpenAPI; undocumented parameters
  are not part of the contract.

## Errors

Errors use `application/problem+json` with `type`, `title`, HTTP `status`, human-readable `detail`,
stable machine `code`, `request_id`, and optional field `errors`. Frontend behavior branches on
`status` or `code`, never on translated detail text.

Every response includes `X-Request-ID`. A valid UUID supplied by a trusted caller is preserved;
invalid values are replaced. The same ID is attached to application logs.

## Authentication and CSRF

Authentication uses an HTTP-only, `SameSite=Lax` Django session cookie. The application is
same-origin and CORS is disabled. `GET /api/v1/auth/session/` returns session state and a CSRF token;
the centralized frontend client attaches it as `X-CSRFToken` to unsafe requests.

Submitters register and authenticate with email and password. Registration, verification, login,
logout, password-reset request and confirmation are explicit `/api/v1/auth/` operations. Recovery
requests always return the same response whether an account exists. Verification and reset links
are time-limited and one-time. Sessions and CSRF secrets rotate at authentication boundaries.

`GET /api/v1/users/me/` returns the current account, including `email_verified` and the stable
domain identifiers in `operator_capabilities`. The identifiers are `review_submissions`,
`handle_support`, `handle_privacy_requests`, and `manage_operator_queues`; raw Django permission
codenames are not exposed. Submitter write flows must require verification, and the browser also
blocks entry to Submission and Operator routes until the email has been verified.

## Changing the contract

Run `make api-client` after changing an endpoint or serializer. Review the OpenAPI and TypeScript
diff together. CI regenerates both artifacts and rejects drift. Breaking changes require a new URL
version or an explicitly coordinated migration; additions remain within `/api/v1/`.
