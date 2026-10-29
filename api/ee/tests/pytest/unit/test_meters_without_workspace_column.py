"""The meters ORM maps no workspace column (workspace removal dropped it), so no select
of a meter row names it."""

from sqlalchemy import select

from ee.src.dbs.postgres.meters.dbes import MeterDBE


def test_meter_rows_map_no_workspace_column():
    assert "workspace_id" not in MeterDBE.__table__.columns
    assert "workspace_id" not in str(select(MeterDBE))
