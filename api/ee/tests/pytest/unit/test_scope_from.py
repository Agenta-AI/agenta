"""Regression net for `scope_from`.

`scope_from` is the public projection helper that produces a
`MeterScope` either from the ambient `AuthScope` (for HTTP-bound
callers) or from an explicit `organization_id` (for bootstrap/worker
code without a request context). The internal `_scope_from` does the
ambient-projection at the granularity declared by `quota.scope`.

These tests pin:
- the exclusivity contract on `scope_from` ("exactly one keyword");
- that ambient projection produces correctly-narrowed MeterScopes at
  each granularity, with finer dims nulled out;
- that `_scope_from(scope=None)` is equivalent to
  `_scope_from(scope=Scope.ORGANIZATION)` (the default fallback that
  fixed the silent fail-open bug).
"""

from uuid import UUID

import pytest

from ee.src.core.entitlements.types import Scope
from ee.src.core.meters.types import MeterScope
from ee.src.utils.entitlements import scope_from, _scope_from
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
    of one test. The ambient-projection branches of `scope_from` /
    `_scope_from` need this."""
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
# Public `scope_from` — exclusivity contract.
# ---------------------------------------------------------------------------


def test_scope_from_org_id_returns_org_only_scope():
    """The explicit-organization-id branch is used by bootstrap code and
    workers that don't have an ambient AuthScope. Should produce an
    org-only MeterScope; every finer dim is None."""
    s = scope_from(organization_id=ORG)
    assert s == MeterScope(organization_id=ORG)
    assert s.workspace_id is None
    assert s.project_id is None
    assert s.user_id is None


def test_scope_from_ambient_org_projection(auth_context):
    """`scope=Scope.ORGANIZATION` projects the ambient AuthScope down to
    just the organization, nulling finer dims."""
    s = scope_from(scope=Scope.ORGANIZATION)
    assert s == MeterScope(organization_id=ORG)


def test_scope_from_rejects_no_source():
    """`scope_from()` requires exactly one source keyword. No source
    means the caller forgot to specify intent — raise loudly."""
    with pytest.raises(ValueError, match="exactly one source keyword"):
        scope_from()


def test_scope_from_rejects_both_sources():
    """Passing both `scope` and `organization_id` is ambiguous —
    raise."""
    with pytest.raises(ValueError, match="exactly one source keyword"):
        scope_from(scope=Scope.ORGANIZATION, organization_id=ORG)


def test_scope_from_rejects_scope_none_explicitly():
    """`scope=None` from the caller is treated as "didn't pass anything"
    — same error path as the no-source case. This is the regression net
    for the silent fail-open bug: `check_entitlements` no longer calls
    `scope_from(scope=None)`; if it did, this test would fail loudly
    instead of bypassing every org-scoped check."""
    with pytest.raises(ValueError, match="exactly one source keyword"):
        scope_from(scope=None)


# ---------------------------------------------------------------------------
# Internal `_scope_from` — ambient projection at every granularity.
# ---------------------------------------------------------------------------


def test_internal_scope_from_none_defaults_to_organization(auth_context):
    """The internal helper accepts `scope=None` and treats it as
    organization-granularity — this is the contract `check_entitlements`
    relies on for its default-quota-scope fallback."""
    s = _scope_from(auth_context.scope, None)
    assert s == MeterScope(organization_id=ORG)


def test_internal_scope_from_workspace(auth_context):
    """Workspace granularity includes org + workspace; project/user nulled."""
    s = _scope_from(auth_context.scope, Scope.WORKSPACE)
    assert s == MeterScope(organization_id=ORG, workspace_id=WS)
    assert s.project_id is None
    assert s.user_id is None


def test_internal_scope_from_project(auth_context):
    """Project granularity adds project; user nulled."""
    s = _scope_from(auth_context.scope, Scope.PROJECT)
    assert s == MeterScope(
        organization_id=ORG,
        workspace_id=WS,
        project_id=PRJ,
    )
    assert s.user_id is None


def test_internal_scope_from_user(auth_context):
    """USER granularity populates every dim."""
    s = _scope_from(auth_context.scope, Scope.USER)
    assert s == MeterScope(
        organization_id=ORG,
        workspace_id=WS,
        project_id=PRJ,
        user_id=USR,
    )


def test_internal_scope_from_none_equals_organization(auth_context):
    """`_scope_from(scope=None)` and `_scope_from(scope=Scope.ORGANIZATION)`
    must produce the same MeterScope. This is the invariant that lets
    `check_entitlements` treat `quota.scope=None` as the org default
    without a special branch."""
    s_none = _scope_from(auth_context.scope, None)
    s_org = _scope_from(auth_context.scope, Scope.ORGANIZATION)
    assert s_none == s_org


# ---------------------------------------------------------------------------
# Granularity narrows progressively — each level is a strict superset of
# the previous one.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "scope, expected_set",
    [
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
    s = _scope_from(auth_context.scope, scope)
    actually_set = {
        name
        for name in ("organization_id", "workspace_id", "project_id", "user_id")
        if getattr(s, name) is not None
    }
    assert actually_set == expected_set
