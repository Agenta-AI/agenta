"""Unit tests for core/events/utils.py.

These cover:
- WebhookEventType / EventType parity for all new events
- Reference extraction and capping
- publish_*_event scope and count short-circuit semantics
- Publish failures are swallowed and never propagate
"""

from types import SimpleNamespace
from typing import Any, List, Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest

from oss.src.core.events.types import EventType
from oss.src.core.events.utils import (
    MAX_REFERENCES,
    REVISION_EVENT_TYPES,
    _Scope,
    build_revision_event_attributes,
    build_testcase_fetched_attributes,
    build_testcase_queried_attributes,
    build_trace_fetched_attributes,
    build_trace_queried_attributes,
    publish_revision_event,
    publish_testcase_fetched,
    publish_testcase_queried,
    publish_trace_fetched,
    publish_trace_queried,
    request_scope,
)
from oss.src.core.webhooks.types import WebhookEventType


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_request(
    *,
    project_id: Optional[Any] = "11111111-1111-1111-1111-111111111111",
    user_id: Optional[Any] = "22222222-2222-2222-2222-222222222222",
    organization_id: Optional[Any] = "33333333-3333-3333-3333-333333333333",
) -> Any:
    state = SimpleNamespace(
        project_id=project_id,
        user_id=user_id,
        organization_id=organization_id,
    )
    return SimpleNamespace(state=state)


def _captured_publishes(captured: List[dict]):
    """Return an async patch target that records publish_event calls."""

    async def _capture(**kwargs):
        captured.append(kwargs)
        return True

    return _capture


def _revision(
    *,
    domain: str,
    revision_id: str,
    artifact_id: Optional[str] = "a-id",
    variant_id: Optional[str] = "v-id",
    artifact_slug: Optional[str] = "a-slug",
    variant_slug: Optional[str] = "v-slug",
    slug: Optional[str] = "v1",
    version: Optional[int] = 1,
) -> Any:
    obj = SimpleNamespace(id=revision_id, slug=slug, version=version)
    if artifact_id is not None:
        setattr(obj, f"{domain}_id", artifact_id)
    if variant_id is not None:
        setattr(obj, f"{domain}_variant_id", variant_id)
    # Parent slugs surface domain-prefixed, with "artifact" dropped:
    # `<domain>_slug` for the artifact, `<domain>_variant_slug` for the variant.
    if artifact_slug is not None:
        setattr(obj, f"{domain}_slug", artifact_slug)
    if variant_slug is not None:
        setattr(obj, f"{domain}_variant_slug", variant_slug)
    return obj


# ---------------------------------------------------------------------------
# EventType <-> WebhookEventType parity
# ---------------------------------------------------------------------------


def test_event_type_includes_all_new_events():
    expected = {
        "traces.fetched",
        "traces.queried",
        "testcases.fetched",
        "testcases.queried",
        "queries.revisions.retrieved",
        "queries.revisions.fetched",
        "queries.revisions.queried",
        "queries.revisions.logged",
        "queries.revisions.committed",
        "testsets.revisions.retrieved",
        "testsets.revisions.fetched",
        "testsets.revisions.queried",
        "testsets.revisions.logged",
        "testsets.revisions.committed",
        "workflows.revisions.retrieved",
        "workflows.revisions.fetched",
        "workflows.revisions.queried",
        "workflows.revisions.logged",
        "workflows.revisions.committed",
        "environments.revisions.retrieved",
        "environments.revisions.fetched",
        "environments.revisions.queried",
        "environments.revisions.logged",
        "environments.revisions.committed",
    }
    actual = {e.value for e in EventType}
    missing = expected - actual
    assert not missing, f"Missing from EventType: {missing}"


def test_webhook_event_type_is_subset_and_includes_all_new_events():
    event_values = {e.value for e in EventType}
    webhook_values = {e.value for e in WebhookEventType}

    # All webhook values must exist in EventType.
    assert webhook_values <= event_values

    # All new event types should also be subscribable.
    new_event_values = {
        v for v in event_values if v.startswith(("traces.", "testcases."))
    } | {v for v in event_values if ".revisions." in v}
    assert new_event_values <= webhook_values


# ---------------------------------------------------------------------------
# Attribute builders
# ---------------------------------------------------------------------------


