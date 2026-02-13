from unittest.mock import patch

import pytest

from agenta.sdk.managers import VariantManager
from agenta.sdk.managers.shared import ConfigurationResponse


@patch("agenta.VariantManager.create")
def test_variant_create(mock_create, prompt):
    # Mock the API response for creating a variant
    mock_create.return_value = ConfigurationResponse(
        **{
            "app_slug": "my-app",
            "variant_slug": "new-variant",
            "variant_version": 1,
            "params": prompt.model_dump(),
        }
    )

    variant = VariantManager.create(
        parameters=prompt.model_dump(),
        variant_slug="new-variant",
        app_slug="my-app",
    )

    assert variant.app_slug == "my-app"
    assert variant.variant_slug == "new-variant"
    assert variant.variant_version == 1


@pytest.mark.asyncio
@patch("agenta.VariantManager.acreate")
async def test_variant_acreate(mock_acreate, prompt):
    # Mock the API response for creating a variant
    mock_acreate.return_value = ConfigurationResponse(
        **{
            "app_slug": "qa-assistant",
            "variant_slug": "school-assistant",
            "variant_version": 1,
            "params": prompt.model_dump(),
        }
    )

    variant = await VariantManager.acreate(
        parameters=prompt.model_dump(),
        variant_slug="school-assistant",
        app_slug="qa-assistant",
    )

    assert variant.app_slug == "qa-assistant"
    assert variant.variant_slug == "school-assistant"
    assert variant.variant_version == 1


@patch("agenta.VariantManager.commit")
def test_variant_commit(mock_commit, prompt):
    # Mock the API response for committing a variant
    mock_commit.return_value = ConfigurationResponse(
        **{
            "app_slug": "my-new-app",
            "variant_slug": "new-new-variant",
            "variant_version": 2,
            "params": prompt.model_dump(),
        }
    )

    variant = VariantManager.commit(
        parameters=prompt.model_dump(),
        variant_slug="new-variant",
        app_slug="my-app",
    )

    assert variant.variant_version == 2
    assert type(variant.params) == dict  # noqa: E721
    assert variant.params["temperature"] == 0.6


@pytest.mark.asyncio
@patch("agenta.VariantManager.acommit")
async def test_variant_acommit(mock_acommit, prompt):
    # Mock the API response for committing a variant
    mock_acommit.return_value = ConfigurationResponse(
        **{
            "app_slug": "my-new-app",
            "variant_slug": "new-variant",
            "variant_version": 4,
            "params": {**prompt.model_dump(), "temperature": 1.0},
        }
    )

    variant = await VariantManager.acommit(
        parameters=prompt.model_dump(),
        variant_slug="new-variant",
        app_slug="my-new-app",
    )

    assert variant.variant_version == 4
    assert type(variant.params) == dict  # noqa: E721
    assert variant.params["temperature"] == 1.0


@patch("agenta.VariantManager.delete")
def test_variant_delete(mock_delete):
    # Mock the API response for deleting a variant
    mock_delete.return_value = 204

    result = VariantManager.delete(
        variant_slug="obsolete-variant",
        app_slug="my-app",
    )

    assert result == 204


@pytest.mark.asyncio
@patch("agenta.VariantManager.adelete")
async def test_variant_adelete(mock_adelete):
    # Mock the API response for deleting a variant
    mock_adelete.return_value = 204

    result = await VariantManager.adelete(
        variant_slug="obsolete-variant-2",
        app_slug="my-app",
    )

    assert result == 204


@patch("agenta.VariantManager.list")
def test_variant_list(mock_list, prompt):
    # Mock the API response for listing variants
    mock_list.return_value = [
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 0,
                "params": {**prompt.model_dump(), "temperature": 0.2},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 1,
                "params": {**prompt.model_dump(), "temperature": 0.56},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 2,
                "params": {**prompt.model_dump(), "temperature": 1.0},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 3,
                "params": {**prompt.model_dump(), "temperature": 0.85},
            }
        ),
    ]

    variants = VariantManager.list(app_slug="my-app")

    assert len(variants) == 4
    assert variants[0].variant_slug == "new-app-variant"
    assert variants[1].variant_version == 1


@pytest.mark.asyncio
@patch("agenta.VariantManager.alist")
async def test_variant_alist(mock_alist, prompt):
    # Mock the API response for listing variants
    mock_alist.return_value = [
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 0,
                "params": {**prompt.model_dump(), "temperature": 0.2},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 1,
                "params": {**prompt.model_dump(), "temperature": 0.56},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 2,
                "params": {**prompt.model_dump(), "temperature": 1.0},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 3,
                "params": {**prompt.model_dump(), "temperature": 0.85},
            }
        ),
    ]

    variants = await VariantManager.alist(app_slug="my-app")

    assert len(variants) == 4
    assert variants[0].variant_slug == "new-app-variant"
    assert variants[1].variant_version == 1


@patch("agenta.VariantManager.history")
def test_variant_history(mock_history, prompt):
    # Mock the API response for listing variant history
    mock_history.return_value = [
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 0,
                "params": {**prompt.model_dump(), "temperature": 0.2},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 1,
                "params": {**prompt.model_dump(), "temperature": 0.56},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 2,
                "params": {**prompt.model_dump(), "temperature": 1.0},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 3,
                "params": {**prompt.model_dump(), "temperature": 0.85},
            }
        ),
    ]

    variants = VariantManager.history(
        variant_slug="new-app-variant",
        app_id="06056815-c9d0-4cdb-bcc7-7c9e6a3fe5e3",
    )

    assert len(variants) == 4
    assert variants[0].variant_slug == "new-app-variant"
    assert variants[1].variant_version == 1


@pytest.mark.asyncio
@patch("agenta.VariantManager.ahistory")
async def test_variant_ahistory(mock_ahistory, prompt):
    # Mock the API response for listing variants
    mock_ahistory.return_value = [
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 0,
                "params": {**prompt.model_dump(), "temperature": 0.2},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 1,
                "params": {**prompt.model_dump(), "temperature": 0.56},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 2,
                "params": {**prompt.model_dump(), "temperature": 1.0},
            }
        ),
        ConfigurationResponse(
            **{
                "app_slug": "my-app",
                "variant_slug": "new-app-variant",
                "variant_version": 3,
                "params": {**prompt.model_dump(), "temperature": 0.85},
            }
        ),
    ]

    variants = await VariantManager.ahistory(
        variant_slug="new-app-variant", app_id="06056815-c9d0-4cdb-bcc7-7c9e6a3fe5e3"
    )
    assert len(variants) == 4
    assert variants[0].variant_slug == "new-app-variant"
    assert variants[1].variant_version == 1
