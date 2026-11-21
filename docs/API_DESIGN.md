# API design

## Implemented in Phase 1

| Method and path | Result |
| --- | --- |
| `GET /api/v1/health/live` | 200 `{ "status": "ok", "version": "0.1.0" }`; process responsive |
| `GET /api/v1/health/ready` | 200 `{ "status": "ready", "database": true, "redis": true }`; both checks passed |
| `GET /api/v1/health/ready` | 503 `{ "status": "unavailable", "database": false, "redis": true }`; booleans identify failing dependencies |
| `GET /api/docs` | Interactive OpenAPI documentation in development/test |
| `GET /api/openapi.json` | Machine-readable schema in development/test |

Health checks are unauthenticated and intentionally expose no hostnames or exceptions.
Readiness probes are bounded by `SLOTWISE_DEPENDENCY_TIMEOUT_SECONDS` per dependency
(default two seconds), run concurrently, and do not mutate data.

## Implemented in Phase 2

All following paths are under `/api/v1`. Mutations require an exact trusted Origin
and X-CSRF-Token matching the CSRF cookie; call GET `/auth/csrf` to initialize it.
Authenticated mutations also verify the session-bound CSRF digest. Cookies are
HttpOnly for access/refresh and Secure with a `__Host-` prefix in production.

| Method / path | Behavior |
| --- | --- |
| GET `/auth/csrf` | Initialize/read CSRF cookie and return csrf_token |
| POST `/auth/register` | name/email/password, 202 generic response, queue verification |
| POST `/auth/login` | email/password, user profile and session cookies |
| GET `/auth/me` | Current user id/name/email/verified; 401 if expired/revoked |
| POST `/auth/refresh` | Rotate cookies; consumed-token reuse revokes session family |
| POST `/auth/logout` | Revoke current session and clear cookies |
| POST `/auth/request-verification` | email, generic 202 response |
| POST `/auth/verify-email` | token; consume a one-hour link |
| POST `/auth/request-password-reset` | email, generic 202 response |
| POST `/auth/reset-password` | token/password; consume link, revoke all sessions |
| GET/POST `/workspaces` | List memberships/create owner workspace |
| GET `/workspaces/{id}` | Current-member workspace profile and role |
| GET `/workspaces/{id}/members` | Owner/manager team view |
| PATCH/DELETE `/workspaces/{id}/members/{user_id}` | Owner-only role change/removal; last owner protected |
| GET/POST `/workspaces/{id}/invitations` | Owner-only list/issue seven-day invite |
| DELETE `/workspaces/{id}/invitations/{invitation_id}` | Owner-only revoke, scoped lookup |
| POST `/invitations/accept` | Verified invited account + token; one-time membership creation |

Phase 2 lists use bounded `offset` (>=0) and `limit` (1–100, default100) and return
arrays. The UI pages member/invitation lists and loads workspace pages. Keyset list
envelopes are a future contract for growing scheduling datasets, not currently exposed.
Workspace creation accepts name, unique lowercase/hyphen slug and IANA timezone.
Passwords are 12–128 characters for creation/reset; email identities are normalized
to lowercase. All tenant routes require verified email and current membership.

Errors currently use `{error:{code,message}}`; 422 includes safe field/message details
without submitted values. 401 authentication, 403 role/CSRF/verification, 404 missing
or out-of-scope tenant record, 409 duplicate/last-owner, 429 limiter with Retry-After,
503 auth limiter unavailable. Request IDs and domain-specific appointment errors are
future work. API responses are no-store. Raw tokens are never returned in JSON or logs.

## Implemented Phase 3 contracts

All paths below are relative to `/api/v1/workspaces/{workspace_id}`. Reads require
owner/manager membership; writes require owner membership, verified email and the
existing session-bound CSRF/Origin checks. Out-of-scope IDs return 404.

| Method / path | Behavior |
| --- | --- |
| GET `/settings` | Business name, default zone, contact profile, policies and version; defaults/version 0 before first save |
| PATCH `/settings` | Replace validated profile/policies using the current version; returns incremented version |
| GET `/locations` | Complete location configurations; offset >=0, limit 1–100, default20 |
| POST `/locations` | Create location with version0, independent zone, active flag and rules; returns 201 |
| PATCH `/locations/{location_id}` | Atomically replace configuration with current version; deactivate through active=false |
| GET `/locations/{location_id}/preview?start=YYYY-MM-DD&days=7` | Saved operating hours only; 1–31 days, local dates with UTC interval endpoints and explicit issues |

Profile policies: minimum_notice_minutes (0–525600), booking_horizon_days (1–365),
cancellation_allowed, cancellation_notice_minutes (0–525600), default_duration_minutes
(5–1440), buffer_before_minutes/buffer_after_minutes (0–1440), slot_interval_minutes
(1–120). Minimum notice must be strictly shorter than the horizon in elapsed 24-hour
days. Cancellation cutoff is stored even when cancellation is disabled. Booking
enforcement belongs to Phase 5; these endpoints persist actual configuration now.

