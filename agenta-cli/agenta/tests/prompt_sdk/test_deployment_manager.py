from unittest.mock import patch

import pytest

from agenta.sdk.managers import DeploymentManager
from agenta.sdk.managers.shared import DeploymentResponse


@patch("agenta.DeploymentManager.deploy")
def test_deploy_variant(mock_deploy):
    # Mock the API response for deploying a variant
    mock_deploy.return_value = DeploymentResponse(
        **{
            "app_slug": "my-app",
            "variant_slug": "new-variant",
            "variant_version": 2,
            "environment_slug": "staging",
            "deployed_at": "2023-10-02T12:30:00Z",
            "deployed_by": "user@example.com",
        }
    )

    deployment = DeploymentManager.deploy(
        app_slug="my-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment.environment_slug == "staging"
    assert deployment.deployed_by == "user@example.com"


@pytest.mark.asyncio
@patch("agenta.DeploymentManager.adeploy")
async def test_adeploy_variant(mock_adeploy):
    # Mock the API response for deploying a variant
    mock_adeploy.return_value = DeploymentResponse(
        **{
            "app_slug": "my-app",
            "variant_slug": "new-variant",
            "variant_version": 8,
            "environment_slug": "production",
            "deployed_at": "2023-10-02T12:30:00Z",
            "deployed_by": "abc@example.com",
        }
    )

    deployment = await DeploymentManager.adeploy(
        app_slug="my-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment.environment_slug == "production"
    assert deployment.deployed_by == "abc@example.com"


@patch("agenta.DeploymentManager.deploy")
def test_deploy_variant_not_found(mock_deploy):
    # Mock the API response for deploying a variant
    mock_deploy.return_value = {"detail": "Config not found."}

    deployment = DeploymentManager.deploy(
        app_slug="non-existent-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment["detail"] == "Config not found."  # type: ignore


@pytest.mark.asyncio
@patch("agenta.DeploymentManager.adeploy")
async def test_adeploy_variant_not_found(mock_adeploy):
    # Mock the API response for deploying a variant
    mock_adeploy.return_value = {"detail": "Config not found."}

    deployment = await DeploymentManager.adeploy(
        app_slug="non-existent-app",
        variant_slug="new-variant",
        environment_slug="staging",
        variant_version=None,
    )

    assert deployment["detail"] == "Config not found."  # type: ignore
