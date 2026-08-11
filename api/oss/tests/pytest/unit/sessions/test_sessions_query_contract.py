from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from oss.src.apis.fastapi.sessions.models import (
    SessionExcludeRequest,
    SessionPredicatesRequest,
    SessionQueryRequest,
)
from oss.src.apis.fastapi.sessions.router import SessionsRootRouter
from oss.src.apis.fastapi.sessions.utils import (
    compute_session_response_windowing,
    normalize_session_query_request,
    sanitize_session_tags,
)
from oss.src.core.sessions.dtos import (
    SessionExpansion,
    SessionListItem,
    SessionOrigin,
    SessionQuery,
    SessionQueryLifecycle,
    SessionQueryOptions,
    SessionQueryPage,
    SessionTriggerAttribution,
    SessionTriggerKind,
)
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamQuery,
    SessionStreamQueryFlags,
)
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    SESSION_RESERVED_TAG_KEYS,
    decode_session_attribution,
    trigger_attribution_tags,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing


def test_nested_only_request_normalizes_by_semantic_role():
    reference = Reference(id=uuid4())
    normalized = normalize_session_query_request(
        SessionQueryRequest(
            session=SessionPredicatesRequest(
                search=" refund ",
                liveness=SessionStreamQueryFlags(is_alive=True),
                origins=[SessionOrigin.trigger],
            ),
            session_ids=["session-b", "session-a"],
            exclude=SessionExcludeRequest(
                origins=[SessionOrigin.manual], session_ids=["session-c"]
            ),
            turn_references=[reference],
            include_ended=True,
            include_total=True,
            expand=[SessionExpansion.last_message, SessionExpansion.trigger],
            windowing=Windowing(limit=30),
        )
    )

    assert normalized.predicates.search == "refund"
    assert normalized.predicates.flags.is_alive is True
    assert normalized.predicates.origins == [SessionOrigin.trigger]
    assert normalized.predicates.session_ids == ["session-a", "session-b"]
    assert normalized.predicates.exclude_origins == [SessionOrigin.manual]
    assert normalized.predicates.exclude_session_ids == ["session-c"]
    assert normalized.predicates.turn_references == [reference]
    assert normalized.lifecycle.include_ended is True
    assert normalized.options.include_total is True
    assert normalized.options.expand == [
        SessionExpansion.last_message,
        SessionExpansion.trigger,
    ]
    assert normalized.windowing.limit == 30


def test_flat_only_request_remains_valid():
    reference = Reference(id=uuid4())
    normalized = normalize_session_query_request(
        SessionQueryRequest(
            search="refund",
            flags=SessionStreamQueryFlags(is_running=True),
            origin=SessionOrigin.trigger,
            session_ids=["session-a"],
            exclude_origin=SessionOrigin.manual,
            exclude_session_ids=["session-b"],
            references=[reference],
        )
    )

    assert normalized.predicates == SessionQuery(
        search="refund",
        flags=SessionStreamQueryFlags(is_running=True),
        origins=[SessionOrigin.trigger],
        session_ids=["session-a"],
        exclude_origins=[SessionOrigin.manual],
        exclude_session_ids=["session-b"],
        turn_references=[reference],
    )


def test_equivalent_mixed_request_is_accepted_order_insensitively():
    first = Reference(id=uuid4())
    second = Reference(id=uuid4())
    normalized = normalize_session_query_request(
        SessionQueryRequest(
            session=SessionPredicatesRequest(
                search="refund",
                origins=[SessionOrigin.trigger],
            ),
            search=" refund ",
            origin=SessionOrigin.trigger,
            session_ids=["session-a", "session-b"],
            turn_references=[first, second],
            references=[second, first],
        )
    )

    assert normalized.predicates.search == "refund"
    assert normalized.predicates.session_ids == ["session-a", "session-b"]
    assert normalized.predicates.origins == [SessionOrigin.trigger]


def test_semantically_empty_search_and_liveness_duplicates_are_equivalent():
    normalized = normalize_session_query_request(
        SessionQueryRequest.model_validate(
            {
                "session": {"search": "  ", "liveness": {}},
                "search": None,
                "flags": None,
            }
        )
    )

    assert normalized.predicates.search is None
    assert normalized.predicates.flags == SessionStreamQueryFlags()