def test_trace_fetched_attributes_single():
    user = uuid4()
    attrs = build_trace_fetched_attributes(
        user_id=user,
        count=1,
        trace_id="abc",
    )
    assert attrs == {
        "user_id": str(user),
        "count": 1,
        "trace_id": "abc",
    }


def test_trace_fetched_attributes_plural_caps_at_1000():
    """fetched can carry multiple trace_ids when the GET handler returns a list."""
    user = uuid4()
    ids = [f"t-{i}" for i in range(MAX_REFERENCES + 25)]
    attrs = build_trace_fetched_attributes(
        user_id=user,
        count=len(ids),
        trace_ids=ids,
    )
    assert attrs["count"] == MAX_REFERENCES + 25
    assert "trace_id" not in attrs
    assert len(attrs["trace_ids"]) == MAX_REFERENCES


def test_trace_queried_attributes_caps_at_1000():
    user = uuid4()
    ids = [f"t-{i}" for i in range(MAX_REFERENCES + 50)]
    attrs = build_trace_queried_attributes(
        user_id=user,
        count=len(ids),
        trace_ids=ids,
    )
    assert attrs["count"] == MAX_REFERENCES + 50
    assert len(attrs["trace_ids"]) == MAX_REFERENCES


def test_testcase_fetched_attributes_includes_id_only_when_present():
    user = uuid4()
    no_id = build_testcase_fetched_attributes(user_id=user, count=0)
    assert "testcase_id" not in no_id
    assert "testcase_ids" not in no_id

    with_id = build_testcase_fetched_attributes(user_id=user, count=1, testcase_id="t1")
    assert with_id["testcase_id"] == "t1"


def test_testcase_queried_attributes_caps_at_1000():
    user = uuid4()
    ids = list(range(MAX_REFERENCES + 5))
    attrs = build_testcase_queried_attributes(
        user_id=user, count=len(ids), testcase_ids=ids
    )
    assert attrs["count"] == MAX_REFERENCES + 5
    assert len(attrs["testcase_ids"]) == MAX_REFERENCES


# ---------------------------------------------------------------------------
# Revision attribute construction
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "domain,plural",
    [
        ("workflow", "workflows"),
        ("query", "queries"),
        ("testset", "testsets"),
        ("environment", "environments"),
    ],
)
def test_revision_event_types_cover_all_actions(domain, plural):
    for action in ("retrieve", "fetch", "query", "log", "commit"):
        et = REVISION_EVENT_TYPES[domain][action]
        assert (
            et.value
            == f"{plural}.revisions."
            + {
                "retrieve": "retrieved",
                "fetch": "fetched",
                "query": "queried",
                "log": "logged",
                "commit": "committed",
            }[action]
        )


def test_revision_attributes_single():
    user = uuid4()
    rev = _revision(domain="workflow", revision_id="r-1")
    attrs = build_revision_event_attributes(
        domain="workflow",
        action="retrieve",
        user_id=user,
        revision=rev,
    )
    assert attrs["user_id"] == str(user)
    assert attrs["count"] == 1
    refs = attrs["references"]
    assert refs["workflow"] == {"id": "a-id", "slug": "a-slug"}
    assert refs["workflow_variant"] == {"id": "v-id", "slug": "v-slug"}
    assert refs["workflow_revision"] == {
        "id": "r-1",
        "slug": "v1",
        "version": 1,
    }


def test_revision_attributes_partial_identity_omits_missing_fields():
    """Artifact/variant absent → those subsections drop out, but emission proceeds."""
    user = uuid4()
    rev = _revision(
        domain="query",
        revision_id="r-2",
        artifact_id=None,
        variant_id=None,
        artifact_slug=None,
        variant_slug=None,
        slug=None,
        version=None,
    )
    attrs = build_revision_event_attributes(
        domain="query",
        action="fetch",
        user_id=user,
        revision=rev,
    )
    refs = attrs.get("references", {})
    assert "query" not in refs
    assert "query_variant" not in refs
    assert refs["query_revision"] == {"id": "r-2"}


