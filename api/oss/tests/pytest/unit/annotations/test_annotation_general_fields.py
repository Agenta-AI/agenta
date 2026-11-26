from types import SimpleNamespace
from typing import List, Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.annotations.general_fields import AnnotationGeneralFieldsService
from oss.src.core.tracing.utils.traces import (
    keep_general_fields_on_edit,
    subject_link,
)
from oss.src.core.shared.dtos import Link, Reference
from oss.src.core.tracing.utils.parsing import parse_span_id_to_uuid
from oss.src.core.tracing.dtos import (
    AnnotationScope,
    OTelFlatSpan,
    SimpleTraceReferences,
)

TRACE = "1f2e3d4c5b6a79881f2e3d4c5b6a7988"
ROOT = "aaaaaaaaaaaaaaaa"
CHILD = "bbbbbbbbbbbbbbbb"
USER = uuid4()


def _span(span_id: str, parent_id: Optional[str], ag: dict) -> OTelFlatSpan:
    return OTelFlatSpan(
        trace_id=TRACE,
        span_id=span_id,
        parent_id=parent_id,
        attributes={"ag": ag},
    )


class FakeTracing:
    def __init__(self, spans: List[OTelFlatSpan]):
        self.spans = spans

    async def fetch(self, *, project_id, trace_ids=None, span_ids=None):
        wanted = {UUID(str(span_id)) for span_id in span_ids or []}
        return [
            span
            for span in self.spans
            if not wanted or UUID(parse_span_id_to_uuid(span.span_id)) in wanted
        ]


class FakeTurns:
    def __init__(self, turns: List[SimpleNamespace]):
        self.turns = turns
        self.calls = []

    async def find_turn(
        self, *, project_id, session_id=None, turn_id=None, trace_id=None
    ):
        self.calls.append(("find", session_id, turn_id, trace_id))
        for t in sorted(self.turns, key=lambda t: -t.turn_index):
            if session_id is not None and t.session_id != session_id:
                continue
            if turn_id is not None and t.turn_id != turn_id:
                continue
            if trace_id is not None and t.trace_id != trace_id:
                continue
            return t
        return None


TURN_1 = uuid4()
TURN_2 = uuid4()


def _turn(turn_id: UUID, index: int, span_id: Optional[str] = CHILD):
    return SimpleNamespace(
        session_id="s-40",
        turn_id=turn_id,
        turn_index=index,
        trace_id=UUID(TRACE),
        span_id=span_id,
    )


def _service(spans=(), turns=()):
    return AnnotationGeneralFieldsService(
        tracing_service=FakeTracing(list(spans)),
        session_turns_service=FakeTurns(list(turns)),
    )


AGENT_ROOT = _span(
    ROOT,
    None,
    {
        "session": {"id": "s-40"},
        "turn": {"id": str(TURN_2)},
        "references": {
            "workflow": {"id": "w-1", "slug": "quotes"},
            "workflow_revision": {"id": "r-12", "version": "12"},
        },
    },
)
AGENT_CHILD = _span(
    CHILD, ROOT, {"session": {"id": "s-40"}, "turn": {"id": str(TURN_2)}}
)


async def _allow(session_id):
    return True


async def _deny(session_id):
    return False


async def _build(
    service,
    *,
    scope=None,
    session_id=None,
    turn_id=None,
    links=None,
    references=None,
    can_view_session=_allow,
):
    return await service.build(
        project_id=uuid4(),
        user_id=USER,
        can_view_session=can_view_session,
        scope=scope,
        session_id=session_id,
        turn_id=turn_id,
        links=links,
        references=references or SimpleTraceReferences(),
    )


def test_subject_is_the_subject_role_else_the_first_link():
    a = Link(trace_id=TRACE, span_id=ROOT, attributes={"key": "evidence"})
    b = Link(trace_id=TRACE, span_id=CHILD, attributes={"key": "subject"})
    assert subject_link([a, b]) is b
    assert subject_link({"invocation": a}) is a
    assert subject_link([a]) is a
    assert subject_link({}) is None
    assert subject_link(None) is None