Location payload: name, address, timezone, active, version, weekly and exceptions.
Weekly rows are `{weekday:0..6,start:0..1439,end:1..1440}`; Monday is 0. Intervals are
half-open, non-overlapping and start < end; split overnight rules at midnight.
Exceptions are `{day,kind:"holiday"|"special",label,intervals:[{start,end}]}`. Holidays
have no intervals; special dates require intervals and replace recurrence. One
exception per date, at most366 dates and84 weekly rows per location. Exception windows
are limited to12 per date. Dates are bounded to years1900–2100. IANA zones are validated
server-side. Unknown input fields are rejected.

Preview returns an array of `{day,source,label,intervals:[{start,end}],issue}`.
Sources: weekly, holiday, special or inactive. Gaps in local time fail closed with an
issue; repeated times expand continuously across both folds. An inactive location has
no open intervals. This is not appointment availability. Dated nonexistent boundaries
return422 on save. Stale settings return409 `stale_settings`, preserving the stored
configuration. Successful writes emit sanitized audit events.

## Planned versioned contracts

Scheduling routes below are not implemented yet; Phase 2 routes above supersede
the earlier conceptual auth names. Use UUID identifiers, RFC3339 timestamps with
explicit offsets, IANA time zones for civil rules, and money as integer minor units
with currency. Date ranges are half-open and bounded. List responses use
`{items, next_cursor}` with default 50 and maximum 100; calendar date spans have a cap.

| Phase | Routes |
| --- | --- |
| 2 | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/verify-email`, `/auth/password-reset`; `/workspaces`, `/workspaces/{id}/memberships`, `/invitations` |
| 4 | Tenant-scoped `/employees`, `/skills`, `/resources`, `/services`; location settings use the Phase 3 contracts above |
| 5 | `GET /availability`; `GET/POST /appointments`; `GET/PATCH /appointments/{id}`; `POST /appointments/{id}/cancel`, `/reschedule` |
| 6 | Authenticated `/ws` workspace invalidations; calendar lists use bounded from/until filters |
| 7 | `/public/businesses/{slug}/services`, `/availability`, `/bookings`; signed expiring guest management flow |
| 8–10 | `/waitlist`, `/waitlist/offers/{id}/accept`, `/recommendations`, `/analytics` |

Workspace context is selected explicitly, then authorized against current membership
before any tenant lookup. Services receive that verified context. Customer and employee
permissions include ownership/assignment checks. Public serializers never expose
internal resource IDs, private staff contact data, or tenant configuration secrets.

Create booking requires `Idempotency-Key`; the digest binds principal, workspace and
validated payload. Updates require a version (`If-Match` or request version, finalized
in Phase 5). Availability is informational; booking success follows commit only.

Planned errors: `{error: {code, message, request_id, details}}`, with safe field-level
validation details. 401 unauthenticated, 403 forbidden, 404 missing or out-of-scope
object, 409 slot/idempotency conflict, 412 stale version, 422 invalid input, 429 rate
limited, 503 dependency/lock unavailable. No SQL errors, stack traces or PII in clients.
The foundation health contract is independent of this future domain error envelope.

## Phase 4 implemented catalog API

All paths below have prefix `/api/v1/workspaces/{workspace_id}/catalog` and require
a verified owner or manager. Other members receive 403; non-members receive 404.
Cookie mutations use the existing Origin/CSRF protection.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/{kind}?offset=0&limit=20` | Name/ID ordered page, limit 1–100; includes inactive items |
| POST | `/{kind}` | Create at version 0, return 201 with ID and version 1 |
| PATCH | `/{kind}/{id}` | Replace complete configuration using current version; stale saves return 409 |
| GET | `/{kind}/{id}/preview?start=2026-11-23&days=7` | Staff/resource effective UTC intervals after business hours and exclusions, max 31 days |
| GET | `/services/{id}/matches?location_id=...&on_date=2026-11-23` | Qualified staff and candidates for each resource requirement; no booking guarantee |

Kinds are `staff`, `skills`, `resources`, `pools`, `services`. Bodies contain the same
`kind` discriminator as the path, plus name, active and version. Responses wrap them
as `{ "id": "uuid", "data": { ...typed configuration... } }`; the returned `data`
can be edited and sent as the next PATCH body. OpenAPI publishes each concrete schema.

Staff has location_id, title, capacity, qualifications (skill_id/valid_until), availability.
Resources have location_id, resource_type, capacity, attributes and availability.
Pools have location_id, resource_type and resource_ids; every member must match both.
Services have location_ids, required skill_ids, optional employee_ids and optional
compatible_resource_ids. Empty employee/resource selections mean all otherwise eligible
candidates. All selected skills are required, including active state and date validity.

Service requirements select exactly one resource_id, pool_id or resource_type, with
quantity (distinct assets) and units_per_resource. Specific assets/pools must be at
every selected service location; use type requirements for multi-location services.
Capacity reductions that contradict a specific service requirement return 409.
Location/type changes of referenced items also return 409. Cross-tenant references,
invalid rules, impossible specific capacity and mismatched pool members return 422.

Duration ranges include both endpoints and advance by duration_step_minutes. Price is
integer minor units (JPY has no decimal minor subdivision); supported currencies are
EUR, USD, GBP, CAD, AUD, CHF, JPY and UAH. Minimum notice may inherit the business policy
(null) or override it. Policy enforcement, allocation and payment are not performed here.
