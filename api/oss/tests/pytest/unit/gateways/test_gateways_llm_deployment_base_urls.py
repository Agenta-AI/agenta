"""WP32's stored-endpoint URL grammar, isolated from network/SSRF policy."""

import pytest

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind
from oss.src.core.gateways.llms.providers.passthrough.validation import (
    validate_deployment_base_url,
)


@pytest.mark.parametrize(
    ("deployment_kind", "base_url"),
    [
        (LLMDeploymentKind.BEDROCK, "https://bedrock.private.example:8443"),
        (LLMDeploymentKind.BEDROCK, "https://bedrock.private.example:8443/"),
        (
            LLMDeploymentKind.VERTEX,
            "https://vertex.private.example:9443/v1/projects/acme.prod/locations/europe-west4",
        ),
        (
            LLMDeploymentKind.VERTEX,
            "https://vertex.private.example/v1/projects/acme-prod/locations/us-central1/",
        ),
    ],
)
def test_deployment_base_url_accepts_only_its_documented_shape(
    deployment_kind, base_url
):
    validate_deployment_base_url(deployment_kind=deployment_kind, base_url=base_url)


@pytest.mark.parametrize(
    ("deployment_kind", "base_url", "message"),
    [
        (LLMDeploymentKind.BEDROCK, "https://bedrock.example/v1", "Bedrock"),
        (LLMDeploymentKind.BEDROCK, "https://bedrock.example/proxy", "Bedrock"),
        (LLMDeploymentKind.BEDROCK, "https://bedrock.example?target=x", "query"),
        (LLMDeploymentKind.BEDROCK, "https://bedrock.example#fragment", "fragment"),
        (LLMDeploymentKind.BEDROCK, "https:///missing-host", "host"),
        (LLMDeploymentKind.BEDROCK, "https://bad host.example", "host"),
        (LLMDeploymentKind.VERTEX, "https://vertex.example", "Vertex"),
        (
            LLMDeploymentKind.VERTEX,
            "https://vertex.example/v1/projects/acme",
            "Vertex",
        ),
        (
            LLMDeploymentKind.VERTEX,
            "https://vertex.example/v1/projects/acme/locations/europe-west4/endpoints/openapi",
            "Vertex",
        ),
        (
            LLMDeploymentKind.VERTEX,
            "https://vertex.example/v1/projects/acme/locations/europe-west4?target=x",
            "query",
        ),
    ],
)
def test_deployment_base_url_rejects_unrelated_paths_or_invalid_url_parts(
    deployment_kind, base_url, message
):
    with pytest.raises(ValueError, match=message):
        validate_deployment_base_url(deployment_kind=deployment_kind, base_url=base_url)


def test_non_cloud_deployments_keep_their_existing_free_form_base_url_contract():
    """WP32 is deliberately narrow: custom OpenAI-compatible prefixes stay legal."""
    validate_deployment_base_url(
        deployment_kind=LLMDeploymentKind.CUSTOM,
        base_url="https://proxy.example/openai/v1?tenant=acme",
    )