@pytest.mark.asyncio
async def test_old_client_span_annotation_copies_session_turn_and_agent():
    service = _service(spans=[AGENT_ROOT, AGENT_CHILD])
    general_fields = await _build(
        service, links={"invocation": Link(trace_id=TRACE, span_id=CHILD)}
    )
    attributes = general_fields.to_attributes()

    assert attributes["session"] == {"id": "s-40"}
    assert attributes["turn"] == {"id": str(TURN_2)}
    assert attributes["annotation"] == {
        "scope": "span",
        "author": {"type": "person", "user_id": str(USER)},
        "actor": {"type": "person", "user_id": str(USER)},
    }
    # The caller's role and link stay as given.
    assert list(general_fields.links) == ["invocation"]
    # Run `workflow*` references are written as `application*` keys.
    assert general_fields.application_references == {
        "application": {"id": "w-1", "slug": "quotes"},
        "application_revision": {"id": "r-12", "version": "12"},
    }


@pytest.mark.asyncio
async def test_stored_span_wins_over_the_request():
    service = _service(spans=[AGENT_ROOT, AGENT_CHILD])
    general_fields = await _build(
        service,
        session_id="s-41",
        turn_id="t-9",
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
    )
    assert general_fields.session_id == "s-40"
    assert general_fields.turn_id == str(TURN_2)


@pytest.mark.asyncio
async def test_prompt_span_without_session_gets_no_session_or_turn():
    prompt_root = _span(
        ROOT, None, {"references": {"application": {"id": "app-1", "slug": "p"}}}
    )
    service = _service(spans=[prompt_root])
    general_fields = await _build(
        service, links={"invocation": Link(trace_id=TRACE, span_id=ROOT)}
    )
    attributes = general_fields.to_attributes()
    assert "session" not in attributes and "turn" not in attributes
    assert attributes["annotation"]["scope"] == "span"
    assert general_fields.application_references == {
        "application": {"id": "app-1", "slug": "p"}
    }


@pytest.mark.asyncio
async def test_request_application_references_are_not_overwritten():
    service = _service(spans=[AGENT_ROOT, AGENT_CHILD])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        references=SimpleTraceReferences(application=Reference(slug="mine")),
    )
    assert general_fields.application_references == {}


@pytest.mark.asyncio
async def test_unstored_span_keeps_the_request_values():
    service = _service(spans=[], turns=[_turn(TURN_2, 2)])
    general_fields = await _build(
        service,
        session_id="s-77",
        turn_id="t-77",
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
    )
    assert (general_fields.session_id, general_fields.turn_id) == ("s-77", "t-77")


@pytest.mark.asyncio
async def test_unstored_span_of_a_running_turn_reads_the_turn_row_by_trace():
    turns = FakeTurns([_turn(TURN_2, 2)])
    service = AnnotationGeneralFieldsService(
        tracing_service=FakeTracing([]), session_turns_service=turns
    )
    general_fields = await _build(
        service, links={"invocation": Link(trace_id=TRACE, span_id=CHILD)}
    )
    assert (general_fields.session_id, general_fields.turn_id) == ("s-40", str(TURN_2))
    assert turns.calls == [("find", None, None, UUID(TRACE))]


@pytest.mark.asyncio
async def test_turn_scope_without_link_links_the_span_the_turn_row_names():
    service = _service(
        spans=[AGENT_ROOT, AGENT_CHILD], turns=[_turn(TURN_1, 1), _turn(TURN_2, 2)]
    )
    general_fields = await _build(
        service,
        scope=AnnotationScope.TURN,
        session_id="s-40",
        turn_id=str(TURN_2),
        links=[],
    )
    assert len(general_fields.links) == 1
    link = general_fields.links[0]
    assert (link.trace_id, link.span_id, link.attributes) == (
        TRACE,
        CHILD,
        {"key": "subject"},
    )
    assert general_fields.to_attributes()["annotation"]["scope"] == "turn"
    assert general_fields.turn_id == str(TURN_2)


