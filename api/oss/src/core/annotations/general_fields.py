"""The general fields of an annotation, the same for every evaluator.

Both annotation routes (`POST /annotations` and `POST /simple/traces`) build them here: the
subject's session and turn, the scope, the author and the actor, and the application in the
references. The subject span supplies the session, the turn and the application; the
annotation keeps its link to that span only as an anchor.
"""

from typing import TYPE_CHECKING, Any, Awaitable, Callable, Dict, Optional, Tuple
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Link
from oss.src.core.tracing.dtos import (
    AgAnnotationAttributes,
    AgAnnotationPartyAttributes,
    AnnotationPartyType,
    AnnotationScope,
    OTelFlatSpan,
    SimpleTraceLinks,
    SimpleTraceReferences,
)
from oss.src.core.tracing.utils.parsing import (
    parse_span_id_to_uuid,
    parse_trace_id_to_uuid,
)
from oss.src.core.tracing.utils.traces import (
    APPLICATION_REFERENCE_KEYS,
    SUBJECT_ROLE,
    subject_link,
)

if TYPE_CHECKING:
    from oss.src.core.sessions.turns.dtos import SessionTurn
    from oss.src.core.sessions.turns.service import SessionTurnsService
    from oss.src.core.tracing.service import TracingService


# Runs started from a session carry `workflow*` references; annotations name the same
# entity under the `application*` keys (an application id is its workflow id).
_WORKFLOW_TO_APPLICATION_KEYS = {
    "workflow": "application",
    "workflow_variant": "application_variant",
    "workflow_revision": "application_revision",
}

# Deep enough for any run tree; stops a corrupt parent chain.
_MAX_ANCESTORS = 64

# Whether the caller may read a session; turn rows are read only for such sessions.
CanViewSession = Callable[[str], Awaitable[bool]]


class AnnotationGeneralFields(BaseModel):
    links: Optional[SimpleTraceLinks] = None
    session_id: Optional[str] = None
    turn_id: Optional[str] = None
    annotation: Optional[AgAnnotationAttributes] = None
    application_references: Dict[str, Dict[str, Any]] = {}

    def to_attributes(self) -> Dict[str, Any]:
        """The `ag.session`, `ag.turn` and `ag.annotation` attributes, when known."""
        attributes: Dict[str, Any] = {}
        if self.session_id:
            attributes["session"] = {"id": self.session_id}
        if self.turn_id:
            attributes["turn"] = {"id": self.turn_id}
        if self.annotation:
            attributes["annotation"] = self.annotation.model_dump(
                mode="json", exclude_none=True
            )
        return attributes


def _span_session_and_turn(span: OTelFlatSpan) -> Tuple[Optional[str], Optional[str]]:
    ag = (span.attributes or {}).get("ag") or {}
    session = ag.get("session") if isinstance(ag.get("session"), dict) else {}
    turn = ag.get("turn") if isinstance(ag.get("turn"), dict) else {}
    return session.get("id"), turn.get("id")


def _application_references(
    root: Optional[OTelFlatSpan],
) -> Dict[str, Dict[str, Any]]:
    ag = ((root.attributes if root else None) or {}).get("ag") or {}
    references = ag.get("references") or {}
    found = {
        key: references[key]
        for key in APPLICATION_REFERENCE_KEYS
        if references.get(key)
    }
    if found:
        return found
    return {
        key: references[workflow_key]
        for workflow_key, key in _WORKFLOW_TO_APPLICATION_KEYS.items()
        if references.get(workflow_key)
    }


