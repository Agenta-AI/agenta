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
    app_id: str
    # ---
    url: str
    params: Dict[str, Any]


class EnvironmentDTO(BaseModel):
    id: str
    ref: ReferenceDTO
    app_id: str
    # ---
    prompt: PromptDTO


async def fetch_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fetch_prompt_by_environment_ref(
    environment_ref: ReferenceDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fetch_prompt_by_environment(
    environment: EnvironmentDTO,
) -> Optional[PromptDTO]:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_app_id(
    app_id: str,
    config_params: Optional[Dict[str, Any]] = None,
) -> PromptDTO:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> PromptDTO:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_prompt(
    prompt: PromptDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> PromptDTO:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_environment_ref(
    environment_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> PromptDTO:
    prompt = PromptDTO()

    return prompt


async def fork_prompt_by_environment(
    environment: EnvironmentDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> PromptDTO:
    prompt = PromptDTO()

    return prompt


async def commit_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> PromptDTO:
    prompt = PromptDTO()

    return prompt


async def commit_prompt_by_prompt(
    prompt: PromptDTO,
    config_params: Optional[Dict[str, Any]] = None,
) -> PromptDTO:
    prompt = PromptDTO()

    return prompt


async def deploy_prompt_by_prompt_ref(
    prompt_ref: ReferenceDTO,
) -> EnvironmentDTO:
    environment = EnvironmentDTO()

    return environment


async def deploy_prompt_by_prompt(
    prompt: PromptDTO,
) -> EnvironmentDTO:
    environment = EnvironmentDTO()

    return environment


async def deploy_prompt_by_environment_ref(
    environment_ref: ReferenceDTO,
) -> EnvironmentDTO:
    environment = EnvironmentDTO()

    return environment


async def deploy_prompt_by_environment(
    environment: EnvironmentDTO,
) -> EnvironmentDTO:
    environment = EnvironmentDTO()

    return environment