def test_revision_attributes_omits_parent_slug_when_absent():
    """Artifact/variant id present but slug unresolved → emit id without slug."""
    user = uuid4()
    rev = _revision(
        domain="workflow",
        revision_id="r-9",
        artifact_slug=None,
        variant_slug=None,
    )
    attrs = build_revision_event_attributes(
        domain="workflow",
        action="retrieve",
        user_id=user,
        revision=rev,
    )
    refs = attrs["references"]
    assert refs["workflow"] == {"id": "a-id"}
    assert refs["workflow_variant"] == {"id": "v-id"}


def test_revision_attributes_falls_back_to_generic_slug():
    """Raw git-layer revision exposes generic artifact_slug/variant_slug."""
    user = uuid4()
    rev = SimpleNamespace(
        id="r-10",
        slug="v2",
        version=2,
        artifact_id="a-id",
        variant_id="v-id",
        artifact_slug="generic-a",
        variant_slug="generic-v",
    )
    attrs = build_revision_event_attributes(
        domain="workflow",
        action="retrieve",
        user_id=user,
        revision=rev,
    )
    refs = attrs["references"]
    assert refs["workflow"] == {"id": "a-id", "slug": "generic-a"}
    assert refs["workflow_variant"] == {"id": "v-id", "slug": "generic-v"}


def test_revision_attributes_list_caps_references():
    user = uuid4()
    revs = [
        _revision(domain="testset", revision_id=f"r-{i}")
        for i in range(MAX_REFERENCES + 25)
    ]
    attrs = build_revision_event_attributes(
        domain="testset",
        action="query",
        user_id=user,
        revisions=revs,
    )
    assert attrs["count"] == MAX_REFERENCES + 25
    assert len(attrs["references"]) == MAX_REFERENCES


def test_revision_attributes_commit_omits_count_and_includes_message():
    user = uuid4()
    rev = _revision(domain="workflow", revision_id="r-3")
    attrs = build_revision_event_attributes(
        domain="workflow",
        action="commit",
        user_id=user,
        revision=rev,
        message="Promote eval",
    )
    assert "count" not in attrs
    assert attrs["message"] == "Promote eval"


def test_revision_attributes_extra_merges():
    user = uuid4()
    rev = _revision(domain="environment", revision_id="r-4")
    attrs = build_revision_event_attributes(
        domain="environment",
        action="commit",
        user_id=user,
        revision=rev,
        extra={
            "state": {"references": {}},
            "diff": {"created": {}, "updated": {}, "deleted": {}},
        },
    )
    assert attrs["state"] == {"references": {}}
    assert attrs["diff"] == {"created": {}, "updated": {}, "deleted": {}}


# ---------------------------------------------------------------------------
# request_scope
# ---------------------------------------------------------------------------


def test_request_scope_resolves_string_uuids():
    scope = request_scope(_make_request())
    assert isinstance(scope, _Scope)
    assert scope.enabled is True
    assert scope.project_id == UUID("11111111-1111-1111-1111-111111111111")
    assert scope.user_id == UUID("22222222-2222-2222-2222-222222222222")
    assert scope.organization_id == UUID("33333333-3333-3333-3333-333333333333")


def test_request_scope_disabled_when_project_missing():
    scope = request_scope(_make_request(project_id=None))
    assert scope.enabled is False


def test_request_scope_disabled_when_user_missing():
    scope = request_scope(_make_request(user_id=None))
    assert scope.enabled is False


def test_request_scope_tolerates_bad_uuid_strings():
    scope = request_scope(_make_request(project_id="not-a-uuid"))
    assert scope.enabled is False


def test_request_scope_no_state():
    scope = request_scope(SimpleNamespace())
    assert scope.enabled is False


# ---------------------------------------------------------------------------
# AuthScope precedence
# ---------------------------------------------------------------------------


def _set_auth_scope(*, organization_id, workspace_id, project_id, user_id):
    """Set a populated AuthContext on the ContextVar; returns the reset token."""
    from oss.src.utils.context import (
        AuthContext,
        AuthScope,
        ApiKeyCredentials,
        set_auth_context,
    )

    return set_auth_context(
        AuthContext(
            credentials=ApiKeyCredentials(value="test-key"),
            scope=AuthScope(
                organization_id=organization_id,
                workspace_id=workspace_id,
                project_id=project_id,
                user_id=user_id,
            ),
        )
    )