@pytest.mark.parametrize(
    "payload",
    [
        {
            "session": {"search": "refund"},
            "search": "invoice",
        },
        {"session": {"liveness": {"is_alive": True}}, "flags": {"is_alive": False}},
        {
            "exclude": {"origins": ["trigger"]},
            "exclude_origin": "manual",
        },
        {
            "turn_references": [{"id": str(uuid4())}],
            "references": [{"id": str(uuid4())}],
        },
    ],
)
def test_contradictory_mixed_request_returns_422(payload):
    with pytest.raises(HTTPException) as error:
        normalize_session_query_request(SessionQueryRequest.model_validate(payload))

    assert error.value.status_code == 422


def test_explicit_empty_inclusions_are_preserved_as_match_nothing():
    normalized = normalize_session_query_request(
        SessionQueryRequest(
            session=SessionPredicatesRequest(origins=[]),
            session_ids=[],
            turn_references=[],
        )
    )

    assert normalized.predicates.session_ids == []
    assert normalized.predicates.origins == []
    assert normalized.predicates.turn_references == []


@pytest.mark.parametrize(
    "payload",
    [
        {"session_ids": ["bad/id"]},
        {"exclude_session_ids": ["bad id"]},
        {"session_ids": ["../bad"]},
        {"exclude": {"session_ids": [""]}},
        {"session_ids": [f"session-{index}" for index in range(501)]},
        {"exclude": {"session_ids": [f"session-{index}" for index in range(501)]}},
    ],
)
def test_session_id_lists_validate_values_and_500_bound(payload):
    with pytest.raises(ValidationError):
        SessionQueryRequest.model_validate(payload)


def test_session_id_lists_accept_exactly_500_valid_ids():
    session_ids = [f"session-{index}" for index in range(500)]

    request = SessionQueryRequest(
        session_ids=session_ids,
        exclude=SessionExcludeRequest(session_ids=session_ids),
    )

    assert len(request.session_ids) == 500
    assert len(request.exclude.session_ids) == 500


@pytest.mark.parametrize(
    "payload",
    [
        {"session": {"origins": ["trigger"], "unexpected": True}},
        {"session": {"session_ids": ["session-a"]}},
        {"exclude": {"session_ids": ["session-a"], "unexpected": True}},
        {"expand": ["unknown"]},
    ],
)
def test_new_contract_fields_and_enum_values_are_not_silently_ignored(payload):
    with pytest.raises(ValidationError):
        SessionQueryRequest.model_validate(payload)


def test_openapi_session_predicates_exclude_session_ids():
    schema = SessionPredicatesRequest.model_json_schema()

    assert "session_ids" not in schema["properties"]
    assert "session_ids" in SessionQueryRequest.model_json_schema()["properties"]


def test_empty_legacy_references_remain_neutral():
    normalized = normalize_session_query_request(SessionQueryRequest(references=[]))

    assert normalized.predicates.turn_references is None


