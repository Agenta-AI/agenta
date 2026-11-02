"""The served-deployment set is pinned against the passthrough auth table (M5, P12)."""

import pytest

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMResolvedRoute
from oss.src.core.gateways.llms.providers.passthrough import auth as passthrough_auth
from oss.src.core.gateways.llms.types import (
    LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS,
    LLMUpstreamError,
)


def test_served_set_matches_the_passthrough_auth_table():
    # Every deployment kind is either served or deliberately not.
    not_served = {LLMDeploymentKind.BEDROCK, LLMDeploymentKind.SAGEMAKER}
    assert LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS | not_served == set(LLMDeploymentKind)
    assert not (LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS & not_served)
    # Every served kind but the in-process mock authenticates through the table.
    for kind in LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS - {LLMDeploymentKind.MOCK}:
        assert kind in passthrough_auth._AUTH, kind


async def test_sagemaker_auth_refuses_as_it_is_not_served():
    route = LLMResolvedRoute(
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.SAGEMAKER,
        model="m",
    )
    with pytest.raises(LLMUpstreamError):
        await passthrough_auth._AUTH[LLMDeploymentKind.SAGEMAKER](route, None)
