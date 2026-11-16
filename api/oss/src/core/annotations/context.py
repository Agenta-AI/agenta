"""The general fields of an annotation, the same for every evaluator.

Both annotation routes (`POST /annotations` and `POST /simple/traces`) build them here: the
subject's session and turn, the scope, the author and the actor, and the working agent in the
references. The link to a span only anchors the annotation; nothing depends on which span.
"""

from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
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
from oss.src.core.tracing.utils.traces import link_role

if TYPE_CHECKING:
    from oss.src.core.sessions.turns.service import SessionTurnsService
    from oss.src.core.tracing.service import TracingService


SUBJECT_ROLE = "subject"

AGENT_REFERENCE_KEYS = (
    "application",
    "application_variant",
    "application_revision",
)

# Runs started from a session carry `workflow*` references; annotations name the same
# entity under the `application*` keys (an application id is its workflow id).
_RUN_REFERENCE_KEYS = {
    "workflow": "application",
    "workflow_variant": "application_variant",
    "workflow_revision": "application_revision",
}

# Stored under `ag`; an edit keeps them from the stored annotation.
KEPT_ON_EDIT = ("session", "turn", "annotation")


class AnnotationContext(BaseModel):
    links: Optional[SimpleTraceLinks] = None
    session_id: Optional[str] = None
    turn_id: Optional[str] = None
    annotation: Optional[AgAnnotationAttributes] = None
    agent_references: Dict[str, Dict[str, Any]] = {}

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


def subject_link(links: Optional[SimpleTraceLinks]) -> Optional[Link]:
    """The link with the role `subject`, else the first link."""
    if isinstance(links, dict):
        items: List[Tuple[Optional[str], Link]] = list(links.items())
    elif isinstance(links, list):
        items = [(link_role(link), link) for link in links]
    else:
        return None

    items = [(role, link) for role, link in items if link.trace_id and link.span_id]
    for role, link in items:
        if role == SUBJECT_ROLE:
            return link
    return items[0][1] if items else None


def kept_on_edit(
    *,
    stored_attributes: Optional[Dict[str, Any]],
    references: Dict[str, Any],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """The stored general fields an edit must not lose: `ag.session`, `ag.turn`,
    `ag.annotation`, and the agent references when the edit names none."""
    stored_ag = (stored_attributes or {}).get("ag") or {}
    attributes = {key: stored_ag[key] for key in KEPT_ON_EDIT if stored_ag.get(key)}

    if any(references.get(key) for key in AGENT_REFERENCE_KEYS):
        return attributes, references

    stored_references = stored_ag.get("references") or {}
    kept = dict(references)
    for key in AGENT_REFERENCE_KEYS:
        if stored_references.get(key):
            kept[key] = stored_references[key]
    return attributes, kept


def _span_identity(span: OTelFlatSpan) -> Tuple[Optional[str], Optional[str]]:
    ag = (span.attributes or {}).get("ag") or {}
    session = ag.get("session") if isinstance(ag.get("session"), dict) else {}
    turn = ag.get("turn") if isinstance(ag.get("turn"), dict) else {}
    return session.get("id"), turn.get("id")


def _agent_references(root: Optional[OTelFlatSpan]) -> Dict[str, Dict[str, Any]]:
    ag = ((root.attributes if root else None) or {}).get("ag") or {}
    references = ag.get("references") or {}
    agent: Dict[str, Dict[str, Any]] = {}
    for key in AGENT_REFERENCE_KEYS:
        if references.get(key):
            agent[key] = references[key]
    if agent:
        return agent
    for run_key, key in _RUN_REFERENCE_KEYS.items():
        if references.get(run_key):
            agent[key] = references[run_key]
    return agent


class AnnotationContextService:
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
        #
        scope: Optional[AnnotationScope],
        session_id: Optional[str],
        turn_id: Optional[str],
        links: Optional[SimpleTraceLinks],
        references: SimpleTraceReferences,
    ) -> AnnotationContext:
        subject = subject_link(links)

        if subject is None and scope in (AnnotationScope.TURN, AnnotationScope.SESSION):
            turn = await self._find_turn(
                project_id=project_id,
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

        agent_references: Dict[str, Dict[str, Any]] = {}
        if subject is not None:
            span, root = await self._fetch_subject(
                project_id=project_id, subject=subject
            )
            if span is not None:
                session_id, turn_id = _span_identity(span)
            elif not session_id and not turn_id:
                # A running agent's spans are not stored yet; its turn row names the trace.
                turn = await self._find_turn_of_trace(
                    project_id=project_id,
                    trace_id=subject.trace_id,
                )
                if turn is not None:
                    session_id = turn.session_id
                    turn_id = str(turn.turn_id) if turn.turn_id else None

            if not any(getattr(references, key) for key in AGENT_REFERENCE_KEYS):
                agent_references = _agent_references(root)

            scope = scope or AnnotationScope.SPAN

        if scope == AnnotationScope.SESSION:
            turn_id = None

        # The actor equals the author until a request field for the actor exists.
        author = AgAnnotationPartyAttributes(
            type=AnnotationPartyType.PERSON,
            user_id=str(user_id),
        )

        return AnnotationContext(
            links=links,
            session_id=session_id,
            turn_id=turn_id,
            annotation=AgAnnotationAttributes(
                scope=scope,
                author=author,
                actor=author,
            ),
            agent_references=agent_references,
        )

    async def _find_turn(
        self,
        *,
        project_id: UUID,
        session_id: Optional[str],
        turn_id: Optional[str],
    ):
        if not session_id:
            return None
        if turn_id is None:
            return await self.session_turns_service.latest_turn(
                project_id=project_id,
                session_id=session_id,
            )
        try:
            turn_uuid = UUID(turn_id)
        except ValueError:
            return None
        return await self.session_turns_service.find_turn(
            project_id=project_id,
            session_id=session_id,
            turn_id=turn_uuid,
        )

    async def _find_turn_of_trace(self, *, project_id: UUID, trace_id: str):
        try:
            trace_uuid = UUID(parse_trace_id_to_uuid(trace_id))
        except (TypeError, ValueError):
            return None
        return await self.session_turns_service.find_turn(
            project_id=project_id,
            trace_id=trace_uuid,
        )

    async def _fetch_subject(
        self,
        *,
        project_id: UUID,
        subject: Link,
    ) -> Tuple[Optional[OTelFlatSpan], Optional[OTelFlatSpan]]:
        """The subject span and the root span of its trace, when stored."""
        try:
            trace_uuid = UUID(parse_trace_id_to_uuid(subject.trace_id))
            span_uuid = parse_span_id_to_uuid(subject.span_id)
        except (TypeError, ValueError):
            return None, None

        spans = await self.tracing_service.fetch(
            project_id=project_id,
            trace_ids=[trace_uuid],
        )

        span = root = None
        for candidate in spans or []:
            if candidate.parent_id is None:
                root = candidate
            if parse_span_id_to_uuid(candidate.span_id) == span_uuid:
                span = candidate
        return span, root
