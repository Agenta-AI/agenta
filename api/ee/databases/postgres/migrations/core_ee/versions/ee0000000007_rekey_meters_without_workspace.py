"""re-key meter rows without the workspace part

Workspace removal step 2 (design.md D7): a meter is scoped by organization, project and
user. Every row that still carries a workspace gets the id `compute_meter_id` gives
without it, and rows that land on the same id are folded by adding `value` and `synced`,
so every count and the unreported delta (`value - synced`) stay exact. Rows without a
workspace (every organization-scope meter, so every billed meter) are not touched and keep
their ids. Today only the per-user `TRACES_RETRIEVED` rows carry a workspace.

How:
1. Refuse (before any write) when a row has a workspace and no project (no quota writes
   that shape, and it has no step-2 identity), or when a row with a workspace has a key
   the usage report sends to Stripe (no quota writes that either: billed meters are
   organization-scope).
2. Hold the `meters:report` Redis lock (the one the usage report takes) for the whole
   run, so no report reads rows while they move. An active report is waited for (poll
   every 5 s, up to 15 min); then the revision fails before any write.
3. Walk the rows with a workspace once in `meter_id` order (keyset, batches of 1000),
   compute the new ids in Python with the runtime `compute_meter_id` (the repository's
   trust model for meter ids, as `9d3e8f0a1b2c`), and move each batch in ONE statement:
   delete the old rows, group them by new id, insert with `ON CONFLICT DO UPDATE` adding
   `value` and `synced`. Every batch is its own transaction (autocommit block) with
   `lock_timeout = 2s` and `statement_timeout = 60s`.

Why billed meters must never move: a report that outlives its lock (a batch stalled past
the lock TTL) or a step-1 report (plain bump, no compare-and-set) can still bump an old id
after the move, and a step-1 adjust can recreate that id; the bump would then mark part
of the recreated row as synced. Only `synced` of a moved key can be wrong that way, and a
moved key is never reported (refused above), so no Stripe delta and no quota changes.

Mixed versions: a step-1 pod that adjusts an old row while its batch moves waits for the
row lock, then inserts a new row under its old id (a straggler). Step-2 code never reads
it as the current row (`workspace_id IS NULL` filter), the report bumps it by its stored
id, and the step 2b release folds it. Idempotent: a rerun finds no row with a workspace.
With no row to move, the revision takes no lock and needs no Redis.

One-way: old ids are gone and folded rows cannot be split. `downgrade()` does nothing;
restore the pre-release dump of `meters` to undo it. The migration gate reports no
finding (data-only statements).

Revision ID: ee0000000007
Revises: ee0000000006
Create Date: 2026-10-25 00:00:00.000000
"""

import time
from typing import Callable, Optional, Sequence, Union
from uuid import UUID, uuid4

from alembic import op
from sqlalchemy import text

revision: str = "ee0000000007"
down_revision: Union[str, None] = "ee0000000006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BATCH_SIZE = 1000
REPORT_LOCK_TTL = 3600  # the report's own TTL (billing router)
REPORT_LOCK_WAIT_S = 15 * 60
REPORT_LOCK_POLL_S = 5

_SCOPE = (
    "(CAST(:orgs AS uuid[]) IS NULL OR organization_id = ANY(CAST(:orgs AS uuid[])))"
)

_REFUSE_SQL = f"""
SELECT meter_id FROM meters
WHERE workspace_id IS NOT NULL AND project_id IS NULL AND {_SCOPE}
LIMIT 1
"""

_REFUSE_REPORTED_SQL = f"""
SELECT meter_id FROM meters
WHERE workspace_id IS NOT NULL AND key::text = ANY(CAST(:keys AS text[])) AND {_SCOPE}
LIMIT 1
"""

_ANY_ROW_SQL = f"""
SELECT 1 FROM meters WHERE workspace_id IS NOT NULL AND {_SCOPE} LIMIT 1
"""

_PAGE_SQL = f"""
SELECT meter_id, organization_id, project_id, user_id, key::text AS key, year, month, day
FROM meters
WHERE workspace_id IS NOT NULL AND {_SCOPE}
  AND (CAST(:after AS uuid) IS NULL OR meter_id > CAST(:after AS uuid))
ORDER BY meter_id
LIMIT :limit
"""

