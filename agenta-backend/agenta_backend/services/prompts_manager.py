from typing import List, Any, Dict, Optional
from pydantic import BaseModel
import logging

from agenta_backend.services import db_manager
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


# - FETCH


async def fetch_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fetch_prompt_by_env_ref(
    env_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


# - FORK


async def fork_prompt_by_app_id(
    app_id: str,
    config_params: Dict[str, Any] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_prompt(
    prompt: PromptDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_env_ref(
    env_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


# - COMMIT


async def commit_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def commit_prompt_by_prompt(
    prompt: PromptDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def commit_prompt_by_env_ref(
    env_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


# - DEPLOY


async def deploy_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def deploy_prompt_by_prompt(
    prompt: PromptDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def deploy_prompt_by_env_ref(
    env_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt
