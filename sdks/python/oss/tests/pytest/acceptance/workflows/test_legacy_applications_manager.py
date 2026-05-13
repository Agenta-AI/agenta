"""
Integration tests for the async applications manager.

Tests cover upsert/retrieve flows against the preview application endpoints.
"""

import asyncio

import pytest
import agenta as ag

from agenta.sdk.managers import applications

pytestmark = [pytest.mark.acceptance, pytest.mark.asyncio]


@ag.application()
def _application_handler(prompt: str) -> str:
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


async def test_applications_upsert_retrieve_update(
    deterministic_legacy_application_slug: str, agenta_init
):
    rev1_id = await _aupsert_with_retry(
        application_slug=deterministic_legacy_application_slug,
        name="SDK IT App v1",
        description="SDK integration test application",
        handler=_application_handler,
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
        name="SDK IT App v1",
        description="SDK integration test application (updated)",
        handler=_application_handler,
    )
    assert rev2_id is not None

    rev2 = await applications.aretrieve(application_revision_id=rev2_id)
    assert rev2 is not None
    assert rev2.application_id == rev1.application_id
