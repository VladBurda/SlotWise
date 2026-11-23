# Implementation roadmap

Work stops at every phase boundary for user approval. A phase can be implemented
but still have explicit blocked verification; never treat a skipped gate as a pass.

Current status (2026-11-22): **Phases 1–5 complete and verified** within the documented
internal booking scope. Availability and backend commits are pushed after agreement;
the booking UI commit remains local. **Phase 6 calendar views are in progress.** See
`PROGRESS.md` for the acceptance evidence and remaining operational limitations.

| Phase | Deliverable | Required gate |
| --- | --- | --- |
| 1 | Monorepo, FastAPI, React shell, Compose, lint/tests/CI, health, design docs | Backend/frontend checks; built images and healthy Compose stack |
| 2 | Registration, sessions, CSRF, email verification/reset, workspaces, memberships, invitations, backend RBAC, login/onboarding | Real-PostgreSQL tenant isolation, token reuse/revocation, permission and CSRF tests |
| 3 | Profile, locations, opening hours, holidays, exceptions, policies and IANA zones | Rule validation and DST boundary tests; settings UI |
| 4 | Staff/skills/availability, resource units/pools, services/requirements | Cross-tenant FK tests, qualification/capacity tests, management forms |
| 5 | Availability, atomic bookings, cancellation, rescheduling, idempotency | Real PostgreSQL race tests; exclusion/guard invariant tests; no SQLite substitution |
| 6 | Calendar standard views, custom staff/resource timelines, filters, drag/resize, authenticated realtime | Backend-validated drag/resize, reconnect synchronization and workspace leakage tests |
| 7 | Mobile public booking, customer history and secure guest management | Full customer flow, privacy, expiry/ownership tests |
| 8 | Celery/Redis, outbox delivery/reminders, email abstraction, expiring waitlist offers | Lease recovery, retries, duplicate dispatch, concurrent offer acceptance tests |
| 9 | OR-Tools recommendations with configurable preferences | Hard constraints preserved, baseline comparison and measured execution time |
| 10 | Precisely defined analytics, Recharts, filters, CSV export | Independent metric fixtures including eligible-time denominators and formula injection defense |
| 11 | Security/accessibility review, reproducible benchmarks, demo seed, screenshots, deployment/release docs | E2E lifecycle, concurrency evidence, restore/deploy checks, documented limitations |

## Phase 1 sequence

1. Inspect existing repository and applicable instructions (empty repository found).
2. Specify module boundaries, relational model, engine contracts and race handling.
3. Build backend configuration, lifespan, health routes and migration bootstrap.
4. Build typed React shell, shared UI primitive, responsive navigation and readiness UI.
5. Add Docker services, locked environments, lint/format/test configuration and CI.
6. Run checks, fix failures, verify live endpoints and Compose where available.
7. Record exact evidence and unresolved gaps in `PROGRESS.md`; await approval.

## Constraints retained across phases

- No real customer data in seed or tests; destructive integration tests use isolated DBs.
- No payment processing. No premium FullCalendar assumption. No mock production flows.
- Business domain tests are pure where possible; database concurrency tests are not.
- Backend authorization remains authoritative for every mutation and subscription.
- Prefer correctness over throughput until measured load justifies finer locking.
- Retention/export/deletion are conscious data-handling designs, not a GDPR claim.
- Proposed demo: deterministic auto-service workspace, two locations, eight staff,
  five bays, three diagnostic devices, twelve services, fifty synthetic customers,
  200+ appointments plus absences/maintenance/cancellations; implement in Phase 11.

## Phase 2 acceptance checklist

All items below passed on 2026-11-20; no acceptance checks were skipped.

- Registration/login/logout, verified email and reset links through local SMTP.
- HttpOnly access/refresh cookies, rotation/reuse revocation, CSRF and rate limiting.
- Workspace creation, multiple memberships, owner-managed invitations and role changes.
- PostgreSQL tests for tenant boundaries, revocation, one-use links and permission checks.
- Real concurrent refresh and last-owner protection tests in isolated schemas.
- Responsive login/onboarding/team UI; authenticated routes and backend enforcement.
- Browser account lifecycle on desktop/mobile using real PostgreSQL, Redis and Mailpit.
- Re-run foundation checks; record evidence before declaring complete; stop before Phase 3.

## Phase 3 acceptance checklist

All items below passed on 2026-11-20 and were reverified on 2026-11-21;
evidence is recorded in `PROGRESS.md`. The continuation also removed location-list
N+1 schedule queries and added a PostgreSQL query-count regression test.

- Owner-editable business profile, contact fields and bounded booking/cancellation policies.
- Multiple locations with independent IANA zones and active/inactive lifecycle.
- Weekly intervals, split days, holidays and date-specific replacement hours.
- Validation for overlap, invalid zones/dates, overnight intervals and policy relationships.
- Pure DST tests for nonexistent/repeated times, elapsed duration and midnight boundaries.
- Tenant-scoped PostgreSQL persistence, composite foreign keys, CSRF/RBAC and stale-write tests.
- Settings UI and saved-hours preview, verified on desktop/mobile against the real stack.
- All previous tests, lint/type checks and builds pass; document evidence and stop before Phase 4.

## Phase 4 acceptance checklist

Completed on 2026-11-21; see `PROGRESS.md` for results and architecture refinements.

- Staff profiles, active state, qualifications/expiry, eligibility and capacity.
- Working hours, breaks, dated overrides and approved leave with location-zone previews.
- Physical resources, attributes, maintenance, stable capacity units and compatible pools.
- Services, variable duration, price, buffers, locations and specific/pool/type requirements.
- Owner/manager management UI with safe reload, validation and configuration checks.
- PostgreSQL tenant/type constraints, atomic/stale updates, capacity and qualification tests.
- Full regression suite: 73 backend, 23 frontend and 12 desktop/mobile browser tests.
- Production build, lint/types, migration consistency, health and SMTP checks passed.
- Stop before Phase 5 and wait for agreement before pushing the local Phase 4 commit.

## Phase 5 milestones

- Implemented: deterministic availability engine and owner/manager API, joint resource
  allocation, hours/buffers/qualifications/policies, timezone and capacity tests.
- Implemented: appointment/allocation migration, PostgreSQL exclusion constraints,
  transactional revalidation, idempotency, cancellation/rescheduling and race tests.
- Implemented: responsive booking UI and full-stack create/reload/reschedule/cancel flow.
- Final verification: 100 backend, 27 frontend and 12 desktop/mobile browser checks passed.
- Phase 6 calendar views are next; Phase 5 retains the documented conservative config
  guard and internal owner/manager scope. Notification dispatch belongs to Phase 8.
- New commits remain local pending agreement to push.

## Phase 6 milestones

- Implemented: read-only day/week/month/agenda views, local timezone labels, overnight
  grouping, location/staff/resource/status filters, details dialog and bounded range API.
- Implemented: daily staff/resource timelines, overlapping lanes, buffered spans,
  quantities, historical assignments and DST-aware elapsed-time axes.
- Implemented: same-staff timeline move/resize proposals, keyboard and details-button
  alternatives, confirmation and versioned transactional rescheduling with safe retries.
- Next: authenticated realtime delivery, workspace isolation and reconnect consistency.
- Phase 6 remains incomplete until those behaviors and their verification are delivered.
