"""Shared event-construction and publish utilities.

These utilities build `Event` objects and publish them through
`publish_event(...)` for the new read/commit event families:

- traces.fetched, traces.queried
- testcases.fetched, testcases.queried
- <domain>.revisions.{retrieved,fetched,queried,logged,committed}

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
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


# Cap event-specific reference lists at 1000. `count` stays uncapped.
MAX_REFERENCES = 1000


# --- request scope --------------------------------------------------------- #


class _Scope:
    """Resolved request scope for event publication.

    `enabled` is True only when the request carried at minimum a usable
    `project_id` and `user_id`. Callers should pass scope to a publish
    helper unconditionally — the helper short-circuits when not enabled.
    """

    __slots__ = ("organization_id", "project_id", "user_id", "enabled")

    def __init__(
        self,
        *,
        organization_id: Optional[UUID],
        project_id: Optional[UUID],
        user_id: Optional[UUID],
    ) -> None:
        self.organization_id = organization_id
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


def request_scope(request: Any) -> _Scope:
    """Extract organization_id, project_id, user_id UUIDs from request.state.

    Returns a `_Scope` whose `enabled` flag is True only when project_id and
    user_id are usable. Callers do not need to None-check fields.
    """
    state = getattr(request, "state", None)
    if state is None:
        return _Scope(organization_id=None, project_id=None, user_id=None)

    return _Scope(
        organization_id=_parse_uuid(getattr(state, "organization_id", None)),
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


async def _safe_publish(
    *,
    organization_id: Optional[UUID],
    project_id: UUID,
    event: Event,
) -> None:
    """Publish an event, swallowing failures after logging.

    The caller's HTTP response must not be affected by publish failures.
    """
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
    "application": {
        "retrieve": EventType.APPLICATIONS_REVISIONS_RETRIEVED,
        "fetch": EventType.APPLICATIONS_REVISIONS_FETCHED,
        "query": EventType.APPLICATIONS_REVISIONS_QUERIED,
        "log": EventType.APPLICATIONS_REVISIONS_LOGGED,
        "commit": EventType.APPLICATIONS_REVISIONS_COMMITTED,
    },
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
    "evaluator": {
        "retrieve": EventType.EVALUATORS_REVISIONS_RETRIEVED,
        "fetch": EventType.EVALUATORS_REVISIONS_FETCHED,
        "query": EventType.EVALUATORS_REVISIONS_QUERIED,
        "log": EventType.EVALUATORS_REVISIONS_LOGGED,
        "commit": EventType.EVALUATORS_REVISIONS_COMMITTED,
    },
    "environment": {
        "retrieve": EventType.ENVIRONMENTS_REVISIONS_RETRIEVED,
        "fetch": EventType.ENVIRONMENTS_REVISIONS_FETCHED,
        "query": EventType.ENVIRONMENTS_REVISIONS_QUERIED,
        "log": EventType.ENVIRONMENTS_REVISIONS_LOGGED,
        "commit": EventType.ENVIRONMENTS_REVISIONS_COMMITTED,
    },
}


def _extract_revision_reference(
    *,
    domain: str,
    revision: Any,
) -> Dict[str, Dict[str, Any]]:
    """Build a partial identity object for a single revision.

    `domain` is `"application"`, `"query"`, `"testset"`, `"evaluator"`, or
    `"environment"`. The returned dict uses keys like:

        {
            "<domain>": {"id": "..."},
            "<domain>_variant": {"id": "..."},
            "<domain>_revision": {"id": "...", "slug": "...", "version": ...},
        }

    Missing fields are omitted; missing artifact or variant subsections are
    omitted entirely.
    """
    artifact_id = _str_or_none(getattr(revision, f"{domain}_id", None)) or _str_or_none(
        getattr(revision, "artifact_id", None)
    )
    variant_id = _str_or_none(
        getattr(revision, f"{domain}_variant_id", None)
    ) or _str_or_none(getattr(revision, "variant_id", None))
    revision_id = _str_or_none(getattr(revision, "id", None))
    revision_slug = getattr(revision, "slug", None)
    revision_version = getattr(revision, "version", None)

    references: Dict[str, Dict[str, Any]] = {}

    if artifact_id is not None:
        references[domain] = {"id": artifact_id}

    if variant_id is not None:
        references[f"{domain}_variant"] = {"id": variant_id}

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

    Pass either `request` (router-layer call) OR explicit scope arguments
    (service-layer call like environments commit).

    Skips publishing when:
    - request is provided but lacks usable project_id/user_id
    - single-shape action (retrieve/fetch/commit): no revision returned, or
      explicit count <= 0
    - list-shape (query/log) action: empty result list
    """
    if request is not None:
        scope = request_scope(request)
        if not scope.enabled:
            return
        organization_id = scope.organization_id
        project_id = scope.project_id
        user_id = scope.user_id

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
