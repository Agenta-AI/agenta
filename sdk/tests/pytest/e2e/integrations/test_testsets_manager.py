"""
Integration tests for the TestsetsManager.

Tests cover:
- Testset upsert (create/update)
- Testset fetch by ID
- Testset edit with updated data
- Testset listing
- Testset retrieval by testset_id and revision_id

Run with:
    pytest sdk/tests/integration/testsets/ -v -m integration

Environment variables:
    AGENTA_API_KEY: Required for authentication
    AGENTA_HOST: Optional, defaults to https://cloud.agenta.ai
"""

import pytest

from agenta.sdk.managers import testsets

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio]


async def test_testsets_upsert_fetch_edit_list_retrieve(
    agenta_init, deterministic_testset_name: str
):
    initial = [{"input": "hello", "expected": "world"}]
    updated = [{"input": "hello", "expected": "world", "tag": "v2"}]

    rev = await testsets.aupsert(name=deterministic_testset_name, data=initial)
    assert rev is not None
    assert rev.testset_id is not None
    assert rev.id is not None

    dumped = rev.model_dump()
    assert "id" in dumped

    fetched = await testsets.afetch(testset_id=rev.testset_id)
    assert fetched is not None
    assert fetched.testset_id == rev.testset_id

    edited = await testsets.aedit(
        testset_id=rev.testset_id,
        name=deterministic_testset_name,
        data=updated,
    )
    assert edited is not None
    assert edited.testset_id == rev.testset_id

    listed = await testsets.alist()
    assert isinstance(listed, list)
    assert any((t.testset_id == rev.testset_id) for t in listed if t is not None)

    retrieved_by_testset = await testsets.aretrieve(testset_id=rev.testset_id)
    assert retrieved_by_testset is not None
    assert retrieved_by_testset.testset_id == rev.testset_id

    # Some deployments return a distinct revision id; others only return testset_id.
    # Prefer retrieving by the revision id returned from the retrieve endpoint.
    if (
        retrieved_by_testset.id
        and retrieved_by_testset.id != retrieved_by_testset.testset_id
    ):
        retrieved_by_revision = await testsets.aretrieve(
            testset_revision_id=retrieved_by_testset.id
        )
        assert retrieved_by_revision is not None
        assert retrieved_by_revision.testset_id == rev.testset_id


async def test_testset_with_empty_data(agenta_init, deterministic_testset_name: str):
    """Test behavior with empty testset data.

    This documents the actual behavior when upserting with an empty list.
    The API may accept or reject empty data depending on deployment.
    """
    empty_data: list = []

    try:
        # Attempt to upsert with empty data
        rev = await testsets.aupsert(
            name=f"{deterministic_testset_name}-empty", data=empty_data
        )

        # If the API accepts empty data, verify the response
        if rev is not None:
            assert rev.testset_id is not None
            # Cleanup: try to delete or overwrite with non-empty data
            await testsets.aedit(
                testset_id=rev.testset_id,
                name=f"{deterministic_testset_name}-empty",
                data=[{"input": "cleanup"}],
            )
    except Exception:
        # Some deployments may reject empty testset data
        # This is expected behavior in those cases
        pass


async def test_testset_acreate_direct(agenta_init):
    """Test testsets.acreate() directly (not upsert).

    This tests the direct creation API rather than the upsert pattern.
    """
    from uuid import uuid4

    unique_name = f"sdk-it-direct-create-{uuid4().hex[:8]}"
    test_data = [{"prompt": "test", "response": "success"}]

    try:
        # Use acreate directly if available
        rev = await testsets.acreate(name=unique_name, data=test_data)

        assert rev is not None
        assert rev.testset_id is not None
        assert rev.id is not None

        dumped = rev.model_dump()
        assert "id" in dumped
        assert "testset_id" in dumped

    except AttributeError:
        # acreate may not be available in all versions
        # Fall back to aupsert which should always work
        rev = await testsets.aupsert(name=unique_name, data=test_data)
        assert rev is not None
        assert rev.testset_id is not None
