import asyncio
import hashlib
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.workflows.dtos import SimpleWorkflowCreate, SimpleWorkflowData
from oss.src.core.workflows.service import SimpleWorkflowsService


PROJECT_ID = uuid4()
USER_ID = uuid4()


class _MemoryLock:
    def __init__(self):
        self.values = {}
        self.guard = asyncio.Lock()

    async def set(self, key, value, *, nx, ex):
        assert nx is True
        assert ex == 30
        async with self.guard:
            if key in self.values:
                return False
            self.values[key] = value
            return True

    async def eval(self, script, number_of_keys, key, token):
        assert number_of_keys == 1
        async with self.guard:
            if self.values.get(key) != token:
                return 0
            del self.values[key]
            return 1


class _MemorySimpleWorkflows(SimpleWorkflowsService):
    def __init__(self, *, lock_engine):
        super().__init__(workflows_service=object(), lock_engine=lock_engine)
        self.records = {}
        self.create_calls = 0

    async def _fetch_complete_by_slug(self, *, project_id, slug):
        return self.records.get((project_id, slug))

    async def create(
        self,
        *,
        project_id,
        user_id,
        simple_workflow_create,
        platform_meta=False,
        workflow_id=None,
    ):
        self.create_calls += 1
        await asyncio.sleep(0.02)
        key = (project_id, simple_workflow_create.slug)
        if key in self.records:
            raise EntityCreationConflict("workflow")
        workflow = SimpleNamespace(
            id=uuid4(),
            slug=simple_workflow_create.slug,
            variant_id=uuid4(),
            revision_id=uuid4(),
            data=simple_workflow_create.data,
        )
        self.records[key] = workflow
        return workflow


def _request():
    return SimpleWorkflowCreate(
        slug="prospect-research",
        name="Prospect research",
        data=SimpleWorkflowData(parameters={"skill": {"name": "prospect-research"}}),
    )


@pytest.mark.asyncio
async def test_parallel_retries_return_one_complete_workflow():
    service = _MemorySimpleWorkflows(lock_engine=_MemoryLock())

    first, second = await asyncio.gather(
        service.create_idempotent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            simple_workflow_create=_request(),
            idempotency_key="catalog:sha256:abc:prospect-research",
        ),
        service.create_idempotent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            simple_workflow_create=_request(),
            idempotency_key="catalog:sha256:abc:prospect-research",
        ),
    )

    assert first.id == second.id
    assert first.variant_id == second.variant_id
    assert first.revision_id == second.revision_id
    assert service.create_calls == 1
    assert len(service.records) == 1


@pytest.mark.asyncio
async def test_database_slug_is_authoritative_without_a_lock():
    service = _MemorySimpleWorkflows(lock_engine=None)

    first, second = await asyncio.gather(
        service.create_idempotent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            simple_workflow_create=_request(),
            idempotency_key="catalog:sha256:abc:prospect-research",
        ),
        service.create_idempotent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            simple_workflow_create=_request(),
            idempotency_key="catalog:sha256:abc:prospect-research",
        ),
    )

    assert first.id == second.id
    assert service.create_calls == 2
    assert len(service.records) == 1


@pytest.mark.asyncio
async def test_different_keys_create_distinct_workflows():
    service = _MemorySimpleWorkflows(lock_engine=_MemoryLock())

    first = await service.create_idempotent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        simple_workflow_create=_request(),
        idempotency_key="catalog:sha256:abc:prospect-research",
    )
    second = await service.create_idempotent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        simple_workflow_create=_request(),
        idempotency_key="catalog:sha256:def:prospect-research",
    )

    assert first.id != second.id
    assert first.slug != second.slug
    assert service.create_calls == 2
    assert len(service.records) == 2


@pytest.mark.asyncio
async def test_fetch_idempotent_reads_the_complete_workflow():
    service = _MemorySimpleWorkflows(lock_engine=_MemoryLock())
    key = "catalog:sha256:abc:prospect-research"
    created = await service.create_idempotent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        simple_workflow_create=_request(),
        idempotency_key=key,
    )

    fetched = await service.fetch_idempotent(
        project_id=PROJECT_ID,
        requested_slug="prospect-research",
        idempotency_key=key,
    )

    assert fetched.id == created.id
    assert fetched.revision_id == created.revision_id


@pytest.mark.asyncio
async def test_slug_is_derived_from_the_idempotency_key():
    service = _MemorySimpleWorkflows(lock_engine=_MemoryLock())
    key = "catalog:sha256:abc:prospect-research"

    workflow = await service.create_idempotent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        simple_workflow_create=_request(),
        idempotency_key=key,
    )

    expected = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
    assert workflow.slug == f"prospect-research-{expected}"


@pytest.mark.asyncio
async def test_empty_idempotency_key_is_rejected():
    service = _MemorySimpleWorkflows(lock_engine=_MemoryLock())

    with pytest.raises(ValueError, match="must not be empty"):
        await service.create_idempotent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            simple_workflow_create=_request(),
            idempotency_key=" ",
        )
