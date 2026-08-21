# API contract

## Conventions

- Public application endpoints live below `/api/v1/` and use JSON with `snake_case` fields.
- The OpenAPI 3.1 document in `contracts/openapi.yaml` is generated from Django and committed.
- Successful object responses are not wrapped. Future list endpoints use
  `{count, next, previous, results}`, with a default page size of 25 and maximum of 100.
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

TorobRent does not define login, logout, registration, recovery, verification, roles, or
invitations. Add those as explicit product requirements. Rotate sessions at authentication and
permission-boundary changes when implementing them.

## Changing the contract

Run `make api-client` after changing an endpoint or serializer. Review the OpenAPI and TypeScript
diff together. CI regenerates both artifacts and rejects drift. Breaking changes require a new URL
version or an explicitly coordinated migration; additions remain within `/api/v1/`.
