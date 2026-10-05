"""LLM gateway management wire models.

The house triple, matching `triggers/models.py`: create/edit requests wrap the core DTO
under a named field, queries add `Windowing`, responses carry `count` plus the entity.
"""

from typing import List, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, model_validator

from oss.src.apis.fastapi.gateways.exceptions import gateway_error_envelope
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMGatewayConnectionResolution,
    LLMEndpoint,
    LLMEndpointCreate,
    LLMEndpointEdit,
    LLMEndpointQuery,
)
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.env import env


class LLMEndpointCreateRequest(BaseModel):
    endpoint: LLMEndpointCreate

    @model_validator(mode="after")
    def _refuse_mock_deployment_when_mocks_are_off(
        self,
    ) -> "LLMEndpointCreateRequest":
        """Refuse a mock endpoint on a process where mocks are switched off.

        The mock deployment kind is a development affordance, and `AGENTA_GATEWAYS_MOCKS_ENABLED`
        is the switch that grants it. Without this check the switch gates only the generated
        catalogue and the compose services: a caller could still persist an endpoint declaring
        the kind, and dispatch, which reads the stored kind, would serve it.

        It sits on the request model rather than in the service because refusing a mock is a
        property of this deployment, not of the stored row: the same row is legitimate on a
        development process. The refusal carries the shared gateway envelope, so a caller reads
        a code and a next step instead of a bare status.
        """
        if (
            self.endpoint.deployment_kind == LLMDeploymentKind.MOCK
            and not env.mock_gateways.enabled
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=gateway_error_envelope(
                    code="gateway_mocks_disabled",
                    message=(
                        "Mock LLM endpoints are disabled on this deployment, so an "
                        "endpoint with deployment_kind 'mock' cannot be created."
                    ),
                    next_step=(
                        "Choose a real deployment kind, or enable "
                        "AGENTA_GATEWAYS_MOCKS_ENABLED on a development deployment."
                    ),
                    details={"flag": "AGENTA_GATEWAYS_MOCKS_ENABLED"},
                ),
            )
        return self


class LLMEndpointEditRequest(BaseModel):
    endpoint: LLMEndpointEdit


class LLMEndpointQueryRequest(BaseModel):
    endpoint: Optional[LLMEndpointQuery] = None
    windowing: Optional[Windowing] = None


class LLMEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[LLMEndpoint] = None


class LLMEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[LLMEndpoint] = Field(default_factory=list)


class LLMGatewayConnectionResolveRequest(BaseModel):
    model: str
    provider_key: Optional[str] = None
    connection_slug: Optional[str] = None


class LLMGatewayConnectionResolveResponse(BaseModel):
    connection: LLMGatewayConnectionResolution
