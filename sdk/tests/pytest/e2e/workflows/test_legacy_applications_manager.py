"""
Integration tests for the legacy ApplicationsManager.

Tests cover:
- Legacy application upsert (create/update)
- Application retrieval by revision ID
- Application update with new description
- Response serialization (model_dump)

Run with:
    pytest sdk/tests/integration/applications/ -v -m integration

Environment variables:
    AGENTA_API_KEY: Required for authentication
    AGENTA_HOST: Optional, defaults to https://cloud.agenta.ai
"""

import asyncio

import pytest

from agenta.sdk.managers import applications

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio]


def _legacy_application_handler(prompt: str) -> str:
    return prompt


async def _aupsert_with_retry(*, max_retries=3, delay=2.0, **kwargs):
    """Retry aupsert on 429 rate limit errors."""
    for attempt in range(max_retries):
        result = await applications.aupsert(**kwargs)
        if result is not None:
            return result
        if attempt < max_retries - 1:
            await asyncio.sleep(delay * (attempt + 1))
    return None


async def test_legacy_applications_upsert_retrieve_update(
    deterministic_legacy_application_slug: str, agenta_init
):
    rev1_id = await _aupsert_with_retry(
        application_slug=deterministic_legacy_application_slug,
        name="SDK IT Legacy App v1",
        description="SDK integration test legacy application",
        handler=_legacy_application_handler,
    )
    assert rev1_id is not None

    rev1 = await applications.aretrieve(application_revision_id=rev1_id)
    assert rev1 is not None
    assert rev1.id == rev1_id
    assert rev1.application_id is not None

    dumped = rev1.model_dump(mode="json", exclude_none=True)
    assert dumped.get("id")
    assert dumped.get("application_id")

    rev2_id = await _aupsert_with_retry(
        application_slug=deterministic_legacy_application_slug,
        name="SDK IT Legacy App v1",
        description="SDK integration test legacy application (updated)",
        handler=_legacy_application_handler,
    )
    assert rev2_id is not None

    rev2 = await applications.aretrieve(application_revision_id=rev2_id)
    assert rev2 is not None
    assert rev2.application_id == rev1.application_id
