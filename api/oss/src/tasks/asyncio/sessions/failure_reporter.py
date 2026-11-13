import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Union
from uuid import NAMESPACE_URL, UUID, uuid5

from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.failures import (
    AGENT_FAILURE_CONVERSATION_LIMIT,
    AgentFailure,
    AgentFailureSource,
    failure_from_record,
    with_turn_context,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.sessions.turns.dtos import SessionTurn, SessionTurnQuery
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface
from oss.src.services import db_manager
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

AGENT_FAILURE_EVENT = "agent_failure"
# Callers wait on the report before they acknowledge a batch or finish a trigger task, and
# the database reads here have no timeout of their own.
REPORT_TIMEOUT_SECONDS = 5

_INTERNAL_FIELDS = {"record_id", "tool_call_id", "occurred_at"}
_DETAIL_FIELDS = {"message", "prompt", "tool_input", "conversation"}


def _reporting_enabled() -> bool:
    # The built-in key makes `env.posthog.enabled` true on every OSS stack. EE example files
    # also ship an Agenta key, so a self-hosted EE stack sends these events to Agenta unless
    # it sets its own key. Customer text stays behind `agent_failure_details` for that reason.
    return is_ee() and env.posthog.enabled


def _properties(
    failure: AgentFailure, *, organization_id: Optional[UUID], email: Optional[str]
) -> Dict[str, object]:
    excluded = set(_INTERNAL_FIELDS)
    if not env.posthog.agent_failure_details:
        excluded |= _DETAIL_FIELDS

    properties = failure.model_dump(mode="json", exclude_none=True, exclude=excluded)
    properties["failure_source"] = properties.pop("source")
    if "code" in properties:
        properties["failure_code"] = properties.pop("code")
    if organization_id is not None:
        properties["organization_id"] = str(organization_id)
    if email is None:
        properties["$process_person_profile"] = False
    return properties


def _send(
    failure: AgentFailure, *, organization_id: Optional[UUID], email: Optional[str]
) -> None:
    posthog = _load_posthog()
    if posthog is None:
        return

    # The record id as the event uuid makes a redelivered record the same PostHog event.
    posthog.capture(
        event=AGENT_FAILURE_EVENT,
        distinct_id=email or f"project:{failure.project_id}",
        uuid=str(failure.record_id),
        timestamp=failure.occurred_at,
        properties=_properties(failure, organization_id=organization_id, email=email),
    )
    log.debug(
        "[AGENT FAILURE] Sent",
        source=failure.source.value,
        code=failure.code,
    )


class AgentFailureReporter:
    """Sends agent failures to PostHog. Analytics only: no method here ever raises."""

    def __init__(
        self,
        records_dao: RecordsDAOInterface,
        streams_dao: SessionStreamsDAOInterface,
        turns_dao: SessionTurnsDAOInterface,
    ):
        self.records_dao = records_dao
        self.streams_dao = streams_dao
        self.turns_dao = turns_dao

    async def report(
        self,
        *,
        records: List[SessionRecord],
        organization_ids: Dict[UUID, Optional[UUID]],
    ) -> None:
        """One call per worker batch, so the whole batch waits on one timeout."""
        if not _reporting_enabled():
            return

        try:
            await asyncio.wait_for(
                self._report(records=records, organization_ids=organization_ids),
                timeout=REPORT_TIMEOUT_SECONDS,
            )
        except Exception:
            log.warning("[AGENT FAILURE] Report failed", exc_info=True)

    async def _report(
        self,
        *,
        records: List[SessionRecord],
        organization_ids: Dict[UUID, Optional[UUID]],
    ) -> None:
        groups: Dict[Tuple[UUID, str, Optional[str]], List[AgentFailure]] = {}
        for record in records:
            failure = failure_from_record(record)
            if failure is not None:
                key = (failure.project_id, failure.session_id, failure.turn_id)
                groups.setdefault(key, []).append(failure)
        if not groups:
            return

        # Another worker can commit a tool_call after its tool_result, so the batch's own
        # calls are read before the database.
        batch_tool_calls = [
            record for record in records if record.record_type == "tool_call"
        ]
        emails: Dict[Tuple[UUID, str], Optional[str]] = {}
        for (project_id, session_id, turn_id), failures in groups.items():
            if (project_id, session_id) not in emails:
                emails[(project_id, session_id)] = await self._session_owner_email(
                    project_id=project_id,
                    session_id=session_id,
                )
            tool_calls = [
                record
                for record in batch_tool_calls
                if record.project_id == project_id and record.session_id == session_id
            ]
            for failure in await self._with_context(
                project_id=project_id,
                session_id=session_id,
                turn_id=turn_id,
                failures=failures,
                tool_calls=tool_calls,
            ):
                _send(
                    failure,
                    organization_id=organization_ids.get(project_id),
                    email=emails[(project_id, session_id)],
                )

    async def report_trigger_start(
        self,
        *,
        organization_id: Optional[UUID],
        project_id: UUID,
        session_id: str,
        user_id: Optional[Union[UUID, str]],
        delivery_key: str,
        failure_code: str,
    ) -> None:
        """`delivery_key` names the trigger event, so its retries are one PostHog event."""
        if not _reporting_enabled():
            return

        try:
            failure = AgentFailure(
                record_id=uuid5(NAMESPACE_URL, f"agenta:trigger-start:{delivery_key}"),
                project_id=project_id,
                session_id=session_id,
                occurred_at=datetime.now(timezone.utc),
                source=AgentFailureSource.TRIGGER,
                code=failure_code,
            )
            email = await asyncio.wait_for(
                self._user_email(user_id=user_id),
                timeout=REPORT_TIMEOUT_SECONDS,
            )
            _send(failure, organization_id=organization_id, email=email)
        except Exception:
            log.warning(
                "[AGENT FAILURE] Trigger report failed",
                project_id=str(project_id),
                session_id=session_id,
                exc_info=True,
            )

    async def _with_context(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: Optional[str],
        failures: List[AgentFailure],
        tool_calls: List[SessionRecord],
    ) -> List[AgentFailure]:
        known_calls = {(call.attributes or {}).get("id") for call in tool_calls}
        if turn_id is not None and any(
            failure.tool_call_id is not None and failure.tool_call_id not in known_calls
            for failure in failures
        ):
            tool_calls = [
                *await self.records_dao.get_turn_tool_calls(
                    project_id=project_id,
                    session_id=session_id,
                    turn_id=turn_id,
                ),
                *tool_calls,
            ]

        turn = await self._turn(
            project_id=project_id, session_id=session_id, turn_id=turn_id
        )

        prompt = None
        messages: List[SessionRecord] = []
        if env.posthog.agent_failure_details:
            times = [f.occurred_at for f in failures if f.occurred_at is not None]
            at_or_before = max(times) if times else None
            prompt = await self.records_dao.get_latest_user_message(
                project_id=project_id,
                session_id=session_id,
                at_or_before=at_or_before,
            )
            messages = await self.records_dao.get_recent_messages(
                project_id=project_id,
                session_id=session_id,
                at_or_before=at_or_before,
                limit=AGENT_FAILURE_CONVERSATION_LIMIT,
            )
        return [
            with_turn_context(
                failure,
                tool_calls=tool_calls,
                prompt=prompt,
                messages=messages,
                turn=turn,
            )
            for failure in failures
        ]

    async def _turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: Optional[str],
    ) -> Optional[SessionTurn]:
        """The failed turn, for its harness and revision."""
        try:
            turn_uuid = UUID(turn_id) if turn_id else None
        except ValueError:
            return None
        if turn_uuid is None:
            return None
        # By session too: the (project_id, session_id) index bounds the read.
        turns = await self.turns_dao.query_turns(
            project_id=project_id,
            query=SessionTurnQuery(session_id=session_id, turn_id=turn_uuid),
        )
        return turns[0] if turns else None

    async def _session_owner_email(
        self, *, project_id: UUID, session_id: str
    ) -> Optional[str]:
        # Including archived: a session can be archived before its last records commit.
        stream = await self.streams_dao.get_by_session_id_including_archived(
            project_id=project_id,
            session_id=session_id,
        )
        if stream is None:
            return None
        return await self._user_email(user_id=stream.owner_user_id)

    async def _user_email(
        self, *, user_id: Optional[Union[UUID, str]]
    ) -> Optional[str]:
        if user_id is None:
            return None
        try:
            user = await db_manager.get_user_with_id(str(user_id))
        except Exception:
            # A removed user raises here. The event still goes out, without a person.
            log.warning("[AGENT FAILURE] Owner lookup failed", exc_info=True)
            return None
        return user.email or None
