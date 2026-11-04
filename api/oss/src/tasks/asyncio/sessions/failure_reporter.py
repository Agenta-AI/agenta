from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Union
from uuid import UUID, uuid4

from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.failures import (
    AGENT_FAILURE_MESSAGE_LIMIT,
    AgentFailure,
    AgentFailureSource,
    failure_from_record,
    with_turn_context,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.services import db_manager
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

AGENT_FAILURE_EVENT = "agent_failure"

_INTERNAL_FIELDS = {"record_id", "tool_call_id", "occurred_at"}
_DETAIL_FIELDS = {"message", "prompt"}


def _reporting_enabled() -> bool:
    # The built-in key makes `env.posthog.enabled` true on a self-hosted stack too, so the
    # edition is the gate that keeps these events inside Agenta's own deployments.
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
    log.info(
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
    ):
        self.records_dao = records_dao
        self.streams_dao = streams_dao

    async def report(
        self,
        *,
        organization_id: Optional[UUID],
        project_id: UUID,
        records: List[SessionRecord],
    ) -> None:
        if not _reporting_enabled():
            return

        try:
            groups: Dict[Tuple[str, Optional[str]], List[AgentFailure]] = {}
            for record in records:
                failure = failure_from_record(record)
                if failure is not None:
                    groups.setdefault((failure.session_id, failure.turn_id), []).append(
                        failure
                    )

            emails: Dict[str, Optional[str]] = {}
            for (session_id, turn_id), failures in groups.items():
                try:
                    if session_id not in emails:
                        emails[session_id] = await self._session_owner_email(
                            project_id=project_id,
                            session_id=session_id,
                        )
                    for failure in await self._with_context(
                        project_id=project_id,
                        session_id=session_id,
                        turn_id=turn_id,
                        failures=failures,
                    ):
                        _send(
                            failure,
                            organization_id=organization_id,
                            email=emails[session_id],
                        )
                except Exception:
                    log.warning(
                        "[AGENT FAILURE] Report failed for a turn",
                        project_id=str(project_id),
                        session_id=session_id,
                        exc_info=True,
                    )
        except Exception:
            log.warning(
                "[AGENT FAILURE] Report failed",
                project_id=str(project_id),
                exc_info=True,
            )

    async def report_trigger_start(
        self,
        *,
        project_id: UUID,
        session_id: str,
        user_id: Optional[Union[UUID, str]],
        failure_code: Optional[str],
        message: Optional[str],
    ) -> None:
        if not _reporting_enabled():
            return

        try:
            failure = AgentFailure(
                record_id=uuid4(),
                project_id=project_id,
                session_id=session_id,
                occurred_at=datetime.now(timezone.utc),
                source=AgentFailureSource.TRIGGER,
                code=failure_code,
                message=message[:AGENT_FAILURE_MESSAGE_LIMIT] if message else None,
            )
            _send(
                failure,
                organization_id=None,
                email=await self._user_email(user_id=user_id),
            )
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
    ) -> List[AgentFailure]:
        needs_context = env.posthog.agent_failure_details or any(
            failure.source is AgentFailureSource.TOOL for failure in failures
        )
        if not needs_context:
            return failures

        context = await self.records_dao.get_failure_context(
            project_id=project_id,
            session_id=session_id,
            turn_id=turn_id,
        )
        return [with_turn_context(failure, context) for failure in failures]

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
