from unittest.mock import patch

import pytest

from agenta.sdk.managers import DeploymentManager
from agenta.sdk.managers.shared import DeploymentResponse


@patch("agenta.DeploymentManager.deploy_variant")
def test_deploy_variant(mock_deploy_variant):
    # Mock the API response for deploying a variant
    mock_deploy_variant.return_value = DeploymentResponse(
        **{
            "app_slug": "my-app",
            "variant_slug": "new-variant",
            "variant_version": 2,
            "environment_slug": "staging",
            "deployment_info": {
                "deployed_at": "2023-10-02T12:30:00Z",
                "deployed_by": "user@example.com",
            },
        }
    )

    deployment = DeploymentManager.deploy_variant(
        app_slug="my-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment.environment_slug == "staging"
    assert deployment.deployment_info["deployed_by"] == "user@example.com"


@pytest.mark.asyncio
@patch("agenta.DeploymentManager.adeploy_variant")
async def test_adeploy_variant(mock_adeploy_variant):
    # Mock the API response for deploying a variant
    mock_adeploy_variant.return_value = DeploymentResponse(
        **{
            "app_slug": "my-app",
            "variant_slug": "new-variant",
            "variant_version": 8,
            "environment_slug": "production",
            "deployment_info": {
                "deployed_at": "2024-10-02T12:30:00Z",
                "deployed_by": "abc@example.com",
            },
        }
    )

    deployment = await DeploymentManager.adeploy_variant(
        app_slug="my-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment.environment_slug == "production"
    assert deployment.deployment_info["deployed_by"] == "abc@example.com"


@patch("agenta.DeploymentManager.deploy_variant")
def test_deploy_variant_not_found(mock_deploy_variant):
    # Mock the API response for deploying a variant
    mock_deploy_variant.return_value = {"detail": "Config not found."}

    deployment = DeploymentManager.deploy_variant(
        app_slug="non-existent-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment["detail"] == "Config not found."  # type: ignore


@pytest.mark.asyncio
@patch("agenta.DeploymentManager.adeploy_variant")
async def test_adeploy_variant_not_found(mock_adeploy_variant):
    # Mock the API response for deploying a variant
    mock_adeploy_variant.return_value = {"detail": "Config not found."}

    deployment = await DeploymentManager.adeploy_variant(
        app_slug="non-existent-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment["detail"] == "Config not found."  # type: ignore
