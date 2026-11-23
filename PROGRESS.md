# SlotWise progress

Updated: 2026-11-23 (Europe/Berlin).

## Current status

**Phases 1–5 are complete and verified within the documented boundaries.**
All verified commits through `534ccca` are pushed. Phase 6 calendar drag/resize
is implemented locally; authenticated realtime delivery remains next.
Phase 2 was authorized by the continuation request after closing the Phase 1 Docker gap.

## Phase 1 retained

FastAPI/React foundation, typed settings, PostgreSQL/Redis readiness, liveness,
OpenAPI, Alembic bootstrap, responsive status UI, locked builds, Compose and CI.
Docker Engine 29.10 and Compose 5.8 run inside the existing Ubuntu WSL2 distribution.
The prior Docker startup acceptance gap is closed; manual Docker help is unnecessary.

## Phase 2 delivered

- Registration, Argon2id password hashing, login/logout, email verification and
  password reset with expiring single-use links and all-session reset revocation.
- HttpOnly session cookies, rotating refresh tokens, reuse detection that revokes
  the session family, Origin/CSRF enforcement and Redis rate limiting.
- Workspaces with IANA time zones, multiple memberships, invitations, role changes,
  membership removal, live backend authorization and last-owner protection.
- Owner, manager, employee and customer permissions scoped to each workspace.
- Transactional encrypted authentication email outbox with bounded SMTP retries,
  actual Mailpit delivery and payload removal after successful delivery.
- Responsive account, onboarding and team screens with validated forms, protected
  routes, workspace switching, pagination and actionable loading/error states.
- Alembic revision 0002, audit events, production cookie/configuration checks,
  updated architecture/API/database documentation and captured UI screenshots.

## Verified acceptance evidence

| Check | Result |
| --- | --- |
| Container backend suite | **29 passed**, including existing foundation tests |
| Vitest/React Testing Library | **12 passed** |
| Full-stack Playwright | **8 passed**, desktop and mobile |
| Ruff lint and format | Passed |
| mypy | Passed |
| TypeScript, ESLint, Prettier | Passed |
| Vite production builds | Passed on Windows and in Linux images |
| Compose build and health-gated startup | Passed; five runtime services healthy, migration exited successfully |
| PostgreSQL revision and extension | Revision 0002 and btree_gist verified |
| HTTP/SMTP smoke | Passed for direct/proxied health/OpenAPI, frontend CSP and Mailpit |
| Visual review | Login/mobile and workspace/desktop/mobile screenshots inspected |
| Remote CI | Not executed; corresponding local checks passed |

Database tests use unique isolated PostgreSQL schemas and real Redis. They cover
cross-workspace access, all workspace roles, CSRF, rate limits, expired/replayed links,
refresh reuse, logout/reset revocation, suspended workspaces and encrypted mail retry.
Concurrent requests verify refresh-family revocation and prevent removal of the last
owner. No SQLite substitute or skipped integration gate was used.

Browser tests use the actual Nginx/API/PostgreSQL/Redis/Mailpit stack. They exercise
registration, delivered verification links, login, workspace creation/switching,
invitation acceptance, role changes, password reset and logout on desktop/mobile.
Only synthetic example.com accounts are used; those browser fixtures remain in the
local development database. Existing foundation browser checks also pass.

Discovered issues fixed during verification include SQLAlchemy session insertion
ordering, Windows IANA data availability, safe handling of non-JSON API errors,
production Secure cookie deletion and a strict browser combobox locator.

## Technical decisions

- Preserve the modular monolith and explicit immutable migrations.
- Store token digests, never raw session tokens; keep credentials out of browser storage.
- Serialize identity changes with user locks and membership changes with workspace
  locks, prioritizing correctness and last-owner/session invariants.
- Use a small transactional SMTP outbox for required authentication mail now;
  general notification scheduling/Celery remains Phase 8.
- Keep authorization authoritative on the backend and re-read current memberships.
- Keep platform administration separate from tenant roles; no implicit admin bypass.

## Reproduce

From the repository root in a Docker-enabled shell:

