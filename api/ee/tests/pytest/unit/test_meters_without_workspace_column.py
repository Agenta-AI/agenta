"""Workspace removal step 2b: the meters ORM no longer maps `meters.workspace_id`, so no
select of a meter row names the column that step 3 drops."""

from sqlalchemy import select

from ee.src.dbs.postgres.meters.dbes import MeterDBE


def test_meter_rows_map_no_workspace_column():
    assert "workspace_id" not in MeterDBE.__table__.columns
    assert "workspace_id" not in str(select(MeterDBE))
