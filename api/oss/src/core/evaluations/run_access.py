"""The run envelope of a stored evaluation run, and its access recheck (M2).

An evaluation run executes as its stored principal. A run without one (created by a pod
before M2) is refused; the principal is never rebuilt from `created_by_id`.
"""

from uuid import UUID

from oss.src.core.access.dtos import RunEnvelope, RunOrigin
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.principals import stored_work_envelope
from oss.src.core.access.service import get_access_service
from oss.src.core.access.types import MissingPrincipal
from oss.src.core.evaluations.types import EvaluationRun
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


async def evaluation_run_envelope(
    *, project_id: UUID, run: EvaluationRun
) -> RunEnvelope:
    if run.principal is None:
        log.info(
            "[evaluations] run refused",
            run_id=str(run.id),
            project_id=str(project_id),
            code="missing_principal",
        )
        raise MissingPrincipal()
    organization_id = await get_access_service().project_organization_id(
        project_id=project_id
    )
    if organization_id is None:
        raise MissingPrincipal("The run's project has no organization")
    return stored_work_envelope(
        principal=run.principal,
        organization_id=organization_id,
        project_id=project_id,
        origin=RunOrigin.EVALUATION,
        origin_id=str(run.id),
        # For an installation, the linked user is the acting user of the request that
        # set the principal (create, start, rerun), not the run's creator.
        created_by_id=run.principal_user_id or run.created_by_id,
    )


async def require_evaluation_run_access(
    *, project_id: UUID, run: EvaluationRun
) -> RunEnvelope:
    """The run's envelope, after `require(EDIT_EVALUATION_RUNS)`. Raises
    `MissingPrincipal` or `AccessDenied`."""

    envelope = await evaluation_run_envelope(project_id=project_id, run=run)
    await get_access_service().require(
        envelope=envelope, action=Permission.EDIT_EVALUATION_RUNS
    )
    return envelope