```text
docker compose config --quiet
docker compose up --build --wait --wait-timeout 240
docker compose --profile test run --build --rm test
python infra/check_stack.py
```

In frontend run pnpm typecheck, pnpm lint, pnpm format:check, pnpm test and pnpm build.
Set SLOTWISE_FULL_STACK=1 for pnpm test:e2e against the running Docker stack.
Set SLOTWISE_CAPTURE=1 as well to refresh the repository screenshots.
Backend lint/type commands are uv run ruff check ., uv run ruff format --check .,
and uv run mypy src from backend. Compose enables SLOTWISE_INTEGRATION automatically.

Docker is inside WSL, not Windows PATH; see README for exact WSL commands. Keep an
attached Compose log-follow terminal open to prevent WSL idle shutdown. Use docker
compose down without --volumes to preserve local data.

## Outstanding issues and limitations

- No blocking Phase 2 acceptance issues remain.
- Upstream TestClient/httpx, ESLint and transitive dependency deprecation warnings
  remain unsuppressed. Backend final run reports one TestClient warning.
- SMTP delivery is at least once across a send/commit crash; duplicate delivery is
  possible. Exhausted retries require operational attention.
- Rate limits use the actual peer address, not untrusted forwarding headers. Behind
  the development proxy clients share a conservative bucket; production proxy trust
  and per-client policy need deployment configuration.
- Browsers without Web Locks can race refresh across tabs and require signing in again.
- Development HTTP/default credentials are not production configuration. No public
  deployment, remote CI run, commit or push was performed.
- Appointment scheduling and platform administration remain later work. Phase 3 business settings are documented below.

## Phase 3 — complete and verified

The user explicitly authorized Phase 3. The implementation follows the existing modular monolith.


### Delivered business configuration

- Owner-editable business name/default zone, description and contact details; manager read access.
- Typed booking/cancellation policies, default duration, buffers, notice/horizon and slot grid.
- Multiple locations, independent IANA zones, address and activation/deactivation.
- Weekly half-open intervals, holidays and dated special hours with replacement semantics.
- Real persisted operating-hours preview with UTC expansion and local offset display.
- Atomic versioned updates under the workspace guard, tenant-composite foreign keys and audit events.
- Revision 0003, responsive settings screens and documentation for API/data/DST semantics.

### Phase 3 observed verification

| Check | Result |
| --- | --- |
| Complete backend suite | **46 passed**; 29 existing + 17 Phase 3 cases |
| Frontend unit/component suite | **17 passed**; 12 existing + 5 Phase 3 cases |
| Real-stack browser suite | **10 passed**; 8 existing + 2 desktop/mobile settings flows |
| Ruff lint/format and mypy | Passed; 33 application source files typed |
| TypeScript, ESLint, Prettier | Passed |
| Windows and Linux production builds | Passed |
| Compose startup and migration | Healthy stack; migration 0003 applied |
| HTTP/SMTP smoke | Direct/proxied API, frontend, Mailpit HTTP and SMTP passed |
| Screenshot review | Desktop/mobile settings and final saved-hours previews inspected |
| Remote CI | Not run; local equivalent suites passed |

New backend cases cover Berlin spring/fall boundaries, midnight and fractional-offset
zones, overlap/overnight/date/policy validation, persisted profile/schedule state,
independent location zones, inactive locations, holiday/replacement precedence,
nonexistent boundaries with explicit correction, all workspace roles, CSRF, cross-tenant
composite foreign keys and concurrent stale profile saves. PostgreSQL tests retain the
isolated-schema fixture; no live data deletion is used. Browser fixtures remain synthetic.

Browser tests configure policies and a location through real forms, save, reload,
inspect holiday/special hours, check both DST offsets and deactivate/reactivate.
The final backend rerun passed all 46 tests; the refined settings browser checks
also passed again on both desktop and mobile after the full 10-test run.
All prior account and foundation tests pass. During verification, strict TypeScript
caught unchecked array reads; backend typing was tightened for exception kinds.
A browser select locator was corrected to the observed accessible combobox role.
The known WSL idle shutdown interrupted one run; an attached log-follow session restored
stable execution. No test timeout or acceptance criterion was weakened.

