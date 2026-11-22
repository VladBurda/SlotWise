# SlotWise progress

Updated: 2026-11-21 (Europe/Berlin).

## Current status

**Phases 1–4 are complete and pushed. Phase 5 availability milestone is implemented.**
Phase 5 remains in progress; new commits stay local pending agreement to push.
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
