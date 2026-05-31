"""Shared event-construction and publish utilities.

These utilities build `Event` objects and publish them through
`publish_event(...)` for the new read/commit event families:

- traces.fetched, traces.queried
- testcases.fetched, testcases.queried
- <domain>.revisions.{retrieved,fetched,queried,logged,committed}

============================================================================
WHERE TO EMIT — CANONICAL POLICY (read this before adding a new call site)
============================================================================

The emission point is *intentionally asymmetric* between read actions and
write actions.

  read action   →  emit at the **router** (after the response is materialized)
  write action  →  emit at the **service** (at the operation's seam, e.g.
                   inside `commit_*_revision`)

Currently in scope:

  read actions:  retrieve, fetch, query, log
  write actions: commit
                 (future writes — archive, unarchive, etc. — should follow
                  the same service-layer rule when they are instrumented)

### Why reads emit from the ROUTER layer

  publish_trace_fetched / publish_trace_queried
  publish_testcase_fetched / publish_testcase_queried
  publish_revision_event(action="retrieve" | "fetch" | "query" | "log")

Service methods like `fetch_query_revision`, `fetch_application_revision`,
`fetch_evaluator_revision`, `fetch_environment_revision`, and the matching
`query_*_revisions` are called both:

  1. directly by router handlers (user-initiated read — should emit)
  2. internally by other services to resolve refs / hydrate state
     (NOT user-initiated — must NOT emit)

Examples of (2) that would produce spurious events if reads emitted in the
service layer:

  - `EnvironmentsService.commit_environment_revision` calls
    `self.query_environment_revisions` to compute the diff. Every commit
    would also fire `environments.revisions.queried`.
  - `TracingService.query_traces` calls `queries_service.fetch_query_revision`
    to resolve the saved query. Every trace query that uses a saved query
    would falsely fire `queries.revisions.fetched`.
  - Evaluation runs call `fetch_query_revision`, `fetch_application_revision`,
    `fetch_evaluator_revision` many times per scenario. One evaluation
    request would produce hundreds of stray `*.revisions.fetched` events.

Keeping read emission at the router boundary keeps the event about API
retrieval — not low-level helper activity — and avoids double counting
nested service calls.

### Why writes emit from the SERVICE layer

  publish_revision_event(action="commit", project_id=..., user_id=..., ...)

  Service-layer commit sites (one per domain):
    - core/applications/service.py::commit_application_revision
    - core/queries/service.py::commit_query_revision
    - core/testsets/service.py::commit_testset_revision
    - core/evaluators/service.py::commit_evaluator_revision
    - core/environments/service.py::commit_environment_revision

A write action is *always* a deliberate user-initiated state transition.
There is no "internal write happening as a side effect of a read" pattern
in this codebase. Every caller of `commit_*_revision()` — direct commit
route, simple-service create/edit, deploy paths, fork, defaults seeding —
is a real commit that should emit exactly one event.

If write emission lived at the router, the simple-service create/edit
paths and the deploy paths (which call commit through the service without
hitting `/<domain>/revisions/commit`) would silently miss the event.

### Adding a new call site

When adding a new domain or call site, follow this split. If you find a new
internal caller of a read method, you do nothing — internal callers are
already silent by virtue of where emission lives. If you find a new external
path that lands in `commit_*_revision`, you do nothing — service-layer
emission already covers it.

For a new write action (e.g. `archive_*_revision`), emit from the service
method, not the router.

============================================================================

Behavior:

- Build the `Event` envelope with a generated `request_id`/`event_id`,
  `RequestType.UNKNOWN`, and the supplied event type.
- Skip publishing when `count == 0` for read/query/log events, or when the
  commit revision is missing.
- Skip publishing when the request has no usable `project_id` and `user_id`
  in scope (no caller-side None-checks required).
- Cap event-specific reference lists at `MAX_REFERENCES` while keeping the
  uncapped `count`.
- Always include `user_id` in `attributes`.
- Always include `count` for read/query/log events.
- Treat all references as partial identity objects — fields are included only
  when the DTO exposes them.
- Log publish failures and never raise.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence
from uuid import UUID

import uuid_utils.compat as uuid_compat

from oss.src.core.events.dtos import Event
from oss.src.core.events.streaming import publish_event
from oss.src.core.events.types import EventType, RequestType
from oss.src.utils.common import is_ee
from oss.src.utils.context import AuthContextMissing, get_auth_scope
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


# Cap event-specific reference lists at 1000. `count` stays uncapped.
MAX_REFERENCES = 1000


# --- request scope --------------------------------------------------------- #


class _Scope:
    """Resolved scope for event publication.

    Carries the fullest scope available at emit time so downstream
    consumers (L1 / L2 entitlements, retention flush, future workspace-
    granularity reporting) never have to re-resolve identity from a
    `project_id`. `AuthScope` always populates all four UUIDs when set,
    and `request.state` populates them on authenticated requests.

    `enabled` is True only when the scope carries at minimum a usable
    `project_id` and `user_id`. Callers should pass scope to a publish
    helper unconditionally — the helper short-circuits when not enabled.
    """

    __slots__ = (
        "organization_id",
        "workspace_id",
        "project_id",
        "user_id",
        "enabled",
    )

    def __init__(
        self,
        *,
        organization_id: Optional[UUID],
        workspace_id: Optional[UUID] = None,
        project_id: Optional[UUID],
        user_id: Optional[UUID],
    ) -> None:
        self.organization_id = organization_id
        self.workspace_id = workspace_id
        self.project_id = project_id
        self.user_id = user_id
        self.enabled = project_id is not None and user_id is not None


def _parse_uuid(value: Any) -> Optional[UUID]:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _scope_from_auth_context() -> Optional[_Scope]:
    """Resolve scope from the ambient `AuthScope` ContextVar.

    Returns `None` when no auth context is set (admin/Access endpoints,
    public endpoints, background tasks without explicit setup). Returns
    a populated `_Scope` otherwise — `AuthScope` always carries all four
    UUIDs (organization, workspace, project, user) when present.
    """
    try:
        auth_scope = get_auth_scope()
    except AuthContextMissing:
        return None
    return _Scope(
        organization_id=auth_scope.organization_id,
        workspace_id=auth_scope.workspace_id,
        project_id=auth_scope.project_id,
        user_id=auth_scope.user_id,
    )


def request_scope(request: Any) -> _Scope:
    """Resolve scope for event publication.

    Prefers the ambient `AuthScope` (set by the auth middleware on every
    authenticated tenant request and propagated through nested async
    work) because it always carries `organization_id`. Falls back to
    `request.state` so unit tests that hand-craft a `SimpleNamespace`
    `state` still work, and so that publish call sites that legitimately
    run outside an auth context (none today) keep their current behavior.

    Returns a `_Scope` whose `enabled` flag is True only when project_id
    and user_id are usable. Callers do not need to None-check fields.
    """
    auth_scope = _scope_from_auth_context()
    if auth_scope is not None and auth_scope.enabled:
        return auth_scope

    state = getattr(request, "state", None)
    if state is None:
        return auth_scope or _Scope(organization_id=None, project_id=None, user_id=None)

    return _Scope(
        organization_id=_parse_uuid(getattr(state, "organization_id", None)),
        workspace_id=_parse_uuid(getattr(state, "workspace_id", None)),
        project_id=_parse_uuid(getattr(state, "project_id", None)),
        user_id=_parse_uuid(getattr(state, "user_id", None)),
    )


# --- low-level helpers ----------------------------------------------------- #


def _build_event(
    *,
    event_type: EventType,
    attributes: Dict[str, Any],
) -> Event:
    return Event(
        request_id=uuid_compat.uuid7(),
        event_id=uuid_compat.uuid7(),
        request_type=RequestType.UNKNOWN,
        event_type=event_type,
        timestamp=datetime.now(timezone.utc),
        attributes=attributes,
    )


async def _check_l1_events_quota(
    *,
    organization_id: Optional[UUID],
    event_type_value: str,
) -> bool:
    """L1 soft check for `Counter.EVENTS_INGESTED` at the publish boundary.

    Returns True when the event is allowed (over-quota orgs return False
    and the caller drops the publish silently — no HTTP error). Mirrors
    the `cache=True` soft-check pattern used by `Counter.TRACES_INGESTED`
    at trace-ingest call sites, but never raises so the caller's response
    is unaffected by an entitlements glitch.

    No-ops on OSS (no EE entitlements stack) and when `organization_id`
    is unknown (cannot scope the check). Authoritative consumption
    happens in the events worker's L2 check.
    """
    if not is_ee():
        return True

    if organization_id is None:
        # Without an org we cannot scope the soft check. The events worker
        # still gets a chance to perform the authoritative L2 check using
        # whichever scope the envelope (or DB lookup) provides.
        return True

    try:
        # Deferred import: EE-only symbols stay out of the OSS import graph.
        from ee.src.utils.entitlements import (  # noqa: PLC0415
            check_entitlements,
            scope_from,
        )
        from ee.src.core.entitlements.types import Counter  # noqa: PLC0415

        allowed, _, _ = await check_entitlements(
            key=Counter.EVENTS_INGESTED,
            delta=1,
            cache=True,
            scope=scope_from(organization_id=organization_id),
        )
        return bool(allowed)
    except Exception:  # pylint: disable=broad-exception-caught
        # Fail open — a meter glitch must never block the caller. The L2
        # authoritative check in the worker is the source of truth.
        log.warning(
            "[EVENTS] L1 quota soft-check failed for %s; failing open",
            event_type_value,
            exc_info=True,
        )
        return True


async def _safe_publish(
    *,
    organization_id: Optional[UUID],
    project_id: UUID,
    event: Event,
) -> None:
    """Publish an event, swallowing failures after logging.

    The caller's HTTP response must not be affected by publish failures.
    Runs the L1 `Counter.EVENTS_INGESTED` soft check first; over-quota
    orgs drop the event silently. The authoritative L2 check + adjust
    runs in `EventsWorker.process_batch`.
    """
    allowed = await _check_l1_events_quota(
        organization_id=organization_id,
        event_type_value=event.event_type.value,
    )
    if not allowed:
        log.info(
            "[EVENTS] L1 quota exceeded, dropping %s",
            event.event_type.value,
        )
        return

    try:
        await publish_event(
            organization_id=organization_id,
            project_id=project_id,
            event=event,
        )
    except Exception as exc:  # pragma: no cover - defensive
        log.error(
            "[EVENTS] Failed to publish %s: %s",
            event.event_type.value,
            exc,
            exc_info=True,
        )


def _str_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


# --- trace events ---------------------------------------------------------- #


def build_trace_fetched_attributes(
    *,
    user_id: UUID,
    count: int,
    trace_id: Optional[str] = None,
    trace_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    attributes: Dict[str, Any] = {
        "user_id": str(user_id),
        "count": count,
    }
    if trace_id is not None:
        attributes["trace_id"] = str(trace_id)
    if trace_ids is not None:
        attributes["trace_ids"] = [str(t) for t in list(trace_ids)[:MAX_REFERENCES]]
    return attributes


def build_trace_queried_attributes(
    *,
    user_id: UUID,
    count: int,
    trace_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    attributes: Dict[str, Any] = {
        "user_id": str(user_id),
        "count": count,
    }
    if trace_ids is not None:
        attributes["trace_ids"] = [str(t) for t in list(trace_ids)[:MAX_REFERENCES]]
    return attributes


async def publish_trace_fetched(
    *,
    request: Any,
    count: int,
    trace_id: Optional[str] = None,
    trace_ids: Optional[Sequence[str]] = None,
) -> None:
    if count <= 0:
        return
    scope = request_scope(request)
    if not scope.enabled:
        return
    attributes = build_trace_fetched_attributes(
        user_id=scope.user_id,  # type: ignore[arg-type]
        count=count,
        trace_id=trace_id,
        trace_ids=trace_ids,
    )
    await _safe_publish(
        organization_id=scope.organization_id,
        project_id=scope.project_id,  # type: ignore[arg-type]
        event=_build_event(
            event_type=EventType.TRACES_FETCHED,
            attributes=attributes,
        ),
    )


async def publish_trace_queried(
    *,
    request: Any,
    count: int,
    trace_ids: Optional[Sequence[str]] = None,
) -> None:
    if count <= 0:
        return
    scope = request_scope(request)
    if not scope.enabled:
        return
    attributes = build_trace_queried_attributes(
        user_id=scope.user_id,  # type: ignore[arg-type]
        count=count,
        trace_ids=trace_ids,
    )
    await _safe_publish(
        organization_id=scope.organization_id,
        project_id=scope.project_id,  # type: ignore[arg-type]
        event=_build_event(
            event_type=EventType.TRACES_QUERIED,
            attributes=attributes,
        ),
    )


# --- testcase events ------------------------------------------------------- #


def build_testcase_fetched_attributes(
    *,
    user_id: UUID,
    count: int,
    testcase_id: Optional[Any] = None,
    testcase_ids: Optional[Sequence[Any]] = None,
) -> Dict[str, Any]:
    attributes: Dict[str, Any] = {
        "user_id": str(user_id),
        "count": count,
    }
    if testcase_id is not None:
        attributes["testcase_id"] = str(testcase_id)
    if testcase_ids is not None:
        attributes["testcase_ids"] = [
            str(t) for t in list(testcase_ids)[:MAX_REFERENCES]
        ]
    return attributes


def build_testcase_queried_attributes(
    *,
    user_id: UUID,
    count: int,
    testcase_ids: Optional[Sequence[Any]] = None,
) -> Dict[str, Any]:
    attributes: Dict[str, Any] = {
        "user_id": str(user_id),
        "count": count,
    }
    if testcase_ids is not None:
        attributes["testcase_ids"] = [
            str(t) for t in list(testcase_ids)[:MAX_REFERENCES]
        ]
    return attributes


async def publish_testcase_fetched(
    *,
    request: Any,
    count: int,
    testcase_id: Optional[Any] = None,
    testcase_ids: Optional[Sequence[Any]] = None,
) -> None:
    if count <= 0:
        return
    scope = request_scope(request)
    if not scope.enabled:
        return
    attributes = build_testcase_fetched_attributes(
        user_id=scope.user_id,  # type: ignore[arg-type]
        count=count,
        testcase_id=testcase_id,
        testcase_ids=testcase_ids,
    )
    await _safe_publish(
        organization_id=scope.organization_id,
        project_id=scope.project_id,  # type: ignore[arg-type]
        event=_build_event(
            event_type=EventType.TESTCASES_FETCHED,
            attributes=attributes,
        ),
    )


async def publish_testcase_queried(
    *,
    request: Any,
    count: int,
    testcase_ids: Optional[Sequence[Any]] = None,
) -> None:
    if count <= 0:
        return
    scope = request_scope(request)
    if not scope.enabled:
        return
    attributes = build_testcase_queried_attributes(
        user_id=scope.user_id,  # type: ignore[arg-type]
        count=count,
        testcase_ids=testcase_ids,
    )
    await _safe_publish(
        organization_id=scope.organization_id,
        project_id=scope.project_id,  # type: ignore[arg-type]
        event=_build_event(
            event_type=EventType.TESTCASES_QUERIED,
            attributes=attributes,
        ),
    )


# --- revision events ------------------------------------------------------- #


REVISION_EVENT_TYPES: Dict[str, Dict[str, EventType]] = {
    # "application" commented out — applications emit as "workflow" events
    # "application": {
    #     "retrieve": EventType.APPLICATIONS_REVISIONS_RETRIEVED,
    #     "fetch": EventType.APPLICATIONS_REVISIONS_FETCHED,
    #     "query": EventType.APPLICATIONS_REVISIONS_QUERIED,
    #     "log": EventType.APPLICATIONS_REVISIONS_LOGGED,
    #     "commit": EventType.APPLICATIONS_REVISIONS_COMMITTED,
    # },
    "query": {
        "retrieve": EventType.QUERIES_REVISIONS_RETRIEVED,
        "fetch": EventType.QUERIES_REVISIONS_FETCHED,
        "query": EventType.QUERIES_REVISIONS_QUERIED,
        "log": EventType.QUERIES_REVISIONS_LOGGED,
        "commit": EventType.QUERIES_REVISIONS_COMMITTED,
    },
    "testset": {
        "retrieve": EventType.TESTSETS_REVISIONS_RETRIEVED,
        "fetch": EventType.TESTSETS_REVISIONS_FETCHED,
        "query": EventType.TESTSETS_REVISIONS_QUERIED,
        "log": EventType.TESTSETS_REVISIONS_LOGGED,
        "commit": EventType.TESTSETS_REVISIONS_COMMITTED,
    },
    # "evaluator" commented out — evaluators emit as "workflow" events
    # "evaluator": {
    #     "retrieve": EventType.EVALUATORS_REVISIONS_RETRIEVED,
    #     "fetch": EventType.EVALUATORS_REVISIONS_FETCHED,
    #     "query": EventType.EVALUATORS_REVISIONS_QUERIED,
    #     "log": EventType.EVALUATORS_REVISIONS_LOGGED,
    #     "commit": EventType.EVALUATORS_REVISIONS_COMMITTED,
    # },
    "environment": {
        "retrieve": EventType.ENVIRONMENTS_REVISIONS_RETRIEVED,
        "fetch": EventType.ENVIRONMENTS_REVISIONS_FETCHED,
        "query": EventType.ENVIRONMENTS_REVISIONS_QUERIED,
        "log": EventType.ENVIRONMENTS_REVISIONS_LOGGED,
        "commit": EventType.ENVIRONMENTS_REVISIONS_COMMITTED,
    },
    "workflow": {
        "retrieve": EventType.WORKFLOWS_REVISIONS_RETRIEVED,
        "fetch": EventType.WORKFLOWS_REVISIONS_FETCHED,
        "query": EventType.WORKFLOWS_REVISIONS_QUERIED,
        "log": EventType.WORKFLOWS_REVISIONS_LOGGED,
        "commit": EventType.WORKFLOWS_REVISIONS_COMMITTED,
    },
}


def _extract_revision_reference(
    *,
    domain: str,
    revision: Any,
) -> Dict[str, Dict[str, Any]]:
    """Build a partial identity object for a single revision.

    `domain` is `"workflow"`, `"query"`, `"testset"`, or `"environment"`.
    The returned dict uses keys like:

        {
            "<domain>": {"id": "...", "slug": "..."},
            "<domain>_variant": {"id": "...", "slug": "..."},
            "<domain>_revision": {"id": "...", "slug": "...", "version": ...},
        }

    Missing fields are omitted; missing artifact or variant subsections are
    omitted entirely. The artifact/variant `slug`s come from the revision's
    parent entities (resolved by the DAO); at the domain layer the artifact
    slug surfaces as `<domain>_slug` and the variant slug as
    `<domain>_variant_slug`, falling back to the generic `artifact_slug` /
    `variant_slug` for raw git-layer revisions.
    """
    artifact_id = _str_or_none(getattr(revision, f"{domain}_id", None)) or _str_or_none(
        getattr(revision, "artifact_id", None)
    )
    variant_id = _str_or_none(
        getattr(revision, f"{domain}_variant_id", None)
    ) or _str_or_none(getattr(revision, "variant_id", None))
    artifact_slug = getattr(revision, f"{domain}_slug", None) or getattr(
        revision, "artifact_slug", None
    )
    variant_slug = getattr(revision, f"{domain}_variant_slug", None) or getattr(
        revision, "variant_slug", None
    )
    revision_id = _str_or_none(getattr(revision, "id", None))
    revision_slug = getattr(revision, "slug", None)
    revision_version = getattr(revision, "version", None)

    references: Dict[str, Dict[str, Any]] = {}

    if artifact_id is not None:
        references[domain] = {"id": artifact_id}
        if artifact_slug is not None:
            references[domain]["slug"] = artifact_slug

    if variant_id is not None:
        references[f"{domain}_variant"] = {"id": variant_id}
        if variant_slug is not None:
            references[f"{domain}_variant"]["slug"] = variant_slug

    revision_block: Dict[str, Any] = {}
    if revision_id is not None:
        revision_block["id"] = revision_id
    if revision_slug is not None:
        revision_block["slug"] = revision_slug
    if revision_version is not None:
        revision_block["version"] = revision_version

    if revision_block:
        references[f"{domain}_revision"] = revision_block

    return references


def _extract_revision_references_list(
    *,
    domain: str,
    revisions: Iterable[Any],
) -> List[Dict[str, Dict[str, Any]]]:
    refs: List[Dict[str, Dict[str, Any]]] = []
    for idx, revision in enumerate(revisions):
        if idx >= MAX_REFERENCES:
            break
        refs.append(_extract_revision_reference(domain=domain, revision=revision))
    return refs


def build_revision_event_attributes(
    *,
    domain: str,
    action: str,
    user_id: UUID,
    revision: Optional[Any] = None,
    revisions: Optional[Sequence[Any]] = None,
    count: Optional[int] = None,
    message: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build event attributes for a revision event.

    For single-revision events (retrieve, fetch, commit) pass `revision`.
    For multi-revision events (query, log) pass `revisions`.
    `count` defaults to 1 for single events and `len(revisions)` for list
    events when not given explicitly. Commit events omit `count`.
    """
    attributes: Dict[str, Any] = {
        "user_id": str(user_id),
    }

    if revisions is not None:
        revisions_list = list(revisions)
        attributes["count"] = count if count is not None else len(revisions_list)
        references = _extract_revision_references_list(
            domain=domain,
            revisions=revisions_list,
        )
        if references:
            attributes["references"] = references
    else:
        if revision is not None:
            references = _extract_revision_reference(
                domain=domain,
                revision=revision,
            )
            if references:
                attributes["references"] = references
        if action != "commit":
            attributes["count"] = count if count is not None else (1 if revision else 0)

    if message:
        attributes["message"] = message

    if extra:
        attributes.update(extra)

    return attributes


