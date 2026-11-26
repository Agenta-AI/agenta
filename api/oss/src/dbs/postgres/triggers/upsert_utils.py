from datetime import datetime, timezone
from typing import Any

from sqlalchemy import literal, select
from sqlalchemy.dialects.postgresql import Insert, insert
from sqlalchemy.sql.elements import ClauseElement
from sqlalchemy.sql.selectable import CTE

from oss.src.core.triggers.dtos import TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE
from oss.src.dbs.postgres.triggers.dbes import TriggerDeliveryDBE


def build_trigger_delivery_values(
    source: TriggerDeliveryDBE | dict[str, Any],
) -> dict[str, Any]:
    """Build the column->value mapping used for TriggerDelivery upserts.

    Accepts either a DBE instance (with attributes) or a plain dict and filters
    to the actual table columns.
    """
    column_names = {c.name for c in TriggerDeliveryDBE.__table__.columns}
    forbidden_none_columns = {"id", "created_at", "updated_at", "deleted_at"}

    result: dict[str, Any] = {}

    if isinstance(source, dict):
        for k, v in source.items():
            if k not in column_names:
                continue
            if k in forbidden_none_columns and v is None:
                continue
            result[k] = v
        return result

    for col in TriggerDeliveryDBE.__table__.columns:
        name = col.name
        value = getattr(source, name, None)
        if name in forbidden_none_columns and value is None:
            continue
        result[name] = value

    return result


def build_trigger_delivery_conflict(
    by_schedule: bool,
) -> tuple[list[str], ClauseElement]:
    """Return the `index_elements` list and `index_where` ClauseElement for
    TriggerDelivery upserts.

    The DAOs used two parallel definitions (schedule vs subscription). Keep the
    same semantics here so callers can rely on identical conflict-targets.
    """
    if by_schedule:
        return [
            "project_id",
            "schedule_id",
            "event_id",
        ], TriggerDeliveryDBE.schedule_id.isnot(None)
    return [
        "project_id",
        "subscription_id",
        "event_id",
    ], TriggerDeliveryDBE.subscription_id.isnot(None)


def build_trigger_delivery_claim(
    values: dict[str, Any],
    *,
    by_schedule: bool,
    live_parent: CTE,
) -> Insert:
    """The claim of one delivery: insert `values` only when `live_parent` (a CTE that
    selects the live, active schedule or subscription, locked) has a row, on the
    dedup key of `build_trigger_delivery_conflict`.

    Retry re-claim (P1-8): a delivery stuck in the one retryable terminal state (500,
    the runner was unreachable, not a permanent rejection) can be re-claimed by a
    fresh attempt. Any other existing row (still claimed, or a terminal non-retryable
    status) fails the WHERE and is left untouched, the same outcome DO NOTHING gave
    for every case except this one. `dedup_seen` gates on the same status check so a
    retry reaches this claim instead of short-circuiting before it.

    Callers add their own RETURNING."""
    index_elements, index_where = build_trigger_delivery_conflict(by_schedule)
    columns = list(values)
    delivery_insert = insert(TriggerDeliveryDBE).from_select(
        columns,
        select(
            *(
                literal(
                    values[column],
                    type_=TriggerDeliveryDBE.__table__.c[column].type,
                )
                for column in columns
            )
        ).select_from(live_parent),
    )
    return delivery_insert.on_conflict_do_update(
        index_elements=index_elements,
        index_where=index_where,
        where=TriggerDeliveryDBE.status["code"].astext
        == TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE,
        set_={
            "id": delivery_insert.excluded.id,
            "created_by_id": delivery_insert.excluded.created_by_id,
            "status": delivery_insert.excluded.status,
            "data": delivery_insert.excluded.data,
            "updated_at": datetime.now(timezone.utc),
        },
    )
