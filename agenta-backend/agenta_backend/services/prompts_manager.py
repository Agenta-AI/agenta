from typing import List, Any, Dict, Optional
from pydantic import BaseModel
import logging

from agenta_backend.services.db_manager import (
    get_user_with_id,
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
    fetch_app_variant_revision_by_variant,
    fetch_base_by_id,
    get_image_by_id,
    get_deployment_by_id,
    fetch_app_environment_by_id,
    fetch_app_environment_revision,
    fetch_app_environment_revision_by_environment,
    fetch_app_environment_revision_by_app_variant_revision_id,
    create_new_app_variant,
    update_variant_parameters,
    deploy_to_environment,
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
    app_environment_revision = None
    if env_ref.commit_id:
        app_environment_revision = await fetch_app_environment_revision(
            # project_id=project_id,
            revision_id=env_ref.commit_id,
        )
    elif env_ref.id and env_ref.version:
        app_environment_revision = await fetch_app_environment_revision_by_environment(
            # project_id=project_id,
            environment_id=env_ref.id,
            revision=env_ref.version,
        )

    if not app_environment_revision:
        return None

    app_variant_revision = await fetch_app_variant_revision_by_id(
        # project_id=project_id,
        variant_revision_id=app_environment_revision.deployed_app_variant_revision_id,
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


async def fetch_prompt_by_app_id_and_env_name(
    project_id: str,
    app_id: str,
    env_name: str,
) -> Optional[PromptDTO]:
    raise NotImplementedError()


# - FORK


async def fork_prompt_by_prompt_ref(
    project_id: str,
    user_id: str,
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

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=app_variant_revision.variant_id,
    )

    if not app_variant:
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

    app = await fetch_app_by_id(
        # project_id=project_id,
        app_id=variant_base.app_id,
    )

    if not app:
        return None

    user = await get_user_with_id(
        # project_id=project_id,
        user_id=user_id,
    )

    if not user:
        return None

    image = await get_image_by_id(
        # project_id=project_id,
        image_id=variant_base.image_id,
    )

    if not image:
        return None

    new_app_variant = await create_new_app_variant(
        project_id=project_id,
        app=app,
        user=user,
        variant_name=app_variant.variant_name,
        image=image,
        base=variant_base,
        config={
            "config_name": app_variant_revision.config_name,
            "parameters": app_variant_revision.config_parameters,
        },
        base_name=app_variant_revision.base_name,
    )

    prompt = PromptDTO(
        id=new_app_variant.variant_id,
        ref=ReferenceDTO(
            id=new_app_variant.variant_id,
            version=new_app_variant.revision,
            commit_id=new_app_variant.id,
        ),
        url=deployment.uri,
        params=new_app_variant.config_parameters,
        app_id=variant_base.app_id,
        env_ref=None,
        env_name=None,
    )

    return prompt


async def fork_prompt_by_env_ref(
    project_id: str,
    user_id: str,
    env_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    app_environment_revision = None
    if env_ref.commit_id:
        app_environment_revision = await fetch_app_environment_revision(
            # project_id=project_id,
            revision_id=env_ref.commit_id,
        )
    elif env_ref.id and env_ref.version:
        app_environment_revision = await fetch_app_environment_revision_by_environment(
            # project_id=project_id,
            environment_id=env_ref.id,
            revision=env_ref.version,
        )

    if not app_environment_revision:
        return None

    app_variant_revision = await fetch_app_variant_revision_by_id(
        # project_id=project_id,
        variant_revision_id=app_environment_revision.deployed_app_variant_revision_id,
    )

    if not app_variant_revision:
        return None

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=app_variant_revision.variant_id,
    )

    if not app_variant:
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

    app = await fetch_app_by_id(
        # project_id=project_id,
        app_id=variant_base.app_id,
    )

    if not app:
        return None

    user = await get_user_with_id(
        # project_id=project_id,
        user_id=user_id,
    )

    if not user:
        return None

    image = await get_image_by_id(
        # project_id=project_id,
        image_id=variant_base.image_id,
    )

    if not image:
        return None

    new_app_variant = await create_new_app_variant(
        project_id=project_id,
        app=app,
        user=user,
        variant_name=app_variant.variant_name,
        image=image,
        base=variant_base,
        config={
            "config_name": app_variant_revision.config_name,
            "parameters": app_variant_revision.config_parameters,
        },
        base_name=app_variant_revision.base_name,
    )

    prompt = PromptDTO(
        id=new_app_variant.variant_id,
        ref=ReferenceDTO(
            id=new_app_variant.variant_id,
            version=new_app_variant.revision,
            commit_id=new_app_variant.id,
        ),
        url=deployment.uri,
        params=new_app_variant.config_parameters,
        app_id=variant_base.app_id,
        env_ref=None,
        env_name=None,
    )

    return prompt


async def fork_prompt_by_app_id_and_env_name(
    project_id: str,
    user_id: str,
    app_id: str,
) -> Optional[PromptDTO]:
    raise NotImplementedError()


# - COMMIT


async def commit_prompt(
    project_id: str,
    user_id: str,
    prompt: PromptDTO,
) -> Optional[PromptDTO]:
    if prompt.ref.commit_id:
        app_variant_revision = await fetch_app_variant_revision_by_id(
            # project_id=project_id,
            variant_revision_id=prompt.ref.commit_id,
        )

        if not app_variant_revision:
            return None

        await update_variant_parameters(
            project_id=project_id,
            user_uid=user_id,
            app_variant_id=app_variant_revision.variant_id,
            parameters=prompt.params,
        )

    elif prompt.ref.id:
        await update_variant_parameters(
            project_id=project_id,
            user_uid=user_id,
            app_variant_id=prompt.ref.id,
            parameters=prompt.params,
        )

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=prompt.id,
    )

    if not app_variant:
        return None

    app_variant_revision = await fetch_app_variant_revision_by_variant(
        project_id=project_id,
        app_variant_id=prompt.id,
        revision=app_variant.revision,
    )

    if not app_variant_revision:
        return None

    prompt = await fetch_prompt_by_prompt_ref(
        project_id=project_id,
        prompt_ref=ReferenceDTO(
            id=app_variant_revision.variant_id,
            version=app_variant_revision.revision,
            commit_id=app_variant_revision.id,
        ),
    )

    return prompt


# - DEPLOY


async def deploy_prompt_by_env_ref(
    project_id: str,
    user_id: str,
    prompt_ref: ReferenceDTO,
    env_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    app_environment_revision = None
    if env_ref.commit_id:
        app_environment_revision = await fetch_app_environment_revision(
            # project_id=project_id,
            revision_id=env_ref.commit_id,
        )
    elif env_ref.id and env_ref.version:
        app_environment_revision = await fetch_app_environment_revision_by_environment(
            # project_id=project_id,
            environment_id=env_ref.id,
            revision=env_ref.version,
        )

    if not app_environment_revision:
        return None

    app_environment = await fetch_app_environment_by_id(
        # project_id=project_id,
        environment_id=app_environment_revision.environment_id,
    )

    if not app_environment:
        return None

    await deploy_to_environment(
        # project_id=project_id,
        environment_name=app_environment.name,
        variant_id=prompt_ref.id,
        user_org_data={"user_uid": user_id},
    )

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=prompt_ref.id,
    )

    if not app_variant:
        return None

    app_environment_revision = await fetch_app_environment_revision_by_environment(
        project_id=project_id,
        environment_id=app_environment_revision.environment_id,
        revision=app_variant.revision,
    )

    if not app_environment_revision:
        return None

    variant_base = await fetch_base_by_id(
        project_id=project_id,
        base_id=app_variant.base_id,
    )

    if not variant_base:
        return None

    deployment = await get_deployment_by_id(
        project_id=project_id,
        deployment_id=variant_base.deployment_id,
    )

    if not deployment:
        return None

    prompt = PromptDTO(
        id=prompt_ref.id,
        ref=ReferenceDTO(
            id=prompt_ref.id,
            version=app_variant.revision,
            commit_id=app_variant.id,
        ),
        url=deployment.uri,
        params=app_variant.config_parameters,
        app_id=app_variant.app_id,
        env_ref=env_ref,
        env_name=app_environment.name,
    )

    return prompt


async def deploy_prompt_by_app_id_and_env_name(
    project_id: str,
    app_id: str,
    env_name: str,
) -> Optional[PromptDTO]:
    raise NotImplementedError()
