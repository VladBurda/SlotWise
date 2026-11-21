# Scheduling engine and concurrency design

Booking-engine design specification; implementation starts in Phase 5. Phase 3
implements civil operating-time expansion and its DST tests, not booking feasibility.
No booking correctness or performance claim is made.

## Domain contracts

Use immutable dataclasses and UUIDs; all timestamps passed to the engine are aware
UTC instants. Reject naive datetimes at the API boundary. Proposed signatures:

```python
@dataclass(frozen=True)
class SlotRequest:
    service_id: UUID
    location_id: UUID
    from_utc: datetime
    until_utc: datetime
    duration_minutes: int
    preferred_employee_id: UUID | None = None

@dataclass(frozen=True)
class FeasibleSlot:
    starts_at: datetime
    ends_at: datetime
    employee_id: UUID
    unit_ids: tuple[UUID, ...]

def feasible_slots(snapshot: SchedulingSnapshot, request: SlotRequest,
                   now: datetime) -> tuple[FeasibleSlot, ...]: ...

class AvailabilityService(Protocol):
    async def get_available_slots(self, tenant: TenantContext,
                                  request: SlotRequest) -> AvailabilityResult: ...

class BookingService(Protocol):
    async def create_booking(self, tenant: TenantContext, principal: Principal,
                             command: BookAppointment,
                             idempotency_key: str) -> BookingReceipt: ...

class OptimizationService(Protocol):
    def recommend_slots(self, feasible: tuple[FeasibleSlot, ...],
                        preferences: Preferences, weights: ObjectiveWeights,
                        deadline_ms: int) -> RankedSlots: ...
```

These are documentation interfaces, not runtime stubs. `SchedulingSnapshot` includes
service revisions, qualified employees, resource units, openings, schedules, breaks,
absence/maintenance intervals, booking policies, and existing occupied ranges.
Public slots expose an opaque selection reference, not internal resource identifiers.
Availability carries `computed_at` and does not imply a hold.

## Deterministic feasibility

1. Validate duration range/increment, location, policy horizon and minimum notice.
2. Expand opening and staff recurrence rules in each location's IANA zone. Dated
   closures override recurrence; approved exceptions replace the day's rules.
3. Generate candidate instants on a configured grid, then compute UTC end and buffers.
4. Intersect openings, employee schedules and resource windows. Subtract breaks,
   leave, maintenance, existing blocking reservations, and policy exclusions.
5. Filter employees by all required skills and explicit eligibility. Match each
   requirement to location-compatible pools/types/specific resources. Enumerate
   combinations with pruning and ensure one unit cannot satisfy two demands.
6. Require the entire buffered interval to fit every assigned unit's availability.
7. Return deterministic candidates ordered by UTC start then stable assignment IDs.

Ambiguous fall-back local times produce distinct UTC instants labeled with offsets.
Nonexistent spring-forward times are rejected by round-tripping through UTC, never
silently normalized. Service elapsed duration is measured in UTC. Opening rules are
local civil times; their converted interval can have a different elapsed duration on
DST days. Tests must cover Europe/Berlin transitions and cross-location time zones.

Phase 3's operating-hours expansion in `business/calendar.py` keeps a repeated-hour
opening continuous from earliest start to latest end. A nonexistent recurring
boundary closes the preview date with an explicit issue; special hours can repair
the date. Dated special boundaries in a gap are rejected on save. The future slot
generator must enumerate distinct candidate instants within these opening intervals;
an opening interval is not itself a candidate appointment or a reservation.

## Locking protocol (correctness-first baseline)

All scheduling writes, including configuration edits, acquire a workspace scheduling
guard by `SELECT ... FOR UPDATE` on the workspace row. This intentionally serializes
booking/configuration writes within a workspace. It prevents write skew from concurrent
leave, service requirement, pool membership, and opening-hour changes. Other workspaces
remain independent. Measure contention before replacing it with finer locks.

Order for every writer:

1. Begin PostgreSQL READ COMMITTED transaction; resolve authenticated membership.
2. Lock workspace scheduling guard and recheck active workspace/membership.
3. Claim or read workspace/principal/idempotency key. Compare canonical request digest.
   A matching committed request returns its original receipt, including after later
   cancellation; a mismatched payload yields 409. Rollback releases a failed claim.
4. Lock relevant appointment/offer rows in UUID order, then resource-unit rows in UUID
   order. Re-read current configuration and occupancy after acquiring locks.
5. Resolve combinations and recompute feasibility server-side. Never trust the UI's
   availability cache, supplied employee eligibility, or slot recommendation.
6. Insert appointment, blocking allocation rows, history, audit, idempotent result,
   and outbox event. Exclusion constraint protects every unit and buffer interval.
7. Commit before returning confirmation. No network notification calls inside the lock.

All config writers participate in the guard. Capacity reduction, maintenance and leave
changes that conflict with committed bookings return conflicts for explicit resolution.
Cross-workspace moves are forbidden; cross-location rescheduling within a workspace
uses the same guard. Rescheduling locks the booking, checks its version, replaces the
allocations atomically, and rolls back entirely on failure, retaining the original slot.

Catch SQLSTATE `23P01` (exclusion conflict) and expected unique conflicts with precise
domain responses. For `40P01` deadlock or `40001` serialization failure, retry the entire
transaction at most three times with bounded jitter and the same idempotency key.
Never swallow other database exceptions. Lock timeouts return a retryable busy error,
not a confirmed booking. Keep transactions short and instrument wait duration.

## Lifecycle, waitlist, and outbox

Planned transitions: confirmed → checked_in → completed; confirmed/checked_in →
cancelled with permission; confirmed → no_show after a policy cutoff. Version checks
protect stale edits. Customer cancellation/rescheduling obey ownership and cutoff.

Offers are invitations to claim, not reservations. Rank eligible waitlist entries by
priority tier then request creation time, with deterministic UUID tie-break. Document
business-adjustable fairness policy. On claim, lock guard and offer, verify recipient,
expiry and pending state, then use the normal booking transaction and mark accepted.
Two competing claims cannot both reserve an exclusive unit. Expiry uses server time.

Outbox insertion is atomic with the booking. Workers claim due events with
`FOR UPDATE SKIP LOCKED`, bounded leases and retries/backoff; delivery deduplication
uses a stable key. Redis dispatch can be retried from the database. External SMTP cannot
guarantee exactly-once delivery after an ambiguous send/ack crash; use provider
idempotency when available and document at-least-once SMTP behavior. WebSocket events
carry workspace, object ID and version, not private contact payloads.

## Optimization and evidence

OR-Tools receives only feasible candidates, with hard no-overlap/unit capacity rules.
Weights score idle gaps, workload dispersion, switching and preference satisfaction.
Bound solver time, report status/duration/objective, and fall back to deterministic
ranking on timeout. Every suggested booking is revalidated transactionally.

Phase 5 tests use real PostgreSQL and synchronized concurrent clients: one exclusive
slot, capacity C with C+1 contenders, overlapping resource sets, idempotent retries,
cancel versus reschedule, offer claims, and configuration changes racing bookings.
Assert committed row counts and all allocation invariants, not only HTTP status codes.
Benchmarks later record hardware, database version, seed, dataset, warm-up, concurrency,
p50/p95 and failures. No benchmark or concurrency results exist in Phase 1.

Interview summary: “We serialize scheduling writes per workspace, lock assignments
in a stable order, and revalidate inside one PostgreSQL transaction. Each capacity unit
has a buffered time-range exclusion constraint. The appointment, allocations and outbox
commit together; idempotency makes retries safe. We can optimize locking granularity
after measuring contention without removing the database invariant.”