@pytest.mark.asyncio
async def test_session_scope_links_the_latest_turn_and_leaves_the_turn_empty():
    turns = FakeTurns([_turn(TURN_1, 1, span_id=ROOT), _turn(TURN_2, 2)])
    service = AnnotationGeneralFieldsService(
        tracing_service=FakeTracing([AGENT_ROOT, AGENT_CHILD]),
        session_turns_service=turns,
    )
    general_fields = await _build(
        service, scope=AnnotationScope.SESSION, session_id="s-40", links=[]
    )
    assert general_fields.links[0].span_id == CHILD
    assert general_fields.session_id == "s-40"
    assert general_fields.turn_id is None
    assert "turn" not in general_fields.to_attributes()
    assert turns.calls[0] == ("find", "s-40", None, None)


@pytest.mark.asyncio
async def test_scope_without_a_turn_row_keeps_the_request_and_refuses_nothing():
    service = _service()
    general_fields = await _build(
        service, scope=AnnotationScope.SESSION, session_id="s-99", links=[]
    )
    assert general_fields.links == []
    assert general_fields.session_id == "s-99"
    assert general_fields.to_attributes()["annotation"]["scope"] == "session"


@pytest.mark.asyncio
async def test_turn_row_that_names_no_span_gives_no_link():
    service = _service(turns=[_turn(TURN_2, 2, span_id=None)])
    general_fields = await _build(
        service,
        scope=AnnotationScope.TURN,
        session_id="s-40",
        turn_id=str(TURN_2),
        links=[],
    )
    assert general_fields.links == []
    assert (general_fields.session_id, general_fields.turn_id) == ("s-40", str(TURN_2))


@pytest.mark.asyncio
async def test_trace_scope_keeps_the_callers_link():
    service = _service(spans=[AGENT_ROOT, AGENT_CHILD])
    links = {"invocation": Link(trace_id=TRACE, span_id=CHILD)}
    general_fields = await _build(service, scope=AnnotationScope.TRACE, links=links)
    assert general_fields.links == links
    assert general_fields.to_attributes()["annotation"]["scope"] == "trace"


@pytest.mark.asyncio
async def test_testcase_annotation_gets_only_author_and_actor():
    service = _service()
    general_fields = await _build(service, links={})
    assert general_fields.links == {}
    assert general_fields.to_attributes() == {
        "annotation": {
            "author": {"type": "person", "user_id": str(USER)},
            "actor": {"type": "person", "user_id": str(USER)},
        }
    }
    assert general_fields.application_references == {}


@pytest.mark.asyncio
async def test_invalid_subject_ids_are_not_refused():
    service = _service()
    general_fields = await _build(
        service, links={"invocation": Link(trace_id="not-an-id", span_id="nope")}
    )
    assert general_fields.to_attributes()["annotation"]["scope"] == "span"


def test_edit_keeps_the_stored_general_fields_and_application_references():
    stored = {
        "ag": {
            "session": {"id": "s-40"},
            "turn": {"id": "t2"},
            "annotation": {"scope": "turn"},
            "references": {
                "evaluator": {"slug": "thumbs"},
                "application": {"id": "a-1"},
                "application_revision": {"id": "r-1"},
            },
        }
    }
    general, references = keep_general_fields_on_edit(
        stored_attributes=stored, references={"evaluator": {"slug": "thumbs"}}
    )
    assert general == {
        "session": {"id": "s-40"},
        "turn": {"id": "t2"},
        "annotation": {"scope": "turn"},
    }
    assert references == {
        "evaluator": {"slug": "thumbs"},
        "application": {"id": "a-1"},
        "application_revision": {"id": "r-1"},
    }

    _, references = keep_general_fields_on_edit(
        stored_attributes=stored,
        references={"evaluator": {"slug": "x"}, "application": {"id": "a-2"}},
    )
    assert references == {"evaluator": {"slug": "x"}, "application": {"id": "a-2"}}