def test_request_scope_prefers_auth_context_over_request_state():
    """When AuthScope is set, it wins over request.state — and carries
    organization_id even when request.state is missing it.
    """
    from oss.src.utils.context import reset_auth_context

    auth_org = uuid4()
    auth_ws = uuid4()
    auth_proj = uuid4()
    auth_user = uuid4()

    token = _set_auth_scope(
        organization_id=auth_org,
        workspace_id=auth_ws,
        project_id=auth_proj,
        user_id=auth_user,
    )
    try:
        # `request.state` carries a different (stale) project_id; AuthScope
        # should be the source of truth.
        scope = request_scope(_make_request())
        assert scope.enabled is True
        assert scope.organization_id == auth_org
        assert scope.workspace_id == auth_ws
        assert scope.project_id == auth_proj
        assert scope.user_id == auth_user
    finally:
        reset_auth_context(token)


def test_request_scope_falls_back_to_state_when_no_auth_context():
    """No AuthContext set → use request.state. (Backward compatible with
    tests that hand-craft `SimpleNamespace` state.)
    """
    scope = request_scope(_make_request())
    assert scope.enabled is True
    # organization_id comes from state in this path.
    assert scope.organization_id == UUID("33333333-3333-3333-3333-333333333333")


# ---------------------------------------------------------------------------
# Publish semantics — counts, scope, and failure containment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_trace_fetched_skips_when_count_zero():
    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_trace_fetched(request=_make_request(), count=0)
    assert captured == []


@pytest.mark.asyncio
async def test_publish_trace_fetched_publishes_when_scope_valid():
    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_trace_fetched(
            request=_make_request(),
            count=1,
            trace_id="trace-xyz",
        )
    assert len(captured) == 1
    msg = captured[0]
    assert msg["project_id"] == UUID("11111111-1111-1111-1111-111111111111")
    assert msg["organization_id"] == UUID("33333333-3333-3333-3333-333333333333")
    event = msg["event"]
    assert event.event_type == EventType.TRACES_FETCHED
    assert event.attributes["trace_id"] == "trace-xyz"
    assert event.attributes["count"] == 1


@pytest.mark.asyncio
async def test_publish_trace_fetched_plural_emits_trace_ids():
    """List GET /traces/ → traces.fetched with capped trace_ids, no trace_id."""
    captured: List[dict] = []
    ids = [f"t-{i}" for i in range(MAX_REFERENCES + 5)]
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_trace_fetched(
            request=_make_request(),
            count=len(ids),
            trace_ids=ids,
        )
    event = captured[0]["event"]
    assert event.event_type == EventType.TRACES_FETCHED
    assert event.attributes["count"] == MAX_REFERENCES + 5
    assert len(event.attributes["trace_ids"]) == MAX_REFERENCES
    assert "trace_id" not in event.attributes


@pytest.mark.asyncio
async def test_publish_testcase_fetched_plural_emits_testcase_ids():
    """List GET /testcases/ → testcases.fetched with capped testcase_ids."""
    captured: List[dict] = []
    ids = [f"tc-{i}" for i in range(MAX_REFERENCES + 3)]
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_testcase_fetched(
            request=_make_request(),
            count=len(ids),
            testcase_ids=ids,
        )
    event = captured[0]["event"]
    assert event.event_type == EventType.TESTCASES_FETCHED
    assert event.attributes["count"] == MAX_REFERENCES + 3
    assert len(event.attributes["testcase_ids"]) == MAX_REFERENCES
    assert "testcase_id" not in event.attributes


@pytest.mark.asyncio
async def test_publish_trace_queried_skips_when_scope_disabled():
    captured: List[dict] = []
    request = _make_request(project_id=None)
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_trace_queried(request=request, count=3, trace_ids=["a", "b", "c"])
    assert captured == []


@pytest.mark.asyncio
async def test_publish_testcase_queried_caps_ids_and_keeps_count():
    captured: List[dict] = []
    ids = [f"t-{i}" for i in range(MAX_REFERENCES + 10)]
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_testcase_queried(
            request=_make_request(),
            count=len(ids),
            testcase_ids=ids,
        )
    event = captured[0]["event"]
    assert event.attributes["count"] == MAX_REFERENCES + 10
    assert len(event.attributes["testcase_ids"]) == MAX_REFERENCES