def test_empty_legacy_references_do_not_conflict_with_canonical_references():
    reference = Reference(id=uuid4())
    normalized = normalize_session_query_request(
        SessionQueryRequest(turn_references=[reference], references=[])
    )

    assert normalized.predicates.turn_references == [reference]


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (SessionQuery, {"include_total": True}),
        (SessionQuery, {"include_ended": True}),
        (SessionQueryLifecycle, {"search": "refund"}),
        (SessionQueryOptions, {"session_ids": ["session-a"]}),
    ],
)
def test_normalized_core_roles_forbid_misplaced_fields(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


def _compile_stream_query(
    *,
    filter: SessionStreamQuery,
    session_ids=None,
    exclude_session_ids=None,
    windowing=None,
) -> str:
    statement = SessionStreamsDAO._apply_filters(
        select(SessionStreamDBE),
        project_id=uuid4(),
        filter=filter,
        session_ids=session_ids,
        exclude_session_ids=exclude_session_ids,
    )
    if windowing is not None:
        statement = apply_windowing(
            stmt=statement,
            DBE=SessionStreamDBE,
            attribute="updated_at",
            order="descending",
            windowing=windowing,
        )
    return str(
        statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).replace("\n", " ")


def test_origin_include_and_exclude_apply_before_pagination():
    sql = _compile_stream_query(
        filter=SessionStreamQuery(
            origins=[SessionOrigin.trigger],
            exclude_origins=[SessionOrigin.trigger],
        ),
        windowing=Windowing(limit=1),
    )

    assert "ag.origin" in sql
    assert " IN ('trigger')" in sql
    assert "NOT IN ('trigger')" in sql
    assert sql.index("ag.origin") < sql.index("ORDER BY") < sql.index("LIMIT")


def test_excluding_trigger_retains_null_and_unstamped_rows():
    sql = _compile_stream_query(
        filter=SessionStreamQuery(exclude_origins=[SessionOrigin.trigger])
    )

    assert "IS NULL OR" in sql
    assert "NOT IN ('trigger')" in sql


def test_missing_origin_filter_adds_no_origin_predicate():
    sql = _compile_stream_query(filter=SessionStreamQuery())

    assert "ag.origin" not in sql


def test_empty_origin_inclusion_compiles_to_match_nothing():
    sql = _compile_stream_query(filter=SessionStreamQuery(origins=[]))

    assert "1 != 1" in sql


def test_session_id_exclusion_wins_on_overlap():
    sql = _compile_stream_query(
        filter=SessionStreamQuery(),
        session_ids=["session-a"],
        exclude_session_ids=["session-a"],
    )

    assert " IN ('session-a')" in sql
    assert "NOT IN ('session-a')" in sql


class _Streams:
    def __init__(self, rows):
        self.rows = rows
        self.query_calls = []
        self.count_calls = []

    async def query_streams(self, **kwargs):
        self.query_calls.append(kwargs)
        return self.rows

    async def count_streams(self, **kwargs):
        self.count_calls.append(kwargs)
        return len(self.rows)


class _Turns:
    def __init__(self, reference_session_ids=()):
        self.reference_session_ids = list(reference_session_ids)
        self.query_calls = []

    async def query_session_ids_by_references(self, **kwargs):
        self.query_calls.append(kwargs)
        return list(self.reference_session_ids)

    async def latest_turn_per_session(self, **kwargs):
        return {}


def _service(rows, turns):
    streams = _Streams(rows)
    return (
        SessionsService(
            streams_service=streams,
            turns_service=turns,
            interactions_service=object(),
            mounts_service=object(),
        ),
        streams,
    )


async def test_page_and_total_share_one_turn_reference_resolution():
    project_id = uuid4()
    row = SessionStream(id=uuid4(), project_id=project_id, session_id="session-a")
    turns = _Turns(["session-a", "session-b"])
    service, streams = _service([row], turns)

    page = await service.query_sessions_page(
        project_id=project_id,
        query=SessionQuery(
            turn_references=[Reference(id=uuid4())],
            session_ids=["session-a"],
            exclude_session_ids=["session-b"],
        ),
        options=SessionQueryOptions(include_total=True),
    )

    assert page.total == 1
    assert len(turns.query_calls) == 1
    assert streams.query_calls[0]["session_ids"] == ["session-a"]
    assert streams.count_calls[0]["session_ids"] == ["session-a"]
    assert streams.query_calls[0]["exclude_session_ids"] == ["session-b"]
    assert streams.count_calls[0]["exclude_session_ids"] == ["session-b"]


async def test_empty_request_is_origin_neutral():
    project_id = uuid4()
    rows = [
        SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id="trigger-session",
            origin=SessionOrigin.trigger,
        ),
        SessionStream(id=uuid4(), project_id=project_id, session_id="unknown-session"),
    ]
    service, streams = _service(rows, _Turns())

    result = await service.query_sessions(project_id=project_id)

    assert [row.session_id for row in result] == [
        "trigger-session",
        "unknown-session",
    ]
    assert streams.query_calls[0]["filter"].origins is None
    assert result[1].origin is None


def _item(*, created_at, updated_at=None, item_id=None):
    return SessionListItem(
        id=item_id or uuid4(),
        project_id=uuid4(),
        session_id="session-a",
        created_at=created_at,
        updated_at=updated_at,
    )


def test_response_cursor_uses_coalesced_activity_and_uuid_tiebreak():
    created_at = datetime(2026, 8, 10, tzinfo=timezone.utc)
    updated_at = created_at + timedelta(hours=1)
    last_id = uuid4()
    sessions = [
        _item(created_at=created_at),
        _item(created_at=created_at, updated_at=updated_at, item_id=last_id),
    ]

    result = compute_session_response_windowing(
        sessions=sessions, requested=Windowing(limit=2, order="descending")
    )

    assert result.next == last_id
    assert result.newest == updated_at
    assert result.oldest is None
    assert result.limit == 2


