from typing import Any

from sqlalchemy.sql.elements import ClauseElement

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