@pytest.mark.asyncio
async def test_publish_testcase_fetched_zero_count_suppressed():
    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_testcase_fetched(request=_make_request(), count=0)
    assert captured == []


@pytest.mark.asyncio
async def test_publish_revision_event_routes_action_to_event_type():
    captured: List[dict] = []
    rev = _revision(domain="workflow", revision_id="r-1")
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_revision_event(
            request=_make_request(),
            domain="workflow",
            action="retrieve",
            revision=rev,
        )
        await publish_revision_event(
            request=_make_request(),
            domain="workflow",
            action="fetch",
            revision=rev,
        )
        await publish_revision_event(
            request=_make_request(),
            domain="workflow",
            action="commit",
            revision=rev,
            message="Commit changes",
        )
        await publish_revision_event(
            request=_make_request(),
            domain="workflow",
            action="query",
            revisions=[rev],
        )
        await publish_revision_event(
            request=_make_request(),
            domain="workflow",
            action="log",
            revisions=[rev],
        )

    types = [m["event"].event_type for m in captured]
    assert types == [
        EventType.WORKFLOWS_REVISIONS_RETRIEVED,
        EventType.WORKFLOWS_REVISIONS_FETCHED,
        EventType.WORKFLOWS_REVISIONS_COMMITTED,
        EventType.WORKFLOWS_REVISIONS_QUERIED,
        EventType.WORKFLOWS_REVISIONS_LOGGED,
    ]
    # commit event must carry message and skip count
    commit_attrs = captured[2]["event"].attributes
    assert commit_attrs["message"] == "Commit changes"
    assert "count" not in commit_attrs


@pytest.mark.asyncio
async def test_publish_revision_event_zero_revisions_suppresses():
    captured: List[dict] = []
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_revision_event(
            request=_make_request(),
            domain="testset",
            action="query",
            revisions=[],
        )
        await publish_revision_event(
            request=_make_request(),
            domain="testset",
            action="log",
            revisions=[],
        )
        await publish_revision_event(
            request=_make_request(),
            domain="testset",
            action="retrieve",
            revision=None,
        )
        await publish_revision_event(
            request=_make_request(),
            domain="testset",
            action="commit",
            revision=None,
        )
    assert captured == []


@pytest.mark.asyncio
async def test_publish_revision_event_skips_single_when_count_zero():
    """retrieve/fetch/commit must not publish when explicit count <= 0."""
    captured: List[dict] = []
    rev = _revision(domain="workflow", revision_id="r-1")
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        for action in ("retrieve", "fetch", "commit"):
            await publish_revision_event(
                request=_make_request(),
                domain="workflow",
                action=action,
                revision=rev,
                count=0,
            )
    assert captured == []


@pytest.mark.asyncio
async def test_publish_revision_event_accepts_explicit_scope_without_request():
    """Service-layer paths (e.g., environments commit) pass explicit scope."""
    captured: List[dict] = []
    rev = _revision(domain="environment", revision_id="r-5", slug="v3", version=3)
    project_id = uuid4()
    user_id = uuid4()
    with patch(
        "oss.src.core.events.utils.publish_event",
        new=_captured_publishes(captured),
    ):
        await publish_revision_event(
            project_id=project_id,
            user_id=user_id,
            domain="environment",
            action="commit",
            revision=rev,
            message="Promote",
            extra={
                "state": {"references": {}},
                "diff": {"created": {}, "updated": {}, "deleted": {}},
            },
        )
    assert len(captured) == 1
    msg = captured[0]
    assert msg["project_id"] == project_id
    event = msg["event"]
    assert event.event_type == EventType.ENVIRONMENTS_REVISIONS_COMMITTED
    assert event.attributes["state"] == {"references": {}}
    assert event.attributes["message"] == "Promote"


@pytest.mark.asyncio
async def test_publish_failure_is_swallowed():
    async def _raise(**kwargs):
        raise RuntimeError("redis down")

    with patch("oss.src.core.events.utils.publish_event", new=_raise):
        # Must not raise.
        await publish_trace_fetched(
            request=_make_request(),
            count=1,
            trace_id="abc",
        )
        await publish_revision_event(
            request=_make_request(),
            domain="query",
            action="fetch",
            revision=_revision(domain="query", revision_id="r-7"),
        )