### Decisions and scope limits

- Configuration writes serialize with the existing workspace lock and reject stale
  versions (409). No cross-workspace move or destructive location delete is exposed.
- Civil-time rules use 0–1440 minute boundaries; overnight hours must be split.
  Holidays close a date and special hours replace it. Annual repetition/import is not implemented.
- Fall-back openings span both folds continuously. Nonexistent dated boundaries are
  rejected; a recurring gap closes that preview date with a warning until corrected.
- The policy document is validated JSONB; operating rules/windows are normalized rows.
  No appointment availability or booking enforcement is claimed before Phase 5.
- Upstream dependency warnings and the existing development deployment limitations remain.
  No remote CI, commit, push or production deployment was performed.

## Phase 3 boundary (historical)

Phase 4 adds staff/skills/availability, resource units/pools and services/requirements,
with tenant constraints, qualification/capacity tests and management forms. This work
was subsequently authorized and completed below.

## Phase 3 continuation — 2026-11-21

Inspection found Phase 3 already implemented. Retained its behavior and removed the
location-list N+1 queries: each nonempty page now loads operating rules, exceptions
and exception windows in three tenant-scoped queries total. Grouping by location
and date preserves ordered schedules without mixing locations. No schema or API
contract change was needed.

Added a real-PostgreSQL regression test comparing query counts for one and three
locations, checking distinct schedules on the same exception date and empty pages.

Fresh verification:

- Backend Docker suite: **47 passed**, including the new regression; one existing
  Starlette TestClient deprecation warning.
- Frontend Vitest: **17 passed**. Full-stack Playwright: **10 passed** on desktop/mobile.
- Ruff lint/format, mypy, TypeScript, ESLint and Prettier: passed.
- Docker production build and health-gated startup: passed; HTTP/OpenAPI and
  Mailpit HTTP/SMTP smoke checks passed.
- The sandbox's pnpm wrapper failed on cache symlink access; the already installed
  Node test/lint/type/format entry points passed directly. Docker's pnpm build passed.
- Browser verification used the existing Playwright browser cache and approved
  localhost access after sandbox-only launch/navigation failures. No assertions changed.

No Phase 4 work, remote CI, commit, push or deployment was performed.

## Phase 4 — complete and verified (2026-11-21)

### Delivered

- Staff profiles with scheduling titles, location, active state, capacity, qualifications
  and inclusive expiry dates; explicit service eligibility and required-skill matching.
- Weekly availability, breaks, dated replacement hours, approved time off and resource
  maintenance, intersected with location opening hours in DST-aware UTC previews.
- Resources with type, location, attributes, capacity and stable capacity-unit UUIDs.
  Pool members must share a location/type; deactivation retains configuration/history.
- Services with variable duration, minor-unit price/currency, buffers, notice override,
  locations, qualifications, compatible staff/assets and specific/pool/type requirements.
- Responsive management screens, search, loading/error states, stale-save recovery,
  configuration-match checks, desktop/mobile screenshots and lazy-loaded catalog UI.
- Immutable migration 0004, tenant-and-kind composite foreign keys, atomic versioned
  changes under the workspace lock, audit events and batched relationship loading.
- Model constraint names now match the existing Phase 2/3 migrations. CI includes
  `alembic check`; no old migrations or live uniqueness constraints were changed.

### Verification

| Check | Result |
| --- | --- |
| Full backend suite against PostgreSQL/Redis | **73 passed** (47 existing + 26 Phase 4) |
| Frontend component/unit suite | **23 passed** (17 existing + 6 Phase 4) |
| Full-stack Playwright | **12 passed**, desktop/mobile |
| Ruff lint/format and mypy | Passed; 40 application source files typed |
| TypeScript, ESLint, Prettier | Passed |
| Docker production build and health-gated startup | Passed |
| Migration consistency | `No new upgrade operations detected` |
| HTTP/OpenAPI and SMTP smoke checks | Passed |
| Visual review | Staff desktop/mobile and service mobile reviewed; screenshots retained |
| Remote CI / push | Not run; push awaits explicit user agreement |