def test_edit_of_an_old_annotation_adds_nothing():
    general, references = keep_general_fields_on_edit(
        stored_attributes={"ag": {"references": {"evaluator": {"slug": "e"}}}},
        references={"evaluator": {"slug": "e"}},
    )
    assert general == {}
    assert references == {"evaluator": {"slug": "e"}}


@pytest.mark.asyncio
async def test_hidden_session_gives_no_turn_anchor():
    service = _service(spans=[AGENT_ROOT, AGENT_CHILD], turns=[_turn(TURN_2, 2)])
    general_fields = await _build(
        service,
        scope=AnnotationScope.SESSION,
        session_id="s-40",
        links=[],
        can_view_session=_deny,
    )
    assert general_fields.links == []
    assert general_fields.session_id == "s-40"


@pytest.mark.asyncio
async def test_hidden_session_is_not_read_from_the_turn_row_by_trace():
    service = _service(spans=[], turns=[_turn(TURN_2, 2)])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        can_view_session=_deny,
    )
    assert (general_fields.session_id, general_fields.turn_id) == (None, None)


@pytest.mark.asyncio
async def test_turn_scope_keeps_the_turn_when_the_linked_root_span_has_none():
    root_without_turn = _span(ROOT, None, {"session": {"id": "s-40"}})
    service = _service(
        spans=[root_without_turn], turns=[_turn(TURN_2, 2, span_id=ROOT)]
    )
    general_fields = await _build(
        service,
        scope=AnnotationScope.TURN,
        session_id="s-40",
        turn_id=str(TURN_2),
        links=[],
    )
    assert general_fields.links[0].span_id == ROOT
    assert (general_fields.session_id, general_fields.turn_id) == (
        "s-40",
        str(TURN_2),
    )


@pytest.mark.asyncio
async def test_hidden_session_of_a_stored_span_is_not_copied():
    service = _service(spans=[AGENT_ROOT, AGENT_CHILD])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        can_view_session=_deny,
    )
    assert (general_fields.session_id, general_fields.turn_id) == (None, None)
    assert general_fields.application_references == {}
    assert general_fields.to_attributes()["annotation"]["scope"] == "span"


@pytest.mark.asyncio
async def test_request_turn_of_another_session_does_not_stay():
    root_without_turn = _span(ROOT, None, {"session": {"id": "s-B"}})
    service = _service(spans=[root_without_turn])
    general_fields = await _build(
        service,
        session_id="s-A",
        turn_id="t-A",
        links={"invocation": Link(trace_id=TRACE, span_id=ROOT)},
    )
    assert (general_fields.session_id, general_fields.turn_id) == ("s-B", None)


@pytest.mark.asyncio
async def test_request_turn_stays_when_the_request_names_no_session():
    root_without_turn = _span(ROOT, None, {"session": {"id": "s-40"}})
    service = _service(spans=[root_without_turn])
    general_fields = await _build(
        service,
        scope=AnnotationScope.TURN,
        turn_id="t-2",
        links={"invocation": Link(trace_id=TRACE, span_id=ROOT)},
    )
    assert (general_fields.session_id, general_fields.turn_id) == ("s-40", "t-2")


@pytest.mark.asyncio
async def test_hidden_session_of_the_root_span_gives_no_application_references():
    child_without_session = _span(CHILD, ROOT, {})
    service = _service(spans=[AGENT_ROOT, child_without_session])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        can_view_session=_deny,
    )
    assert general_fields.application_references == {}


@pytest.mark.asyncio
async def test_turn_of_a_child_is_not_copied_when_the_root_session_is_hidden():
    child_with_turn_only = _span(CHILD, ROOT, {"turn": {"id": str(TURN_2)}})
    for references in (
        None,
        SimpleTraceReferences(application=Reference(slug="app")),
    ):
        service = _service(spans=[AGENT_ROOT, child_with_turn_only])
        general_fields = await _build(
            service,
            links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
            references=references,
            can_view_session=_deny,
        )
        assert (general_fields.session_id, general_fields.turn_id) == (None, None)
        assert general_fields.application_references == {}