# ---------------------------------------------------------------------------
# L1 `Counter.EVENTS_INGESTED` soft check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_l1_quota_soft_check_drops_when_over_quota():
    """L1 over-quota → no publish, no raise (silent drop)."""
    captured: List[dict] = []

    async def _fake_check(**kwargs):
        return False, None, None

    with (
        patch(
            "oss.src.core.events.utils.publish_event",
            new=_captured_publishes(captured),
        ),
        patch("oss.src.core.events.utils.is_ee", return_value=True),
        patch(
            "ee.src.utils.entitlements.check_entitlements", new=_fake_check, create=True
        ),
        patch("ee.src.utils.entitlements.scope_from", new=lambda **kw: kw, create=True),
    ):
        await publish_trace_fetched(
            request=_make_request(),
            count=1,
            trace_id="abc",
        )
    assert captured == []


@pytest.mark.asyncio
async def test_l1_quota_soft_check_allows_under_quota():
    """L1 allowed → publish proceeds."""
    captured: List[dict] = []

    async def _fake_check(**kwargs):
        return True, None, None

    with (
        patch(
            "oss.src.core.events.utils.publish_event",
            new=_captured_publishes(captured),
        ),
        patch("oss.src.core.events.utils.is_ee", return_value=True),
        patch(
            "ee.src.utils.entitlements.check_entitlements", new=_fake_check, create=True
        ),
        patch("ee.src.utils.entitlements.scope_from", new=lambda **kw: kw, create=True),
    ):
        await publish_trace_fetched(
            request=_make_request(),
            count=1,
            trace_id="abc",
        )
    assert len(captured) == 1


@pytest.mark.asyncio
async def test_l1_quota_soft_check_fails_open_on_exception():
    """L1 entitlements glitch → publish still proceeds (fail-open)."""
    captured: List[dict] = []

    async def _fake_check(**kwargs):
        raise RuntimeError("entitlements down")

    with (
        patch(
            "oss.src.core.events.utils.publish_event",
            new=_captured_publishes(captured),
        ),
        patch("oss.src.core.events.utils.is_ee", return_value=True),
        patch(
            "ee.src.utils.entitlements.check_entitlements", new=_fake_check, create=True
        ),
        patch("ee.src.utils.entitlements.scope_from", new=lambda **kw: kw, create=True),
    ):
        await publish_trace_fetched(
            request=_make_request(),
            count=1,
            trace_id="abc",
        )
    assert len(captured) == 1


@pytest.mark.asyncio
async def test_l1_quota_soft_check_skipped_when_org_unknown():
    """No organization_id on scope → skip L1, let L2 handle it."""
    captured: List[dict] = []
    calls: List[dict] = []

    async def _fake_check(**kwargs):
        calls.append(kwargs)
        return True, None, None

    request = _make_request(organization_id=None)
    with (
        patch(
            "oss.src.core.events.utils.publish_event",
            new=_captured_publishes(captured),
        ),
        patch("oss.src.core.events.utils.is_ee", return_value=True),
        patch(
            "ee.src.utils.entitlements.check_entitlements", new=_fake_check, create=True
        ),
        patch("ee.src.utils.entitlements.scope_from", new=lambda **kw: kw, create=True),
    ):
        await publish_trace_fetched(
            request=request,
            count=1,
            trace_id="abc",
        )
    assert len(captured) == 1
    assert calls == []  # L1 was not invoked


@pytest.mark.asyncio
async def test_l1_quota_soft_check_skipped_on_oss():
    """OSS (is_ee()=False) → skip L1 entirely."""
    captured: List[dict] = []
    calls: List[dict] = []

    async def _fake_check(**kwargs):
        calls.append(kwargs)
        return True, None, None

    with (
        patch(
            "oss.src.core.events.utils.publish_event",
            new=_captured_publishes(captured),
        ),
        patch("oss.src.core.events.utils.is_ee", return_value=False),
        patch(
            "ee.src.utils.entitlements.check_entitlements", new=_fake_check, create=True
        ),
        patch("ee.src.utils.entitlements.scope_from", new=lambda **kw: kw, create=True),
    ):
        await publish_trace_fetched(
            request=_make_request(),
            count=1,
            trace_id="abc",
        )
    assert len(captured) == 1
    assert calls == []
