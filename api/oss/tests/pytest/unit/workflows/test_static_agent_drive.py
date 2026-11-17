"""A static catalog agent's own drive is created at its first run in a project.

The agent has no row and is never committed, so the commit never creates its drive. The
run credential mint (`resolve_run_agent_id`) creates the first `drives` entry whose slug
is `<agent slug>__<name>`: shared, no owner, named after the catalog revision.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.core.sharing.service as sharing_module
import oss.src.core.workflows.service as workflows_module
from oss.src.core.mounts.dtos import MountCreate
from oss.src.core.mounts.service import MountsService
from oss.src.core.sharing.dtos import OWNERLESS_PROJECT_POLICY
from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowRevisionData
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog
from oss.tests.pytest.unit.mounts.test_agent_drives import InMemoryMountsDAO
from oss.tests.pytest.utils.sharing import SharingWorld

AGENT_SLUG = "__ag__test_agent"
DRIVE_SLUG = "__ag__test_agent__learning"


def _catalog(agent: dict) -> StaticWorkflowCatalog:
    return StaticWorkflowCatalog(
        catalog={
            AGENT_SLUG: {
                "kind": "agent_config",
                "embeddable": False,
                "latest": "v1",
                "versions": {
                    "v1": WorkflowRevision(
                        name="Test agent",
                        data=WorkflowRevisionData(
                            uri="agenta:builtin:agent:v0",
                            parameters={"agent": agent},
                        ),
                    )
                },
            }
        }
    )


class _Access:
    """The access service calls the mint makes: the decision and the acting user."""

    def __init__(self, user_id, allowed=True):
        self.user_id = user_id
        self.allowed = allowed

    async def decide(self, **kwargs):
        return SimpleNamespace(allowed=self.allowed)

    async def acting_user_id(self, *, authority):
        return self.user_id


@pytest.fixture
def world(monkeypatch) -> SharingWorld:
    world = SharingWorld()
    monkeypatch.setattr(sharing_module, "_sharing_service", world.service)
    return world


@pytest.fixture
def access(monkeypatch) -> _Access:
    access = _Access(uuid4())
    monkeypatch.setattr(workflows_module, "get_access_service", lambda: access)
    return access


def _service(agent: dict):
    catalog = _catalog(agent)
    service = WorkflowsService(workflows_dao=AsyncMock(), static_catalog=catalog)
    service.fetch_workflow = AsyncMock(return_value=None)
    dao = InMemoryMountsDAO()
    service.set_mount_lookup(MountsService(mounts_dao=dao))
    artifact_id = catalog.retrieve_revision(slug=AGENT_SLUG).workflow_id
    return service, dao, artifact_id


async def _mint(service, world, artifact_id):
    return await service.resolve_run_agent_id(
        project_id=world.project_id,
        envelope=SimpleNamespace(
            authority=SimpleNamespace(principal=None), context=None
        ),
        references=None,
        admitted_agent_id=artifact_id,
    )


async def test_the_first_run_creates_the_listed_drive(world, access):
    service, dao, artifact_id = _service(
        {"drives": [{"slug": DRIVE_SLUG}], "home_drive": None}
    )

    assert await _mint(service, world, artifact_id) == artifact_id

    [mount] = dao.mounts.values()
    assert mount.slug == DRIVE_SLUG
    assert mount.name == "Test agent"
    assert mount.agent_id == str(artifact_id)
    assert dao.visibility[mount.id] == OWNERLESS_PROJECT_POLICY
    # The runner signs the drive by the slug the configuration lists.
    found = await service._require_mount_lookup().fetch_mount_by_slug(
        project_id=world.project_id, slug=DRIVE_SLUG
    )
    assert found.id == mount.id


async def test_a_later_run_finds_the_drive_with_one_lookup(world, access):
    service, dao, artifact_id = _service(
        {"drives": [{"slug": DRIVE_SLUG}], "home_drive": None}
    )
    await _mint(service, world, artifact_id)
    service.fetch_workflow.reset_mock()

    await _mint(service, world, artifact_id)

    assert dao.create_agent_calls == 1
    assert len(dao.mounts) == 1
    service.fetch_workflow.assert_not_awaited()


async def test_a_user_drive_with_a_similar_slug_does_not_break_it(world, access):
    service, dao, artifact_id = _service(
        {"drives": [{"slug": DRIVE_SLUG}], "home_drive": None}
    )
    mounts = service._require_mount_lookup()
    # A user's drive can never take the reserved slug, only a similar one.
    await mounts.create_mount(
        project_id=world.project_id,
        user_id=uuid4(),
        mount_create=MountCreate(slug="ag-test-agent-learning", name="learning"),
    )

    await _mint(service, world, artifact_id)

    found = await mounts.fetch_mount_by_slug(
        project_id=world.project_id, slug=DRIVE_SLUG
    )
    assert found.agent_id == str(artifact_id)
    assert len(dao.mounts) == 2


async def test_only_an_entry_under_the_agent_slug_is_created(world, access):
    service, dao, artifact_id = _service(
        {"drives": [{"slug": "team-notes"}], "home_drive": None}
    )

    await _mint(service, world, artifact_id)

    assert dao.mounts == {}


async def test_a_run_the_principal_may_not_run_creates_nothing(world, access):
    access.allowed = False
    service, dao, artifact_id = _service(
        {"drives": [{"slug": DRIVE_SLUG}], "home_drive": None}
    )

    assert await _mint(service, world, artifact_id) is None
    assert dao.mounts == {}


async def test_a_stored_agent_costs_no_lookup(world, access):
    service, dao, _ = _service({"drives": [{"slug": DRIVE_SLUG}]})
    stored_agent = uuid4()

    assert await _mint(service, world, stored_agent) == stored_agent
    assert dao.create_agent_calls == 0
    assert dao.mounts == {}


async def test_a_failed_create_does_not_fail_the_mint(world, access):
    service, dao, artifact_id = _service(
        {"drives": [{"slug": DRIVE_SLUG}], "home_drive": None}
    )
    dao.create_agent_mount = AsyncMock(side_effect=RuntimeError("database down"))

    assert await _mint(service, world, artifact_id) == artifact_id