class AnnotationGeneralFieldsService:
    def __init__(
        self,
        *,
        tracing_service: "TracingService",
        session_turns_service: "SessionTurnsService",
    ):
        self.tracing_service = tracing_service
        self.session_turns_service = session_turns_service

    async def build(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        can_view_session: CanViewSession,
        #
        scope: Optional[AnnotationScope],
        session_id: Optional[str],
        turn_id: Optional[str],
        links: Optional[SimpleTraceLinks],
        references: SimpleTraceReferences,
    ) -> AnnotationGeneralFields:
        subject = subject_link(links)

        if subject is None and scope in (AnnotationScope.TURN, AnnotationScope.SESSION):
            turn = await self._find_turn(
                project_id=project_id,
                can_view_session=can_view_session,
                session_id=session_id,
                turn_id=turn_id if scope == AnnotationScope.TURN else None,
            )
            if turn and turn.trace_id and turn.span_id:
                subject = Link(trace_id=turn.trace_id.hex, span_id=turn.span_id)
                links = [
                    Link(
                        trace_id=subject.trace_id,
                        span_id=subject.span_id,
                        attributes={"key": SUBJECT_ROLE},
                    )
                ]

        application_references: Dict[str, Dict[str, Any]] = {}
        if subject is not None:
            span = await self._fetch_span(
                project_id=project_id,
                trace_id=subject.trace_id,
                span_id=subject.span_id,
            )
            span_session_id, span_turn_id = (
                _span_session_and_turn(span) if span is not None else (None, None)
            )
            if span_session_id and not await can_view_session(span_session_id):
                # Nothing is copied from a session the caller may not view.
                span = None
                session_id, turn_id = None, None
            elif span is not None:
                # The stored span wins where it has a value; a run's root span may
                # carry the session and no turn. A request turn of another session
                # does not stay.
                if span_session_id and span_session_id != session_id:
                    turn_id = None
                session_id = span_session_id or session_id
                turn_id = span_turn_id or turn_id
            elif not session_id and not turn_id:
                # A running agent's spans are not stored yet; its turn row names the trace.
                turn = await self._find_turn(
                    project_id=project_id,
                    can_view_session=can_view_session,
                    trace_id=subject.trace_id,
                )
                if turn is not None:
                    session_id = turn.session_id
                    turn_id = str(turn.turn_id) if turn.turn_id else None

            if span is not None and not any(
                getattr(references, key) for key in APPLICATION_REFERENCE_KEYS
            ):
                root = await self._fetch_root(project_id=project_id, span=span)
                application_references = _application_references(root)

            scope = scope or AnnotationScope.SPAN

        if scope == AnnotationScope.SESSION:
            turn_id = None

        # The actor equals the author until a request field for the actor exists.
        author = AgAnnotationPartyAttributes(
            type=AnnotationPartyType.PERSON,
            user_id=str(user_id),
        )

        return AnnotationGeneralFields(
            links=links,
            session_id=session_id,
            turn_id=turn_id,
            annotation=AgAnnotationAttributes(
                scope=scope,
                author=author,
                actor=author,
            ),
            application_references=application_references,
        )

    async def _find_turn(
        self,
        *,
        project_id: UUID,
        can_view_session: CanViewSession,
        session_id: Optional[str] = None,
        turn_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Optional["SessionTurn"]:
        """The turn row by session (latest), by session and turn id, or by trace id;
        none when an id does not parse or the caller may not read the session."""
        try:
            turn_uuid = UUID(turn_id) if turn_id else None
            trace_uuid = UUID(parse_trace_id_to_uuid(trace_id)) if trace_id else None
        except (TypeError, ValueError):
            return None
        if not session_id and not trace_uuid:
            return None

        turn = await self.session_turns_service.find_turn(
            project_id=project_id,
            session_id=session_id,
            turn_id=turn_uuid,
            trace_id=trace_uuid,
        )
        if turn is None or not await can_view_session(turn.session_id):
            return None
        return turn

    async def _fetch_span(
        self,
        *,
        project_id: UUID,
        trace_id: str,
        span_id: str,
    ) -> Optional[OTelFlatSpan]:
        try:
            trace_uuid = UUID(parse_trace_id_to_uuid(trace_id))
            span_uuid = UUID(parse_span_id_to_uuid(span_id))
        except (TypeError, ValueError):
            return None

        spans = await self.tracing_service.fetch(
            project_id=project_id,
            trace_ids=[trace_uuid],
            span_ids=[span_uuid],
        )
        return spans[0] if spans else None

    async def _fetch_root(
        self,
        *,
        project_id: UUID,
        span: OTelFlatSpan,
    ) -> Optional[OTelFlatSpan]:
        """Walk up the parents by key; a trace is a few levels deep."""
        for _ in range(_MAX_ANCESTORS):
            if span.parent_id is None:
                return span
            parent = await self._fetch_span(
                project_id=project_id,
                trace_id=str(span.trace_id),
                span_id=str(span.parent_id),
            )
            if parent is None:
                return None
            span = parent
        return None
