"""The turn-on check of an automation: refused only while a model item needs setup.

A schedule, a trigger or a channel can be saved and turned off with any agent. Turning
one on asks the needs-setup check about the revision it targets, and refuses only when the
agent's model, model key or subscription login needs setup. Every other missing item is
left out of the runs, as it is for a chat.

Runs inside the turn-on request, never on a run path. Checked in the request's project
scope, for the person the automation runs as (`run_person_id`): a model login that each
person brings (`account_source: "user"`) depends on that person. An automation with no
run person (an API key, a channel) has no such login, so an agent whose model needs one
is refused; every other agent turns on as before.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from agenta.sdk.agents.requirements import (
    AGENT_NEEDS_SETUP,
    AGENT_NEEDS_SETUP_MESSAGE,
)
from agenta.sdk.decorators.running import WorkflowServiceRequest

from oss.src.core.agent_requirements.dtos import AgentRequirement
from oss.src.core.agent_requirements.service import AgentRequirementsService
from oss.src.core.sharing.dtos import Visibility
from oss.src.core.access.context import get_request_access
from oss.src.core.sharing.service import get_sharing_service, human_id
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.context import get_auth_scope
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class AgentNeedsSetupRefused(Exception):
    """An automation was not turned on: the agent's model needs setup."""

    message = AGENT_NEEDS_SETUP_MESSAGE

    def __init__(self, requirements: List[AgentRequirement]):
        super().__init__(self.message)
        self.requirements = requirements

    def envelope(self) -> Dict[str, Any]:
        return {
            "code": AGENT_NEEDS_SETUP,
            "message": self.message,
            "retryable": False,
            "next_step": "Set up the agent's model, then turn this on again.",
            "details": {
                "requirements": [
                    requirement.model_dump(mode="json", exclude_none=True)
                    for requirement in self.requirements
                ]
            },
        }


class ModelSetupGuard:
    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
        requirements_service: AgentRequirementsService,
    ) -> None:
        self.workflows_service = workflows_service
        self.requirements_service = requirements_service

    @staticmethod
    async def _may_read(*, project_id: UUID, artifact_id: Optional[UUID]) -> bool:
        """The private-agent rule (A2): only its owner, as a person, may see a private
        agent. An API key or an installation never passes, even its creator's."""
        if artifact_id is None:
            return True
        access = await get_sharing_service().fetch_agent_policy_cached(
            project_id=project_id, artifact_id=artifact_id
        )
        policy = access.policy
        return not (
            policy is not None
            and policy.visibility == Visibility.PRIVATE
            and policy.owner_user_id != _request_person()
        )

    async def check(
        self,
        *,
        project_id: UUID,
        references: Optional[Dict[str, Any]],
        selector: Optional[Dict[str, Any]] = None,
        run_person_id: Optional[UUID] = None,
    ) -> None:
        """Raise `AgentNeedsSetupRefused` when the target agent's model needs setup."""
        if not references:
            return
        try:
            scope = get_auth_scope()
        except Exception:  # pylint: disable=broad-except
            return
        if str(scope.project_id) != str(project_id):
            return
        revision = await self.workflows_service.fetch_request_revision(
            project_id=project_id,
            request=WorkflowServiceRequest(references=references, selector=selector),
        )
        if revision is None or not await self._may_read(
            project_id=project_id, artifact_id=revision.artifact_id
        ):
            # Another person's private agent: the answer would name its items. The
            # write's own owner rule refuses it, with the answer an unknown agent gets.
            return
        parameters = revision.data.parameters if revision.data else None
        if not isinstance(parameters, dict):
            return
        requirements = await self.requirements_service.model_requirements(
            scope=scope,
            parameters=parameters,
            artifact_id=revision.artifact_id,
            run_person_id=run_person_id,
        )
        if requirements:
            raise AgentNeedsSetupRefused(requirements)


def _request_person() -> Optional[UUID]:
    """The person behind the request, or None for an API key or no principal."""
    access = get_request_access()
    return human_id(access.principal) if access is not None else None