def test_response_cursor_falls_back_to_created_at():
    created_at = datetime(2026, 8, 10, tzinfo=timezone.utc)
    result = compute_session_response_windowing(
        sessions=[_item(created_at=created_at)], requested=Windowing(limit=1)
    )

    assert result.newest == created_at


def test_ascending_response_cursor_uses_oldest_and_uuid_tiebreak():
    activity = datetime(2026, 8, 10, tzinfo=timezone.utc)
    last_id = UUID(int=2)

    result = compute_session_response_windowing(
        sessions=[
            _item(created_at=activity, item_id=UUID(int=1)),
            _item(created_at=activity, item_id=last_id),
        ],
        requested=Windowing(limit=2, order="ascending"),
    )

    assert result.next == last_id
    assert result.oldest == activity
    assert result.newest is None


@pytest.mark.parametrize("order", ["ascending", "descending"])
def test_response_cursor_carries_interval_and_rate_across_pages(order):
    # `terminal` (the no-more-pages branch) already copied these; the cursor
    # branches dropped them, so a client-supplied interval/rate silently
    # vanished the moment paging actually produced a `next` cursor.
    created_at = datetime(2026, 8, 10, tzinfo=timezone.utc)
    sessions = [
        _item(created_at=created_at, item_id=UUID(int=1)),
        _item(created_at=created_at, item_id=UUID(int=2)),
    ]

    result = compute_session_response_windowing(
        sessions=sessions,
        requested=Windowing(limit=2, order=order, interval=60, rate=0.5),
    )

    assert result.next is not None
    assert result.interval == 60
    assert result.rate == 0.5


@pytest.mark.parametrize("order", ["ascending", "descending"])
def test_tied_activity_two_page_cursors_have_no_duplicates(order):
    activity = datetime(2026, 8, 10, tzinfo=timezone.utc)
    rows = [
        _item(created_at=activity, item_id=UUID(int=index)) for index in range(1, 6)
    ]
    ordered = sorted(rows, key=lambda row: row.id, reverse=order == "descending")
    first_page = ordered[:2]
    cursor = compute_session_response_windowing(
        sessions=first_page,
        requested=Windowing(limit=2, order=order),
    )

    if order == "ascending":
        second_page = [
            row
            for row in ordered
            if (row.updated_at or row.created_at) > cursor.oldest
            or (
                (row.updated_at or row.created_at) == cursor.oldest
                and row.id > cursor.next
            )
        ][:2]
    else:
        second_page = [
            row
            for row in ordered
            if (row.updated_at or row.created_at) < cursor.newest
            or (
                (row.updated_at or row.created_at) == cursor.newest
                and row.id < cursor.next
            )
        ][:2]

    assert {row.id for row in first_page}.isdisjoint(row.id for row in second_page)
    assert [row.id for row in first_page + second_page] == [
        row.id for row in ordered[:4]
    ]


def test_unwindowed_response_omits_response_windowing():
    created_at = datetime(2026, 8, 10, tzinfo=timezone.utc)
    sessions = [_item(created_at=created_at)]

    assert compute_session_response_windowing(sessions=sessions, requested=None) is None


@pytest.mark.parametrize(
    ("requested", "count"),
    [
        (Windowing(), 1),
        (Windowing(limit=0), 1),
        (Windowing(limit=2), 1),
        (Windowing(limit=2), 0),
    ],
)
def test_terminal_windowed_response_keeps_windowing_without_next(requested, count):
    created_at = datetime(2026, 8, 10, tzinfo=timezone.utc)
    sessions = [_item(created_at=created_at) for _ in range(count)]

    result = compute_session_response_windowing(
        sessions=sessions,
        requested=requested,
    )

    assert result is not None
    assert result.next is None
    assert result.limit == requested.limit
    assert result.order == requested.order


def test_terminal_windowed_response_clears_the_request_cursor():
    created_at = datetime(2026, 8, 10, tzinfo=timezone.utc)
    requested = Windowing(
        limit=2,
        next=uuid4(),
        newest=created_at + timedelta(hours=1),
        order="descending",
    )

    result = compute_session_response_windowing(
        sessions=[_item(created_at=created_at)],
        requested=requested,
    )

    assert result is not None
    assert result.next is None
    assert result.newest == requested.newest