Tests exercise tenant access and relational foreign keys, role/CSRF enforcement,
configuration round trips, qualification expiry, capacity/selector validation, pool
compatibility, stable units after reductions/restoration, concurrent stale edits,
DST transitions, breaks/leave/opening-hour intersections and browser persistence.
Browser verification caught duplicate React sibling keys that left an old editor
visible; the fix has a regression test. A select locator was changed to the observed
accessible combobox role. Final backend run has one upstream TestClient deprecation.

After the session resumed, Docker Desktop owned the default socket while the original
Ubuntu Docker stack still owned the localhost ports. Final backend verification ran in
the isolated `slotwise-phase4-check` Compose project with published ports reset via
an ignored `.cache/phase4-compose.yml` override; all five runtime services became
healthy and fresh migrations applied. Browser/smoke tests used the existing rebuilt
Ubuntu stack. No existing service or database was deleted to resolve the port conflict.
The temporary verification project was stopped after checks, retaining its volumes.

### Decisions and phase boundary

The catalog uses explicit kind-specific contracts with shared identity/version storage.
Relationships, requirements and units are relational; bounded scalar and availability
value objects use validated JSONB. See architecture/database docs for the rationale.
Owners and managers configure schedules directly; employee leave requests/approval,
account-to-profile links and multi-location staff assignments remain future extensions.
Selectors currently load all paginated catalog records for the selected workspace.

Configuration matches do not prove simultaneous resource allocation or reserve a slot.
Phase 5 must enforce booking policies, buffers, existing reservations and capacity
reductions against bookings in a transaction with database exclusion protection.
No Phase 5 implementation, public deployment or push was performed.

## Phase 5 — availability milestone (2026-11-21)

The continuation request authorized Phase 5. Work is divided into bounded milestones
following the user's request to reduce credit usage. Phase 4 commit `9fac2c1` was pushed
after explicit agreement; the preceding section records its pre-push state.

Delivered a pure deterministic engine and owner/manager availability endpoint. It
intersects business/staff/resource hours, exceptions, breaks and UTC unavailability;
checks skills through the final local service date, duration, notice, horizon and
buffers; and jointly assigns distinct stable capacity units across requirements.
Local-time grids handle DST gaps/folds and non-hour zones. Search limits fail explicitly;
result limits report truncation only when another feasible slot exists.

The engine accepts occupancy snapshots, but the API has no appointment storage yet and
explicitly returns `reservation_aware: false`. Results never reserve capacity. Atomic
bookings, PostgreSQL exclusion constraints, idempotency, cancellation/rescheduling,
booking UI and race tests remain required before completing Phase 5. No schema change.

Verification uses focused engine tests followed by the full backend suite in the isolated
Compose project with real PostgreSQL/Redis. Frontend/browser checks are unchanged and
were not repeated for this backend-only milestone. See final verification below.

### Availability milestone verification

- Full backend suite: **88 passed** (73 existing, 11 new engine cases, 4 new API cases)
  against real PostgreSQL/Redis; one existing upstream TestClient deprecation warning.
- Ruff lint/format and strict mypy: passed, 45 application source files.
- Backend image build, migration startup and readiness: passed in the isolated project.
- No frontend changes, schema changes, public deployment or remote push in this milestone.
- Temporary Compose services stopped after checks, preserving their volumes.

## Phase 5 — transactional booking milestone (2026-11-22)

Availability milestone committed locally as `915d2cb`. Added owner/manager booking
creation, paginated listing, cancellation and rescheduling. Availability now reads
committed allocations. Create and reschedule recompute the exact requested instant
under the workspace guard; client-supplied allocation IDs are never trusted.

Migration 0005 adds appointments, active capacity allocations, idempotent receipts and
durable booking history/outbox events. PostgreSQL GiST exclusion rejects overlapping
buffered ranges per capacity unit, including writes bypassing the application guard.
Appointments, allocations, audit, history and retry receipts commit atomically.
Failed reschedules preserve the original booking; cancellation deletes active
allocations while preserving receipts/history. Snapshots retain service name and price.

