from json import dumps
from typing import Any, Callable, Optional, TypeVar

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict

from oss.src.apis.fastapi.sessions.models import SessionQueryRequest
from oss.src.core.sessions.dtos import (
    SessionQuery,
    SessionQueryLifecycle,
    SessionQueryOptions,
)
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.sessions.streams.mappings import (
    SESSION_RESERVED_TAG_NAMESPACE,
)
from oss.src.utils.env import env

SessionStreamT = TypeVar("SessionStreamT", bound=SessionStream)


class NormalizedSessionQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    predicates: SessionQuery
    lifecycle: SessionQueryLifecycle
    options: SessionQueryOptions
    windowing: Optional[Windowing] = None


def _provided(model: Optional[BaseModel], field: str) -> bool:
    return model is not None and field in model.model_fields_set


def _canonical_list(value: Any) -> Any:
    if value is None:
        return None
    canonical = []
    for item in value:
        if isinstance(item, BaseModel):
            item = item.model_dump(mode="json", exclude_none=True)
        elif hasattr(item, "value"):
            item = item.value
        canonical.append(dumps(item, sort_keys=True))
    return sorted(set(canonical))


def _merge_compatibility_value(
    *,
    name: str,
    nested_value: Any,
    nested_provided: bool,
    flat_value: Any,
    flat_provided: bool,
    canonicalize: Callable[[Any], Any] = lambda value: value,
) -> Any:
    if (
        nested_provided
        and flat_provided
        and canonicalize(nested_value) != canonicalize(flat_value)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Contradictory values supplied for {name}.",
        )
    if nested_provided:
        return nested_value
    if flat_provided:
        return flat_value
    return None


def _unique_sorted(values: Any) -> Any:
    if values is None:
        return None
    return sorted(
        set(values), key=lambda value: value.value if hasattr(value, "value") else value
    )