def test_typed_attribution_and_legacy_raw_tags_coexist():
    trigger_id = uuid4()
    delivery_id = uuid4()
    tags = {
        "ag.origin": "trigger",
        "ag.trigger.id": str(trigger_id),
        "ag.trigger.kind": "schedule",
        "ag.trigger.delivery_id": str(delivery_id),
        "team": "support",
    }
    origin, trigger, delivery = decode_session_attribution(tags)
    item = SessionListItem(
        id=uuid4(),
        project_id=uuid4(),
        session_id="session-a",
        tags=tags,
        origin=origin,
        trigger=trigger,
        delivery=delivery,
    )

    assert item.origin == SessionOrigin.trigger
    assert item.trigger.id == trigger_id
    assert item.trigger.kind == SessionTriggerKind.schedule
    assert item.trigger.name is None
    assert item.delivery.id == delivery_id
    assert item.tags == tags


def test_malformed_trigger_and_delivery_ids_degrade_independently():
    delivery_id = uuid4()
    origin, trigger, delivery = decode_session_attribution(
        {
            "ag.origin": "trigger",
            "ag.trigger.id": "not-a-uuid",
            "ag.trigger.kind": "schedule",
            "ag.trigger.delivery_id": str(delivery_id),
        }
    )

    assert origin == SessionOrigin.trigger
    assert trigger is None
    assert delivery.id == delivery_id

    trigger_id = uuid4()
    _, trigger, delivery = decode_session_attribution(
        {
            "ag.origin": "trigger",
            "ag.trigger.id": str(trigger_id),
            "ag.trigger.kind": "subscription",
            "ag.trigger.delivery_id": "not-a-uuid",
        }
    )
    assert trigger.id == trigger_id
    assert delivery is None


def test_reserved_attribution_tag_sanitizer_is_enabled_and_narrow():
    tags = {
        "ag.origin": "trigger",
        "ag.trigger.id": str(uuid4()),
        "ag.trigger.kind": "schedule",
        "ag.trigger.delivery_id": str(uuid4()),
        "ag.trigger.name": "Legacy snapshot",
        "ag.trigger.custom": "preserve",
        "ag.private": "preserve",
        "team": "support",
    }

    assert sanitize_session_tags(tags) == {
        "ag.trigger.custom": "preserve",
        "ag.private": "preserve",
        "team": "support",
    }
    assert len(tags) == 8

    # P1-7: the reserved-key list had already drifted across three hand-copied
    # spots. Pin the writer's output as a subset of the single exported set, so a
    # future fifth attribution key added to `trigger_attribution_tags` fails here
    # instead of silently leaking on every read path.
    written = trigger_attribution_tags(
        SessionTriggerAttribution(
            configuration_id=uuid4(),
            kind=SessionTriggerKind.schedule,
            delivery_id=uuid4(),
        )
    )
    assert set(written) <= SESSION_RESERVED_TAG_KEYS


def _request(project_id, user_id):
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/sessions/query",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


async def test_router_consumes_nested_fields_and_projection_options():
    service = AsyncMock()
    service.query_sessions_page.return_value = SessionQueryPage()
    router = SessionsRootRouter(sessions_service=service)
    body = SessionQueryRequest(
        session=SessionPredicatesRequest(
            search="refund",
            liveness=SessionStreamQueryFlags(is_alive=True),
            origins=[SessionOrigin.trigger],
        ),
        session_ids=["session-a"],
        exclude=SessionExcludeRequest(
            origins=[SessionOrigin.manual], session_ids=["session-b"]
        ),
        turn_references=[Reference(id=uuid4())],
        expand=[SessionExpansion.trigger],
    )

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        await router.query_sessions(
            request=_request(uuid4(), uuid4()),
            body=body,
        )

    call = service.query_sessions_page.await_args.kwargs
    assert call["query"].search == "refund"
    assert call["query"].flags.is_alive is True
    assert call["query"].origins == [SessionOrigin.trigger]
    assert call["query"].session_ids == ["session-a"]
    assert call["query"].exclude_origins == [SessionOrigin.manual]
    assert call["query"].exclude_session_ids == ["session-b"]
    assert call["query"].turn_references == body.turn_references
    assert call["options"].expand == [SessionExpansion.trigger]