Current boundaries: internal owner/manager API only; customer identity/ownership and
public flows remain later work. Cancellation rules apply to internal users too, without
an override. Existing catalog/profile updates are conservatively blocked while any
upcoming workspace allocations exist; location edits are guarded by location. Creating
new catalog items remains allowed. More precise conflict resolution is future work.
Outbox events are durable but have no notification dispatcher yet. Lock timeout,
deadlock and serialization failures return retryable 503 with the same idempotency key;
there is no automatic server-side retry loop. Booking UI and its full-stack checks
remain before Phase 5 can be considered complete. No push is authorized for these changes.

### Booking backend verification

- **100 backend tests passed** against PostgreSQL/Redis, including 12 new booking cases.
- Concurrent tests cover exclusive capacity, capacity C with C+1 contenders, duplicate
  idempotent requests, cancellation versus rescheduling, and configuration versus booking.
- Direct SQL tests verify exclusion and tenant foreign keys independently of API locking.
- Ruff lint/format and strict mypy passed (48 application source files).
- Fresh migration upgrade, `alembic check`, downgrade to base and re-upgrade passed.
- Runtime build/readiness passed. Temporary database removed and verification services
  stopped, retaining normal volumes. Frontend was unchanged and its checks were not rerun.
- Final tests emitted upstream TestClient deprecation and Pydantic field-alias warnings.
  Initial verification caught a stale migration-head assertion; it now expects 0005.

## Phase 5 — booking UI and final verification (2026-11-22)

Pushed `915d2cb` and `5ffdebc` to `origin/main` on explicit request. Added the lazy-loaded
Appointments section for owners/managers: service/location/date/duration/staff search,
offset-labelled local times, assigned staff/resources and price review, customer name,
confirmation, paginated history, rescheduling and cancellation. Empty, loading, error,
conflict and uncertain-response states are explicit. Search changes clear stale selections.

The availability API accepts an optional tenant-scoped `exclude_booking_id` for
reschedule previews; only a confirmed booking in the current workspace can be excluded.
This permits overlapping moves without first releasing the original allocation.
The booking write still revalidates independently under the guard.

Uncertain responses freeze the command and retain its idempotency key for explicit
retries while the editor remains open. Keys are not persisted across reload/navigation;
the UI asks users to remain on the page. If they leave anyway, they must inspect current
appointment history before starting another request. Public customer access, calendar
views and notification delivery retain their planned later-phase boundaries.

Final verification: **100 backend tests**, **27 frontend tests**, and **12 desktop/mobile
Playwright checks** passed. Browser verification initially started before readiness;
the seven passing checks were retained and the five affected checks rerun successfully
after readiness and a dropdown selector correction. Browser coverage now includes
booking persistence after reload, overlapping rescheduling, cancellation and mobile
overflow. Desktop/mobile editor and history screenshots were retained and reviewed.
TypeScript, ESLint, Prettier, Ruff and mypy passed; production Compose images built
and all runtime services became healthy. No database migration was needed for this UI
milestone. Phase 6 has not been started.

## Phase 6 — calendar views milestone (2026-11-22)

After the next continuation, committed the verified Phase 5 UI locally as `4911524`
and started Phase 6. Added day/week/month/agenda calendar views, date navigation,
location/staff/resource/status filters, manual refresh and an accessible native details
dialog. Desktop week/month layouts use seven columns; mobile uses stacked day sections.
Time labels include UTC offsets. All-location views use the workspace timezone; a
selected location uses its timezone. Overnight bookings appear on each occupied civil
date, with midnight end treated exclusively. Configuration loading is shared with the
booking UI; workspace navigation now uses one section state.

Booking list queries support a timezone-aware overlap range of at most 93 days plus
tenant-scoped filters. Staff/resource filtering reads booking snapshots, so cancelled
history remains filterable after active allocations are removed. Calendar requests use
a padded UTC envelope, followed by exact local-date grouping. Paginated loading fails
explicitly at 5,000 records instead of silently displaying partial availability.

This milestone is read-only. Staff/resource timelines, drag/resize interactions and
authenticated realtime updates/reconnect handling remain outstanding Phase 6 work.
No additional push is authorized; UI/calendar commits remain local.