@pytest.mark.asyncio
async def test_visible_root_session_does_not_keep_a_turn_of_a_hidden_session():
    root_of_another_session = _span(
        ROOT,
        None,
        {"session": {"id": "s-41"}, "references": {"workflow": {"id": "w-1"}}},
    )
    child = _span(CHILD, ROOT, {"turn": {"id": str(TURN_2)}})
    service = _service(spans=[root_of_another_session, child], turns=[_turn(TURN_2, 2)])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        can_view_session=_deny_s40,
    )
    assert general_fields.turn_id is None


@pytest.mark.asyncio
async def test_sessionless_root_with_turn_rows_gives_no_application_references():
    root_without_session = _span(
        ROOT, None, {"references": {"workflow": {"id": "w-1"}}}
    )
    # A hidden turn of s-40 and a later visible turn of s-41 on the same trace.
    visible_turn = _turn(TURN_1, 9)
    visible_turn.session_id = "s-41"
    service = _service(
        spans=[root_without_session], turns=[_turn(TURN_2, 2), visible_turn]
    )
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=ROOT)},
        can_view_session=_deny_s40,
    )
    assert general_fields.application_references == {}


@pytest.mark.asyncio
async def test_prompt_trace_without_session_keeps_its_application_references():
    root_without_session = _span(
        ROOT, None, {"references": {"workflow": {"id": "w-1"}}}
    )
    service = _service(spans=[root_without_session])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=ROOT)},
        can_view_session=_deny,
    )
    assert general_fields.application_references == {"application": {"id": "w-1"}}


async def _deny_s40(session_id):
    return session_id != "s-40"


@pytest.mark.asyncio
async def test_hidden_session_of_a_middle_span_is_not_copied():
    root_without_session = _span(
        ROOT, None, {"references": {"workflow": {"id": "w-1"}}}
    )
    middle = _span("cccccccccccccccc", ROOT, {"session": {"id": "s-40"}})
    child = _span(CHILD, "cccccccccccccccc", {"turn": {"id": str(TURN_2)}})
    service = _service(spans=[root_without_session, middle, child])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        can_view_session=_deny_s40,
    )
    assert (general_fields.session_id, general_fields.turn_id) == (None, None)
    assert general_fields.application_references == {}


@pytest.mark.asyncio
async def test_turn_row_of_a_hidden_session_blocks_a_sessionless_trace():
    root_without_session = _span(
        ROOT, None, {"references": {"workflow": {"id": "w-1"}}}
    )
    child = _span(CHILD, ROOT, {"turn": {"id": str(TURN_2)}})
    service = _service(spans=[root_without_session, child], turns=[_turn(TURN_2, 2)])
    general_fields = await _build(
        service,
        turn_id="t-request",
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        can_view_session=_deny_s40,
    )
    # Only the caller's own turn stays.
    assert (general_fields.session_id, general_fields.turn_id) == (None, "t-request")
    assert general_fields.application_references == {}


@pytest.mark.asyncio
async def test_turn_row_of_a_visible_session_keeps_the_turn_of_a_child():
    # The parent is not stored yet (a running agent); the turn row names the session.
    child = _span(CHILD, ROOT, {"turn": {"id": str(TURN_2)}})
    service = _service(spans=[child], turns=[_turn(TURN_2, 2)])
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
    )
    assert general_fields.turn_id == str(TURN_2)


@pytest.mark.asyncio
async def test_visible_child_session_does_not_open_a_sessionless_root_with_turn_rows():
    root_without_session = _span(
        ROOT, None, {"references": {"workflow": {"id": "w-1"}}}
    )
    child_of_visible_session = _span(CHILD, ROOT, {"session": {"id": "s-41"}})
    service = _service(
        spans=[root_without_session, child_of_visible_session],
        turns=[_turn(TURN_2, 2)],
    )
    general_fields = await _build(
        service,
        links={"invocation": Link(trace_id=TRACE, span_id=CHILD)},
        can_view_session=_deny_s40,
    )
    assert general_fields.session_id == "s-41"
    assert general_fields.application_references == {}
