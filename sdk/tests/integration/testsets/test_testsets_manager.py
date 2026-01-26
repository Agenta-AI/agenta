import pytest

from agenta.sdk.managers import testsets

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


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
