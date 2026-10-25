"""What the direct control transport runs for a continuation command.

Both continuations recheck their stored run envelope first (`deliverable_envelope`):
a command without one, or whose principal lost access, raises `MissingEnvelope` or
`AccessDenied`, which the transport passes up and `SessionCommandsService._deliver`
settles terminally. Only then does the work start, under that envelope.
"""

from typing import Any
from uuid import UUID

from agenta.sdk.decorators.running import WorkflowServiceRequest

from oss.src.core.access.service import get_access_service
from oss.src.core.sessions.commands.dtos import SessionCommand
from oss.src.core.sessions.commands.service import deliverable_envelope


async def deliver_continue_input(
    *,
    command: SessionCommand,
    workflows_service: Any,
) -> Any:
    envelope = await deliverable_envelope(access=get_access_service(), command=command)
    return await workflows_service.invoke_workflow_detached(
        project_id=command.project_id,
        user_id=command.created_by_id,
        request=WorkflowServiceRequest.model_validate(command.data["request"]),
        envelope=envelope,
        run_id=command.target_turn_id,
        control_command_id=command.id,
    )


async def deliver_continue_interaction(
    *,
    command: SessionCommand,
    interactions_dispatcher: Any,
) -> Any:
    envelope = await deliverable_envelope(access=get_access_service(), command=command)
    return await interactions_dispatcher.respond_many(
        project_id=command.project_id,
        user_id=command.created_by_id,
        interaction_answers=[
            (UUID(item["interaction_id"]), item["answer"])
            for item in command.data["answers"]
        ],
        envelope=envelope,
        control_command_id=command.id,
        continuation_execution_id=command.target_turn_id,
    )
