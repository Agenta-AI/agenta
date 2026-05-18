"""Regression net for `scope_from`.

`scope_from` is the single public projection helper. Two modes:

  - Ambient: projects the ambient `AuthScope` (auth ContextVar) at the
    granularity declared by `scope`. `scope=None` (or omitted) means
    `Scope.ORGANIZATION` — the common case where `quota.scope=None`
    flows through unchanged.
  - Explicit: `organization_id=UUID(...)` builds an org-only `MeterScope`
    without ambient lookup (bootstrap and worker code).

These tests pin:
- the exclusivity contract on `scope_from` (both args together raises);
- that ambient projection produces correctly-narrowed MeterScopes at
  each granularity, with finer dims nulled out;
- that `scope_from(scope=None)` is equivalent to
  `scope_from(scope=Scope.ORGANIZATION)` — i.e., `quota.scope=None`
  flows through to the org-default without a special branch at the
  call site.
"""

from uuid import UUID

import pytest

from ee.src.core.entitlements.types import Scope
from ee.src.core.meters.types import MeterScope
from ee.src.utils.entitlements import scope_from
from oss.src.utils.context import (
    AuthScope,
    AuthContext,
    set_auth_context,
    reset_auth_context,
    ApiKeyCredentials,
)


ORG = UUID("a1111111-1111-1111-1111-111111111111")
WS = UUID("b2222222-2222-2222-2222-222222222222")
PRJ = UUID("c3333333-3333-3333-3333-333333333333")
USR = UUID("d4444444-4444-4444-4444-444444444444")


@pytest.fixture
def auth_context():
    """Set a fully-populated AuthScope on the ContextVar for the duration
    of one test. The ambient-projection branches of `scope_from` need
    this."""
    ctx = AuthContext(
        credentials=ApiKeyCredentials(value="test-token"),
        scope=AuthScope(
            organization_id=ORG,
            workspace_id=WS,
            project_id=PRJ,
            user_id=USR,
        ),
    )
    token = set_auth_context(ctx)
    try:
        yield ctx
    finally:
        reset_auth_context(token)


# ---------------------------------------------------------------------------
# Explicit org-id mode — no ambient lookup.
# ---------------------------------------------------------------------------


def test_scope_from_org_id_returns_org_only_scope():
    """The explicit-organization-id branch is used by bootstrap code and
    workers that don't have an ambient AuthScope. Produces an org-only
    MeterScope; every finer dim is None."""
    s = scope_from(organization_id=ORG)
    assert s == MeterScope(organization_id=ORG)
    assert s.workspace_id is None
    assert s.project_id is None
    assert s.user_id is None


def test_scope_from_rejects_both_sources():
    """Passing both `scope` and `organization_id` is ambiguous — raises."""
    with pytest.raises(ValueError, match="does not accept both"):
        scope_from(scope=Scope.ORGANIZATION, organization_id=ORG)


# ---------------------------------------------------------------------------
# Ambient mode — projects the ContextVar AuthScope at each granularity.
# ---------------------------------------------------------------------------


def test_scope_from_no_args_defaults_to_ambient_organization(auth_context):
    """`scope_from()` with no kwargs uses the ambient AuthScope at
    organization granularity. This is the common path for handlers and
    `check_entitlements` when `quota.scope=None`."""
    s = scope_from()
    assert s == MeterScope(organization_id=ORG)


def test_scope_from_none_scope_is_ambient_organization(auth_context):
    """`scope_from(scope=None)` is equivalent to
    `scope_from(scope=Scope.ORGANIZATION)` and to `scope_from()`. This
    is the invariant that lets `check_entitlements` and `/billing/usage`
    pass `quota.scope` through unchanged without a special branch."""
    assert scope_from(scope=None) == scope_from(scope=Scope.ORGANIZATION)
    assert scope_from(scope=None) == scope_from()


def test_scope_from_ambient_org_projection(auth_context):
    """`scope=Scope.ORGANIZATION` projects the ambient AuthScope down to
    just the organization, nulling finer dims."""
    s = scope_from(scope=Scope.ORGANIZATION)
    assert s == MeterScope(organization_id=ORG)


def test_scope_from_ambient_workspace(auth_context):
    """Workspace granularity includes org + workspace; project/user nulled."""
    s = scope_from(scope=Scope.WORKSPACE)
    assert s == MeterScope(organization_id=ORG, workspace_id=WS)
    assert s.project_id is None
    assert s.user_id is None


def test_scope_from_ambient_project(auth_context):
    """Project granularity adds project; user nulled."""
    s = scope_from(scope=Scope.PROJECT)
    assert s == MeterScope(
        organization_id=ORG,
        workspace_id=WS,
        project_id=PRJ,
    )
    assert s.user_id is None


def test_scope_from_ambient_user(auth_context):
    """USER granularity populates every dim."""
    s = scope_from(scope=Scope.USER)
    assert s == MeterScope(
        organization_id=ORG,
        workspace_id=WS,
        project_id=PRJ,
        user_id=USR,
    )


# ---------------------------------------------------------------------------
# Granularity narrows progressively — each level is a strict superset of
# the previous one.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "scope, expected_set",
    [
        (None, {"organization_id"}),
        (Scope.ORGANIZATION, {"organization_id"}),
        (Scope.WORKSPACE, {"organization_id", "workspace_id"}),
        (Scope.PROJECT, {"organization_id", "workspace_id", "project_id"}),
        (
            Scope.USER,
            {"organization_id", "workspace_id", "project_id", "user_id"},
        ),
    ],
)
def test_scope_granularity_populates_expected_dims(auth_context, scope, expected_set):
    """Each scope kind must populate exactly the fields its granularity
    implies — finer dims stay None so the canonicalizer drops them and
    the meter row identity matches the declared granularity."""
    s = scope_from(scope=scope)
    actually_set = {
        name
        for name in ("organization_id", "workspace_id", "project_id", "user_id")
        if getattr(s, name) is not None
    }
    assert actually_set == expected_set