Calendar milestone verification: **101 backend tests**, **30 frontend tests**, and
**12 full-stack desktop/mobile browser checks** passed. API tests cover overlap edges,
history filters after cancellation, tenant access and invalid ranges. Frontend tests
cover DST-week arithmetic, leap days, overnight/exclusive-midnight grouping and scoped
query filters. Browser checks exercise all four calendar views, assignment/status
filters, details dialog and date navigation with real persisted bookings. Desktop/mobile
screenshots were reviewed and retained. Production build/readiness, TypeScript, ESLint,
Prettier, Ruff and strict mypy passed. No migration or dependency was added.

## Phase 6 — staff/resource timeline milestone (2026-11-22)

Pushed `4911524` and `4e1c979` on explicit request. Added daily Staff timeline and
Resource timeline views using persisted booking assignments. Active catalog rows remain
visible when empty; historical/inactive assignments are retained. Filters and the native
details dialog are shared with the existing calendar. Rows reveal in batches of 20.

The horizontal axis uses actual elapsed UTC time between local date boundaries, so
23/25-hour DST days and repeated-hour offsets remain distinct. Civil boundaries are
found without assuming a midnight offset or 24-hour duration; skipped dates show an
explicit message. Confirmed bookings show service time over a shaded buffered span;
cancelled records show only historical service time. Overlaps occupy separate lanes;
half-open adjacency reuses a lane. Resource cards report the assigned unit quantity.
Overnight and buffer-only spans are clipped to the displayed date. Timeline fetches
extend the calendar envelope by another day for maximum buffers in extreme timezones.

Rows have sticky labels, keyboard-scrollable horizontal content and clickable booking
bars. A readable appointment list offers full-size selection targets for very short
bookings. Empty space is explicitly not advertised as availability. This is still a
read-only visualization: transactional drag/resize and authenticated realtime delivery
remain outstanding. No backend, migration or dependency changes in this milestone.

Verification: **40 frontend tests** and **12 full-stack desktop/mobile browser checks**
passed. TypeScript, ESLint, Prettier and the production Compose build/readiness checks
passed. Timeline tests cover DST transitions, skipped dates, non-hour offsets,
overlapping/adjacent bookings, buffer-only clipping, resource quantities and history.
Desktop/mobile screenshots are retained under `docs/screenshots/timeline-*.png`.
The two timeline browser scenarios were rerun after the final axis-label adjustment.
Backend code is unchanged; its previous **101-test** result was not rerun for this
frontend milestone. This milestone is committed locally pending push approval.

## Phase 6 — calendar move/resize milestone (2026-11-23)

The preceding timeline commit `534ccca` was pushed on explicit agreement. Calendar
owners/managers can now drag confirmed timeline cards to propose a time change and
drag the duration handle to resize. Moves use 15-minute elapsed-time increments;
resize uses the service duration step. Keyboard arrows (Shift for resize) and large
buttons in appointment details provide alternatives for mobile and short cards.
Assignment stays on the same staff member; resources are reallocated by the existing
service rules. Cross-row reassignment is not supported by these gestures.

Every proposal opens a review dialog showing original/proposed times and UTC offsets.
Confirmation submits the existing versioned, idempotent reschedule command. No
optimistic placement survives the gesture: the original booking remains displayed
until the server confirms. Conflicts refresh stale data and let the user keep the
original time; uncertain responses freeze dismissal and retry the exact command/key.
Cancelled bookings remain read-only. No backend, migration or dependency changes.

Verification: **45 frontend tests** passed, including DST-fold movement, duration
changes, confirmation payload/version, conflict refresh, uncertain-result retries and
keyboard/read-only behavior. **12 full-stack desktop/mobile browser checks** passed,
including real mouse drag/resize, abandoning a proposal without changing the booking,
keyboard movement, mobile button controls and persisted duration changes. TypeScript,
ESLint, Prettier and the production Compose build/readiness checks passed. Desktop and
mobile confirmation screenshots were reviewed and retained. Backend code is unchanged;
the previous 101-test backend result was not rerun. New work remains local pending push
agreement. Authenticated realtime delivery and reconnect consistency remain outstanding.