async def publish_revision_event(
    *,
    request: Any = None,
    organization_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    user_id: Optional[UUID] = None,
    #
    domain: str,
    action: str,
    revision: Optional[Any] = None,
    revisions: Optional[Sequence[Any]] = None,
    count: Optional[int] = None,
    message: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Build and publish a revision event for the given domain/action.

    EMISSION-LAYER RULE (see module docstring for the full rationale):

      read action  (retrieve/fetch/query/log)  →  call from the ROUTER
      write action (commit, future writes)     →  call from the SERVICE
        (inside the domain's commit_*_revision method)

    Read calls pass `request`; write calls pass explicit `project_id` /
    `user_id` (since service-layer code does not have a `Request` object). Do
    not call this helper from a service method for a read action — internal
    lookups happen all the time and would produce duplicate/spurious events.

    Scope resolution order:
      1. explicit kwargs (`organization_id` / `project_id` / `user_id`),
      2. the ambient `AuthScope` (set by the auth middleware on every
         authenticated tenant request and propagated through nested async
         work — this is how service-layer commits pick up `organization_id`),
      3. `request.state` (legacy fallback for tests that hand-craft a state).

    Skips publishing when scope cannot be resolved (no `project_id` /
    `user_id`), or when the action's payload is empty:
    - single-shape action (retrieve/fetch/commit): no revision returned, or
      explicit count <= 0
    - list-shape (query/log) action: empty result list
    """
    # Resolve organization_id from the ambient AuthScope when not explicitly
    # passed in. Service-layer commits do not have a `request`, but the auth
    # middleware has already set the AuthScope ContextVar for the originating
    # HTTP request, and ContextVars propagate through nested async work.
    if organization_id is None:
        auth_scope = _scope_from_auth_context()
        if auth_scope is not None:
            organization_id = auth_scope.organization_id
            project_id = project_id or auth_scope.project_id
            user_id = user_id or auth_scope.user_id

    if request is not None:
        scope = request_scope(request)
        if not scope.enabled:
            return
        # `request_scope` already prefers AuthScope; only override fields
        # that were not explicitly passed in.
        organization_id = organization_id or scope.organization_id
        project_id = project_id or scope.project_id
        user_id = user_id or scope.user_id

    if project_id is None or user_id is None:
        return

    event_type = REVISION_EVENT_TYPES[domain][action]

    if action in {"query", "log"}:
        list_count = (
            count
            if count is not None
            else (len(list(revisions)) if revisions is not None else 0)
        )
        if list_count <= 0:
            return
    elif action in {"retrieve", "fetch", "commit"}:
        if revision is None:
            return
        if count is not None and count <= 0:
            return

    attributes = build_revision_event_attributes(
        domain=domain,
        action=action,
        user_id=user_id,
        revision=revision,
        revisions=revisions,
        count=count,
        message=message,
        extra=extra,
    )

    await _safe_publish(
        organization_id=organization_id,
        project_id=project_id,
        event=_build_event(
            event_type=event_type,
            attributes=attributes,
        ),
    )


__all__ = [
    "MAX_REFERENCES",
    "REVISION_EVENT_TYPES",
    "build_trace_fetched_attributes",
    "build_trace_queried_attributes",
    "build_testcase_fetched_attributes",
    "build_testcase_queried_attributes",
    "build_revision_event_attributes",
    "publish_trace_fetched",
    "publish_trace_queried",
    "publish_testcase_fetched",
    "publish_testcase_queried",
    "publish_revision_event",
    "request_scope",
]