def normalize_session_query_request(
    body: SessionQueryRequest,
) -> NormalizedSessionQuery:
    session = body.session
    exclude = body.exclude
    windowing = body.windowing

    if windowing is not None and windowing.next is not None:
        # `apply_windowing` nests the cursor predicate under its companion bound
        # (`.newest` descending / `.oldest` ascending); `next` without it compiles
        # to no WHERE clause at all — a silent "page 1 again" infinite loop rather
        # than a diagnostic (P1-2). Contained here, not in the shared helper that
        # tracing/otel also use.
        ascending = (windowing.order or "descending").lower() == "ascending"
        if ascending and windowing.oldest is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="windowing.next requires windowing.oldest when windowing.order is 'ascending'.",
            )
        if not ascending and windowing.newest is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="windowing.next requires windowing.newest.",
            )

    search = _merge_compatibility_value(
        name="session.search/search",
        nested_value=session.search if session else None,
        nested_provided=_provided(session, "search"),
        flat_value=body.search,
        flat_provided=_provided(body, "search"),
        canonicalize=lambda value: (
            value.strip() or None if isinstance(value, str) else value
        ),
    )
    if isinstance(search, str):
        search = search.strip() or None

    liveness = _merge_compatibility_value(
        name="session.liveness/flags",
        nested_value=session.liveness if session else None,
        nested_provided=_provided(session, "liveness"),
        flat_value=body.flags,
        flat_provided=_provided(body, "flags"),
        canonicalize=lambda value: (
            value.model_dump(exclude_none=True) or None if value is not None else None
        ),
    )
    origins = _merge_compatibility_value(
        name="session.origins/origin",
        nested_value=session.origins if session else None,
        nested_provided=_provided(session, "origins"),
        flat_value=[body.origin] if body.origin is not None else None,
        flat_provided=_provided(body, "origin"),
        canonicalize=_canonical_list,
    )
    exclude_session_ids = _merge_compatibility_value(
        name="exclude.session_ids/exclude_session_ids",
        nested_value=exclude.session_ids if exclude else None,
        nested_provided=_provided(exclude, "session_ids"),
        flat_value=body.exclude_session_ids,
        flat_provided=_provided(body, "exclude_session_ids"),
        canonicalize=_canonical_list,
    )
    exclude_origins = _merge_compatibility_value(
        name="exclude.origins/exclude_origin",
        nested_value=exclude.origins if exclude else None,
        nested_provided=_provided(exclude, "origins"),
        flat_value=[body.exclude_origin] if body.exclude_origin is not None else None,
        flat_provided=_provided(body, "exclude_origin"),
        canonicalize=_canonical_list,
    )
    turn_references = _merge_compatibility_value(
        name="turn_references/references",
        nested_value=body.turn_references,
        nested_provided=_provided(body, "turn_references"),
        flat_value=body.references,
        # The released field treated [] as no filter. Preserve that behavior even when
        # the canonical field is also present.
        flat_provided=_provided(body, "references") and bool(body.references),
        canonicalize=_canonical_list,
    )

    final_origins = _unique_sorted(origins)
    final_exclude_origins = _unique_sorted(exclude_origins)
    if final_origins and final_exclude_origins:
        # An AND of the two predicates (P2-11): an origin in both lists can never
        # match, so the whole query silently returns zero rows instead of
        # surfacing the caller's contradiction — the same "contained here, not in
        # the shared helper" reasoning as the P1-2 cursor check above.
        contradictory = sorted(
            value.value for value in set(final_origins) & set(final_exclude_origins)
        )
        if contradictory:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"Contradictory origin filter: {contradictory} present in both "
                    "the include and exclude origin lists."
                ),
            )

    return NormalizedSessionQuery(
        predicates=SessionQuery(
            turn_references=turn_references,
            search=search,
            flags=liveness,
            session_ids=_unique_sorted(body.session_ids),
            exclude_session_ids=_unique_sorted(exclude_session_ids),
            origins=final_origins,
            exclude_origins=final_exclude_origins,
        ),
        lifecycle=SessionQueryLifecycle(
            include_ended=body.include_ended,
            include_archived=body.include_archived,
            archived_only=body.archived_only,
        ),
        options=SessionQueryOptions(
            include_total=body.include_total,
            expand=body.expand,
        ),
        windowing=body.windowing,
    )


def compute_session_response_windowing(
    *, sessions: list[Any], requested: Optional[Windowing]
) -> Optional[Windowing]:
    if requested is None:
        return None

    terminal = Windowing(
        newest=requested.newest,
        oldest=requested.oldest,
        limit=requested.limit,
        order=requested.order,
        interval=requested.interval,
        rate=requested.rate,
    )
    if (
        requested.limit is None
        or requested.limit <= 0
        or len(sessions) < requested.limit
        or not sessions
    ):
        return terminal

    last = sessions[-1]
    activity = last.updated_at or last.created_at
    if last.id is None or activity is None:
        return terminal

    if requested.order == "ascending":
        return Windowing(
            next=last.id,
            newest=requested.newest,
            oldest=activity,
            limit=requested.limit,
            order=requested.order,
            interval=requested.interval,
            rate=requested.rate,
        )
    return Windowing(
        next=last.id,
        newest=activity,
        oldest=requested.oldest,
        limit=requested.limit,
        order=requested.order,
        interval=requested.interval,
        rate=requested.rate,
    )


def sanitize_session_tags(tags: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if tags is None:
        return tags
    return {
        key: value
        for key, value in tags.items()
        if not key.startswith(SESSION_RESERVED_TAG_NAMESPACE)
    }


def sanitize_session_stream(
    stream: Optional[SessionStreamT],
) -> Optional[SessionStreamT]:
    if stream is None:
        return None
    return stream.model_copy(
        update={
            "tags": sanitize_session_tags(stream.tags),
            "capabilities": stream.capabilities.model_copy(
                update={"shared_reader": env.sessions.shared_reader}
            ),
        }
    )