# One statement per batch: move the rows (row locks only), fold the ones that land on the
# same new id, and add into a row that already has it.
_MOVE_SQL = """
WITH m AS (
    SELECT * FROM unnest(CAST(:old AS uuid[]), CAST(:new AS uuid[])) AS t(old_id, new_id)
), moved AS (
    DELETE FROM meters USING m
    WHERE meters.meter_id = m.old_id AND meters.workspace_id IS NOT NULL
    RETURNING m.new_id, meters.organization_id, meters.project_id, meters.user_id,
              meters.key, meters.year, meters.month, meters.day, meters.value,
              meters.synced, meters.created_at, meters.updated_at,
              meters.created_by_id, meters.updated_by_id
), agg AS (
    SELECT new_id, organization_id, project_id, user_id, key, year, month, day,
           sum(value)::bigint AS value, sum(synced)::bigint AS synced,
           min(created_at) AS created_at, max(updated_at) AS updated_at,
           min(created_by_id::text)::uuid AS created_by_id,
           max(updated_by_id::text)::uuid AS updated_by_id
    FROM moved
    GROUP BY new_id, organization_id, project_id, user_id, key, year, month, day
)
INSERT INTO meters (meter_id, organization_id, workspace_id, project_id, user_id, key,
                    year, month, day, value, synced, created_at, updated_at,
                    created_by_id, updated_by_id)
SELECT new_id, organization_id, NULL, project_id, user_id, key, year, month, day,
       value, synced, created_at, updated_at, created_by_id, updated_by_id
FROM agg
ON CONFLICT (meter_id) DO UPDATE
SET value = meters.value + EXCLUDED.value,
    synced = meters.synced + EXCLUDED.synced,
    updated_at = now()
"""


class RekeyRefused(RuntimeError):
    pass


class ReportLockBusy(RuntimeError):
    pass


def new_meter_id(row) -> UUID:
    """The step-2 id of a row: `compute_meter_id` without the workspace part."""

    from ee.src.core.meters.types import (  # noqa: PLC0415
        MeterPeriod,
        MeterScope,
        Meters,
        compute_meter_id,
    )

    # `key::text` is the Postgres enum label (member name); `compute_meter_id` hashes the
    # member value (`TRACES_RETRIEVED` -> `traces_retrieved`), as `9d3e8f0a1b2c` does.
    return compute_meter_id(
        scope=MeterScope(
            organization_id=row.organization_id,
            project_id=row.project_id,
            user_id=row.user_id,
        ),
        period=MeterPeriod(year=row.year, month=row.month, day=row.day),
        key=Meters[row.key].value,
    )


def move_batch(bind, rows) -> int:
    """Move one batch of rows to their new ids, in one statement. Returns the rows moved."""

    old = [row.meter_id for row in rows]
    new = [new_meter_id(row) for row in rows]
    result = bind.execute(text(_MOVE_SQL), {"old": old, "new": new})
    return int(result.rowcount or 0)


def rekey(
    bind,
    *,
    batch_size: int = BATCH_SIZE,
    organization_ids: Optional[Sequence[UUID]] = None,
    after_batch: Optional[Callable[[int], None]] = None,
) -> dict:
    """Walk every row with a workspace once and move it. `bind` runs each statement in
    its own transaction (autocommit). `organization_ids` limits the walk (tests)."""

    orgs = sorted(organization_ids) if organization_ids is not None else None
    after = None
    batches = moved = rows_seen = 0
    while True:
        rows = bind.execute(
            text(_PAGE_SQL), {"orgs": orgs, "after": after, "limit": batch_size}
        ).fetchall()
        if not rows:
            break
        moved += move_batch(bind, rows)
        rows_seen += len(rows)
        batches += 1
        after = rows[-1].meter_id
        if after_batch is not None:
            after_batch(batches)
    return {"batches": batches, "rows": rows_seen, "inserted_or_folded": moved}


def _reported_key_labels() -> list:
    """The enum labels of the keys the usage report sends to Stripe."""

    from ee.src.core.access.entitlements.types import REPORTS  # noqa: PLC0415
    from ee.src.core.meters.types import Meters  # noqa: PLC0415

    return sorted(member.name for member in Meters if member.value in REPORTS)


