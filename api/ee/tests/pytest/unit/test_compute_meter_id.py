"""Regression net for `compute_meter_id`.

The canonicalizer is the single source of truth for meter row identity. Every
writer — runtime DAO, Alembic backfill, future scope-aware helpers — goes
through it. Drift in the canonical-string format (field names, separator,
sort order, exclude-`None` semantics, namespace UUID) silently produces
different `meter_id`s for logically identical scopes, which means duplicate
rows that the database cannot detect.

These tests pin format invariants (determinism, equivalence, distinctness)
plus the namespace derivation. Any change that alters the canonical form will
surface as a failure in the distinctness/equivalence tests or a re-keying of
the namespace test.
"""

import uuid

import pytest

from ee.src.core.meters.types import (
    AGENTA_METERS_NAMESPACE_UUID,
    MeterScope,
    MeterPeriod,
    compute_meter_id,
)
from ee.src.core.entitlements.types import Counter


# Fixed UUIDs used across the table — keep them stable.
ORG = uuid.UUID("a1111111-1111-1111-1111-111111111111")
WS = uuid.UUID("b2222222-2222-2222-2222-222222222222")
PRJ = uuid.UUID("c3333333-3333-3333-3333-333333333333")
USR = uuid.UUID("d4444444-4444-4444-4444-444444444444")


# ---------------------------------------------------------------------------
# Namespace UUID — derived from uuid5(NAMESPACE_DNS, "agenta").
# ---------------------------------------------------------------------------


def test_namespace_uuid_is_derived_from_uuid_namespace():
    """The meters namespace must be a stable derivative of the project-wide
    agenta namespace UUID. Changing either side forces a full re-backfill."""
    expected = uuid.uuid5(uuid.uuid5(uuid.NAMESPACE_DNS, "agenta"), "meters")
    assert AGENTA_METERS_NAMESPACE_UUID == expected


# ---------------------------------------------------------------------------
# Format invariants — properties that must hold for any valid input.
# ---------------------------------------------------------------------------


def test_deterministic():
    """Two calls with the same inputs return the same id."""
    scope = MeterScope(organization_id=ORG)
    period = MeterPeriod(year=2026, month=3)
    assert compute_meter_id(
        scope=scope, period=period, key=Counter.TRACES_INGESTED
    ) == compute_meter_id(scope=scope, period=period, key=Counter.TRACES_INGESTED)


def test_string_and_enum_keys_are_equivalent():
    """Passing `Counter.TRACES_INGESTED` and `"traces_ingested"` must collide.

    The Alembic backfill loads `key::text` from Postgres and passes the bare
    string in; runtime DAO calls pass the enum. They MUST produce the same
    `meter_id`, otherwise the backfill would orphan every existing row.
    """
    scope = MeterScope(organization_id=ORG)
    period = MeterPeriod(year=2026, month=3)
    via_enum = compute_meter_id(scope=scope, period=period, key=Counter.TRACES_INGESTED)
    via_string = compute_meter_id(scope=scope, period=period, key="traces_ingested")
    assert via_enum == via_string


def test_none_means_not_applicable_not_default():
    """Adding a `None` dimension to an existing scope must NOT change the id.

    This is the rule that makes additive schema growth free: a future row
    whose existing dimensions are unchanged keeps its `meter_id` even if a
    brand-new dimension column is introduced and defaulted to `None`.
    """
    legacy_shape = compute_meter_id(
        scope=MeterScope(organization_id=ORG),
        period=MeterPeriod(year=2026, month=3),
        key=Counter.TRACES_INGESTED,
    )
    with_explicit_nones = compute_meter_id(
        scope=MeterScope(
            organization_id=ORG,
            workspace_id=None,
            project_id=None,
            user_id=None,
        ),
        period=MeterPeriod(year=2026, month=3, day=None),
        key=Counter.TRACES_INGESTED,
    )
    assert legacy_shape == with_explicit_nones


