from unittest.mock import patch

import pytest

from agenta.sdk.managers import VariantManager
from agenta.sdk.managers.shared import (
    ConfigurationResponse,
    VariantConfigurationsResponse,
)


@patch("agenta.VariantManager.create_variant")
def test_create_variant_successful(mock_create_variant, prompt):
    # Mock the API response for creating a variant
    mock_create_variant.return_value = ConfigurationResponse(
        **{
            "app_slug": "my-app",
            "variant_slug": "new-variant",
            "variant_version": 1,
            "config": {"parameters": prompt.model_dump()},
        }
    )

    variant = VariantManager.create_variant(
        app_slug="my-app",
        variant_slug="new-variant",
        config_parameters=prompt.model_dump(),
    )

    assert variant.app_slug == "my-app"
    assert variant.variant_slug == "new-variant"
    assert variant.variant_version == 1


@pytest.mark.asyncio
@patch("agenta.VariantManager.acreate_variant")
async def test_create_avariant_successful(mock_acreate_variant, prompt):
    # Mock the API response for creating a variant
    mock_acreate_variant.return_value = ConfigurationResponse(
        **{
            "app_slug": "qa-assistant",
            "variant_slug": "school-assistant",
            "variant_version": 1,
            "config": {"parameters": prompt.model_dump()},
        }
    )

    variant = await VariantManager.acreate_variant(
        app_slug="qa-assistant",
        variant_slug="school-assistant",
        config_parameters=prompt.model_dump(),
    )

    assert variant.app_slug == "qa-assistant"
    assert variant.variant_slug == "school-assistant"
    assert variant.variant_version == 1


@patch("agenta.VariantManager.commit_variant")
def test_commit_variant(mock_commit_variant, prompt):
    # Mock the API response for committing a variant
    mock_commit_variant.return_value = ConfigurationResponse(
        **{
            "app_slug": "my-new-app",
            "variant_slug": "new-new-variant",
            "variant_version": 2,
            "config": {"parameters": prompt.model_dump()},
        }
    )

    variant = VariantManager.commit_variant(
        app_slug="my-app",
        variant_slug="new-variant",
        config_parameters=prompt.model_dump(),
    )

    assert variant.variant_version == 2
    assert type(variant.config) == dict
    assert type(variant.config["parameters"]) == dict
    assert variant.config["parameters"]["temperature"] == 0.6


@pytest.mark.asyncio
@patch("agenta.VariantManager.acommit_variant")
async def test_acommit_variant(mock_acommit_variant, prompt):
    # Mock the API response for committing a variant
    mock_acommit_variant.return_value = ConfigurationResponse(
        **{
            "app_slug": "my-new-app",
            "variant_slug": "new-variant",
            "variant_version": 4,
            "config": {"parameters": {**prompt.model_dump(), "temperature": 1.0}},
        }
    )

    variant = await VariantManager.acommit_variant(
        app_slug="my-new-app",
        variant_slug="new-variant",
        config_parameters=prompt.model_dump(),
    )

    assert variant.variant_version == 4
    assert type(variant.config) == dict
    assert type(variant.config["parameters"]) == dict
    assert variant.config["parameters"]["temperature"] == 1.0


@patch("agenta.VariantManager.delete_variant")
def test_delete_variant(mock_delete_variant):
    # Mock the API response for deleting a variant
    mock_delete_variant.return_value = "Variant deleted successfully."

    result = VariantManager.delete_variant(
        app_slug="my-app", variant_slug="obsolete-variant"
    )

    assert result == "Variant deleted successfully."


@pytest.mark.asyncio
@patch("agenta.VariantManager.adelete_variant")
async def test_adelete_variant(mock_adelete_variant):
    # Mock the API response for deleting a variant
    mock_adelete_variant.return_value = "Variant deleted successfully."

    result = await VariantManager.adelete_variant(
        app_slug="my-app", variant_slug="obsolete-variant-2"
    )

    assert result == "Variant deleted successfully."


@patch("agenta.VariantManager.list_variants")
def test_list_variants(mock_list_variants):
    # Mock the API response for listing variants
    mock_list_variants.return_value = [
        VariantConfigurationsResponse(
            **{"variant_slug": "new-variant", "versions": [1, 2], "latest_version": 2}
        ),
        VariantConfigurationsResponse(
            **{"variant_slug": "another-variant", "versions": [1], "latest_version": 1}
        ),
    ]

    variants = VariantManager.list_variants(app_slug="my-app")

    assert len(variants) == 2
    assert variants[0].variant_slug == "new-variant"
    assert variants[1].latest_version == 1


@pytest.mark.asyncio
@patch("agenta.VariantManager.alist_variants")
async def testa_list_variants(mock_alist_variants):
    # Mock the API response for listing variants
    mock_alist_variants.return_value = [
        VariantConfigurationsResponse(
            **{"variant_slug": "new-variant", "versions": [1, 2], "latest_version": 2}
        ),
        VariantConfigurationsResponse(
            **{"variant_slug": "another-variant", "versions": [1], "latest_version": 1}
        ),
    ]

    variants = await VariantManager.alist_variants(app_slug="my-app")

    assert len(variants) == 2
    assert variants[0].variant_slug == "new-variant"
    assert variants[1].latest_version == 1