def refuse_unsupported_rows(bind, organization_ids=None) -> None:
    orgs = sorted(organization_ids) if organization_ids is not None else None
    row = bind.execute(text(_REFUSE_SQL), {"orgs": orgs}).first()
    if row is not None:
        raise RekeyRefused(
            f"meter {row.meter_id} has a workspace and no project; it has no step-2 "
            "identity. Fix or delete such rows, then rerun."
        )
    row = bind.execute(
        text(_REFUSE_REPORTED_SQL), {"orgs": orgs, "keys": _reported_key_labels()}
    ).first()
    if row is not None:
        raise RekeyRefused(
            f"meter {row.meter_id} has a workspace and a key the usage report bills; "
            "billed meters are organization-scope. Fix such rows, then rerun."
        )


def has_rows_to_move(bind, organization_ids=None) -> bool:
    orgs = sorted(organization_ids) if organization_ids is not None else None
    return bind.execute(text(_ANY_ROW_SQL), {"orgs": orgs}).first() is not None


# --- the usage report's Redis lock ------------------------------------------- #

_RENEW_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
end
return 0
"""

_RELEASE_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
"""


def report_lock_key() -> str:
    """The key `acquire_lock(namespace="meters:report", key={})` takes."""

    from oss.src.utils.caching import _pack  # noqa: PLC0415

    return _pack(namespace="lock:meters:report", key={})


def _redis_client():
    from redis import Redis  # noqa: PLC0415

    from oss.src.utils.env import env  # noqa: PLC0415

    return Redis.from_url(url=env.redis.uri_volatile, socket_timeout=30)


class ReportLock:
    """The usage report's lock, held by this revision (sync client: a migration)."""

    def __init__(
        self,
        client=None,
        *,
        wait_s: float = REPORT_LOCK_WAIT_S,
        poll_s: float = REPORT_LOCK_POLL_S,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._client = client
        self._wait_s = wait_s
        self._poll_s = poll_s
        self._sleep = sleep
        self._clock = clock
        self._key = report_lock_key()
        self._owner = uuid4().hex

    @property
    def client(self):
        if self._client is None:
            self._client = _redis_client()
        return self._client

    def acquire(self) -> None:
        deadline = self._clock() + self._wait_s
        while True:
            if self.client.set(self._key, self._owner, nx=True, ex=REPORT_LOCK_TTL):
                print("[ee007] holding the meters:report lock")
                return
            if self._clock() >= deadline:
                raise ReportLockBusy(
                    "the usage report still runs after "
                    f"{int(self._wait_s)} s; no row was changed. Rerun the migration."
                )
            print("[ee007] waiting for the usage report to finish")
            self._sleep(self._poll_s)

    def renew(self) -> None:
        if not self.client.eval(
            _RENEW_SCRIPT, 1, self._key, self._owner, str(REPORT_LOCK_TTL)
        ):
            raise ReportLockBusy("lost the meters:report lock during the re-key")

    def release(self) -> None:
        self.client.eval(_RELEASE_SCRIPT, 1, self._key, self._owner)


def run(bind, *, lock: Optional[ReportLock] = None, **kwargs) -> dict:
    """The whole revision on an autocommit `bind`."""

    organization_ids = kwargs.get("organization_ids")
    refuse_unsupported_rows(bind, organization_ids)
    if not has_rows_to_move(bind, organization_ids):
        print("[ee007] no meter row has a workspace; nothing to do")
        return {"batches": 0, "rows": 0, "inserted_or_folded": 0}

    lock = lock or ReportLock()
    lock.acquire()
    try:
        counts = rekey(bind, after_batch=lambda _: lock.renew(), **kwargs)
    finally:
        lock.release()
    print(f"[ee007] totals {counts}")
    return counts


def upgrade() -> None:
    with op.get_context().autocommit_block():
        connection = op.get_bind()
        connection.execute(text("SET lock_timeout = '2s'"))
        connection.execute(text("SET statement_timeout = '60s'"))
        try:
            run(connection)
        finally:
            connection.execute(text("RESET lock_timeout"))
            connection.execute(text("RESET statement_timeout"))


def downgrade() -> None:
    """One-way data change: the old ids are gone and folded rows cannot be split.
    Restore the pre-release dump of `meters` to undo it."""