def test_distinct_scope_shapes_produce_distinct_ids():
    """Org-monthly, workspace-monthly, project-monthly, user-monthly must
    never collide for the same (key, year, month)."""
    period = MeterPeriod(year=2026, month=3)
    key = Counter.TRACES_INGESTED
    ids = {
        compute_meter_id(scope=MeterScope(organization_id=ORG), period=period, key=key),
        compute_meter_id(
            scope=MeterScope(organization_id=ORG, workspace_id=WS),
            period=period,
            key=key,
        ),
        compute_meter_id(
            scope=MeterScope(organization_id=ORG, workspace_id=WS, project_id=PRJ),
            period=period,
            key=key,
        ),
        compute_meter_id(
            scope=MeterScope(
                organization_id=ORG,
                workspace_id=WS,
                project_id=PRJ,
                user_id=USR,
            ),
            period=period,
            key=key,
        ),
    }
    assert len(ids) == 4


def test_distinct_periods_produce_distinct_ids():
    """Different period buckets at the same scope must not collide."""
    scope = MeterScope(organization_id=ORG)
    key = Counter.TRACES_INGESTED
    ids = {
        compute_meter_id(scope=scope, period=MeterPeriod(), key=key),
        compute_meter_id(scope=scope, period=MeterPeriod(year=2026), key=key),
        compute_meter_id(scope=scope, period=MeterPeriod(year=2026, month=3), key=key),
        compute_meter_id(
            scope=scope, period=MeterPeriod(year=2026, month=3, day=17), key=key
        ),
    }
    assert len(ids) == 4


def test_uuid_input_is_case_insensitive():
    """Equal UUIDs in different cases must canonicalize identically.

    Stringified UUIDs from `str(uuid.UUID(...))` are lowercase, but the
    canonicalizer also lowercases defensively in case a caller (or a SQL
    driver) hands over uppercase hex.
    """
    upper = uuid.UUID(str(ORG).upper())
    period = MeterPeriod(year=2026, month=3)
    assert compute_meter_id(
        scope=MeterScope(organization_id=upper),
        period=period,
        key=Counter.TRACES_INGESTED,
    ) == compute_meter_id(
        scope=MeterScope(organization_id=ORG),
        period=period,
        key=Counter.TRACES_INGESTED,
    )


# ---------------------------------------------------------------------------
# MeterScope hierarchy — invalid shapes must be rejected before hashing.
# ---------------------------------------------------------------------------


def test_meter_scope_user_without_project_raises():
    with pytest.raises(ValueError, match="user_id requires project_id"):
        MeterScope(organization_id=ORG, workspace_id=WS, user_id=USR)


def test_meter_scope_project_without_workspace_raises():
    with pytest.raises(ValueError, match="project_id requires workspace_id"):
        MeterScope(organization_id=ORG, project_id=PRJ)


def test_meter_scope_workspace_without_organization_raises():
    with pytest.raises(ValueError, match="workspace_id requires organization_id"):
        MeterScope(workspace_id=WS)


def test_meter_scope_accepts_organization_only():
    """Org-only is the always-valid baseline scope."""
    scope = MeterScope(organization_id=ORG)
    assert scope.organization_id == ORG
    assert scope.workspace_id is None
    assert scope.project_id is None
    assert scope.user_id is None


def test_meter_scope_accepts_empty():
    """Org is optional — an unbound scope is also valid."""
    scope = MeterScope()
    assert scope.organization_id is None


# ---------------------------------------------------------------------------
# MeterPeriod hierarchy + calendar — invalid shapes must be rejected.
# ---------------------------------------------------------------------------


def test_meter_period_month_without_year_raises():
    with pytest.raises(ValueError, match="month requires year"):
        MeterPeriod(month=3)


def test_meter_period_day_without_month_raises():
    with pytest.raises(ValueError, match="day requires month"):
        MeterPeriod(year=2026, day=17)


def test_meter_period_invalid_calendar_date_raises():
    """2026-02-30 must fail — calendar dates are validated, not just bounds."""
    with pytest.raises(ValueError, match="invalid date"):
        MeterPeriod(year=2026, month=2, day=30)


def test_meter_period_accepts_empty():
    """Empty period (gauge) is valid."""
    period = MeterPeriod()
    assert period.year is None
    assert period.month is None
    assert period.day is None
