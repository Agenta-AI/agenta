from typing import List, Any, Dict, Optional
from pydantic import BaseModel
import logging

from agenta_backend.services.db_manager import (
    fetch_app_variant_revision_by_id,
    fetch_app_variant_revision_by_variant,
    fetch_base_by_id,
    get_deployment_by_id,
    fetch_app_environment_by_id,
    fetch_app_environment_revision_by_app_variant_revision_id,
)

from agenta_backend.utils.common import isEE, isCloudProd, isCloudDev, isCloudEE, isOss


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class ReferenceDTO(BaseModel):
    id: Optional[str]
    version: Optional[str]
    commit_id: Optional[str]


class PromptDTO(BaseModel):
    id: str
    ref: ReferenceDTO
    # ---
    url: str
    params: Dict[str, Any]
    # ---
    app_id: str
    # ---
    env_ref: Optional[ReferenceDTO]
    env_name: Optional[str]


# - FETCH


async def fetch_prompt_by_prompt_ref(
    project_id: str,
    prompt_ref: ReferenceDTO,
) -> Optional[PromptDTO]:

    app_variant_revision = None
    if prompt_ref.commit_id:
        app_variant_revision = await fetch_app_variant_revision_by_id(
            # project_id=project_id,
            variant_revision_id=prompt_ref.commit_id,
        )
    elif prompt_ref.id and prompt_ref.version:
        app_variant_revision = await fetch_app_variant_revision_by_variant(
            project_id=project_id,
            app_variant_id=prompt_ref.id,
            revision=prompt_ref.version,
        )

    if not app_variant_revision:
        return None

    variant_base = await fetch_base_by_id(
        project_id=project_id,
        base_id=app_variant_revision.base_id,
    )

    if not variant_base:
        return None

    deployment = await get_deployment_by_id(
        project_id=project_id,
        deployment_id=variant_base.deployment_id,
    )

    if not deployment:
        return None

    app_environment_revision = await fetch_app_environment_revision_by_app_variant_revision_id(
        # project_id=project_id,
        app_variant_revision_id=app_variant_revision.id,
    )

    app_environment = None
    if not app_environment_revision:
        app_environment = await fetch_app_environment_by_id(
            # project_id=project_id,
            environment_id=app_environment_revision.environment_id,
        )

    prompt = PromptDTO(
        id=app_variant_revision.variant_id,
        ref=ReferenceDTO(
            id=app_variant_revision.variant_id,
            version=app_variant_revision.revision,
            commit_id=app_variant_revision.id,
        ),
        url=deployment.uri,
        params=app_variant_revision.config_parameters,
        app_id=variant_base.app_id,
        env_ref=(
            ReferenceDTO(
                id=app_environment_revision.environment_id,
                version=app_environment_revision.revision,
                commit_id=app_environment_revision.id,
            )
            if app_environment_revision
            else None
        ),
        env_name=app_environment.name if app_environment else None,
    )

    return prompt


async def fetch_prompt_by_env_ref(
    project_id: str,
    env_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


# - FORK


async def fork_prompt_by_app_id(
    project_id: str,
    app_id: str,
    config_params: Dict[str, Any] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_prompt_ref(
    project_id: str,
    prompt_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_prompt(
    project_id: str,
    prompt: PromptDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_env_ref(
    project_id: str,
    env_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


# - COMMIT


async def commit_prompt_by_prompt_ref(
    project_id: str,
    prompt_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def commit_prompt_by_prompt(
    project_id: str,
    prompt: PromptDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def commit_prompt_by_env_ref(
    project_id: str,
    env_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


# - DEPLOY


async def deploy_prompt_by_prompt_ref(
    project_id: str,
    prompt_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def deploy_prompt_by_prompt(
    project_id: str,
    prompt: PromptDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def deploy_prompt_by_env_ref(
    project_id: str,
    env_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt
