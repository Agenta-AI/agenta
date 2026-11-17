"""A commit stores no agent revision without its drive keys, and none that no run can use.

The entry rules are the SDK's (`invalid_drive_entry`, `invalid_home_drive`,
`invalid_session_drive`). Each slug must name a drive the saver may use
(`drive_not_found`); a shared agent lists no private drive (`drive_not_shared`); a
private agent's home passes the home rule (`home_drive_not_allowed`). The first agent
revision creates the agent's drive unless `home_drive` opts out. All answer 422.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.core.sharing.service as sharing_module
from oss.src.apis.fastapi.workflows.exceptions import handle_workflow_exceptions
from oss.src.core.applications.dtos import ApplicationRevision, SimpleApplicationEdit
from oss.src.core.applications.service import SimpleApplicationsService
from oss.src.core.mounts.dtos import Mount
from oss.src.core.sharing.dtos import AccessPolicy, MountVisibility, Visibility
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowEdit,
    WorkflowRevision,
    WorkflowRevisionCommit,
    WorkflowVariant,
)
from oss.src.core.workflows.service import SimpleWorkflowsService, WorkflowsService
from oss.src.core.workflows.types import (
    AgentDriveError,
    AgentDriveNotFoundError,
    AgentDriveNotSharedError,
    HomeDriveNotAllowedError,
    InvalidAgentDrivesError,
    InvalidHomeDriveError,
    InvalidSessionDriveError,
    MountLookupMissing,
)
from oss.tests.pytest.utils.sharing import SharingWorld

AGENT_ID = uuid4()


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


class _Drives:
    """The mounts service calls the commit makes, over the sharing world's rows."""

    def __init__(self, world: SharingWorld):
        self.world = world
        self.by_slug = {}
        self.own = None
        self.created = []
        self.looked_up = []

    def add(self, slug, policy=None, agent_id=None) -> Mount:
        mount = Mount(
            id=uuid4(),
            project_id=self.world.project_id,
            storage_prefix="p",
            slug=slug,
            name=slug,
            agent_id=str(agent_id) if agent_id else None,
        )
        self.by_slug[slug] = mount
        self.world.dao.mounts[(self.world.project_id, mount.id)] = MountVisibility(
            mount_id=mount.id, slug=slug, agent_id=mount.agent_id, policy=policy
        )
        return mount

    async def fetch_mount_by_slug(self, *, project_id, slug):
        self.looked_up.append((project_id, slug))
        return self.by_slug.get(slug)

    async def fetch_agent_drive(self, *, project_id, artifact_id):
        return self.own

    async def create_agent_drive(
        self, *, project_id, user_id, artifact_id, agent_slug, agent_name, visibility
    ):
        self.created.append({"slug": agent_slug, "visibility": visibility})
        self.own = self.add(f"{agent_slug}-files", visibility, agent_id=artifact_id)
        return self.own


@pytest.fixture
def world(monkeypatch) -> SharingWorld:
    world = SharingWorld()
    monkeypatch.setattr(sharing_module, "_sharing_service", world.service)
    return world


@pytest.fixture
def drives(world) -> _Drives:
    drives = _Drives(world)
    drives.add("price-lists")
    return drives


def _service(drives):
    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = None
    workflows_dao.fetch_variant.return_value = None
    workflows_dao.commit_revision.return_value = None
    service = WorkflowsService(workflows_dao=workflows_dao)
    service.fetch_workflow = AsyncMock(
        return_value=SimpleNamespace(slug="quote", name="Quote")
    )
    service.set_mount_lookup(drives)
    return service, workflows_dao


def _commit(**agent):
    return WorkflowRevisionCommit(
        slug="drive-check",
        workflow_id=AGENT_ID,
        workflow_variant_id=uuid4(),
        data={
            "uri": "agenta:builtin:agent:v0",
            "parameters": {"agent": {"llm": {"model": "gpt-5.5"}, **agent}},
        },
    )


def _stored_agent(dao) -> dict:
    commit = dao.commit_revision.await_args.kwargs["revision_commit"]
    return commit.data["parameters"]["agent"]


async def _refusal(service, world, commit) -> AgentDriveError:
    with pytest.raises(AgentDriveError) as caught:
        await service.commit_workflow_revision(
            project_id=world.project_id,
            user_id=uuid4(),
            workflow_revision_commit=commit,
        )
    return caught.value


async def _commit_ok(service, world, commit):
    await service.commit_workflow_revision(
        project_id=world.project_id,
        user_id=uuid4(),
        workflow_revision_commit=commit,
    )


# -- the entry rules ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "agent, error_type, field",
    [
        ({"drives": "x"}, InvalidAgentDrivesError, "parameters.agent.drives"),
        (
            {"drives": [{"slug": f"d{i}"} for i in range(9)]},
            InvalidAgentDrivesError,
            "parameters.agent.drives",
        ),
        ({"drives": [{}]}, InvalidAgentDrivesError, "parameters.agent.drives[0].slug"),
        (
            {"drives": [{"kind": "agent"}]},
            InvalidAgentDrivesError,
            "parameters.agent.drives[0].kind",
        ),
        (
            {"drives": [{"slug": "a"}, {"slug": "a"}]},
            InvalidAgentDrivesError,
            "parameters.agent.drives[1].slug",
        ),
        (
            {"drives": [{"slug": "a", "access": "write"}]},
            InvalidAgentDrivesError,
            "parameters.agent.drives[0].access",
        ),
        (
            {"drives": [{"slug": "price-lists"}], "home_drive": "missing"},
            InvalidHomeDriveError,
            "parameters.agent.home_drive",
        ),
        (
            {
                "drives": [{"slug": "price-lists", "access": "read"}],
                "home_drive": "price-lists",
            },
            InvalidHomeDriveError,
            "parameters.agent.home_drive",
        ),
        (
            {"has_session_drive": "yes"},
            InvalidSessionDriveError,
            "parameters.agent.has_session_drive",
        ),
    ],
)
async def test_a_broken_configuration_is_refused_before_any_write(
    world, drives, agent, error_type, field
):
    service, dao = _service(drives)
    error = await _refusal(service, world, _commit(**agent))
    assert isinstance(error, error_type)
    detail = error.to_detail()
    assert detail["retryable"] is False
    assert detail["next_step"]
    assert detail["details"]["field"] == field
    dao.commit_revision.assert_not_awaited()
    assert drives.created == []


async def test_invalid_home_drive_names_its_next_step(world, drives):
    service, _ = _service(drives)
    error = await _refusal(
        service, world, _commit(drives=[{"slug": "price-lists"}], home_drive="x")
    )
    assert error.to_detail()["code"] == "invalid_home_drive"
    assert error.next_step == (
        "Set home_drive to the slug of a read-write entry of drives, or to null."
    )


# -- the drive lookups --------------------------------------------------------------------


async def test_a_missing_drive_is_refused_with_its_slug(world, drives):
    service, dao = _service(drives)
    error = await _refusal(
        service,
        world,
        _commit(
            drives=[{"slug": "price-lists", "access": "read"}, {"slug": "missing"}],
            home_drive=None,
        ),
    )
    assert isinstance(error, AgentDriveNotFoundError)
    assert error.to_detail() == {
        "code": "drive_not_found",
        "message": "The drive 'missing' does not exist in this project.",
        "retryable": False,
        "next_step": "Create the drive with POST /mounts/, then commit again.",
        "details": {"field": "parameters.agent.drives[1].slug", "value": "missing"},
    }
    assert [slug for _, slug in drives.looked_up] == ["price-lists", "missing"]
    assert {project for project, _ in drives.looked_up} == {world.project_id}
    dao.commit_revision.assert_not_awaited()


async def test_a_private_drive_the_saver_may_not_use_reads_as_missing(world, drives):
    drives.add("bobs-notes", _private(uuid4()))
    service, _ = _service(drives)
    error = await _refusal(
        service, world, _commit(drives=[{"slug": "bobs-notes"}], home_drive=None)
    )
    assert isinstance(error, AgentDriveNotFoundError)


async def test_a_shared_agent_lists_no_private_drive(world, drives, monkeypatch):
    owner = world.add_member(uuid4())
    drives.add("my-notes", _private(owner))
    service, _ = _service(drives)

    async def saver_may_use(*, project_id, mount_id, context=None):
        return True

    monkeypatch.setattr(world.service, "may_use_mount", saver_may_use)
    error = await _refusal(
        service, world, _commit(drives=[{"slug": "my-notes"}], home_drive=None)
    )
    assert isinstance(error, AgentDriveNotSharedError)
    assert error.next_step == "Make the agent private, or attach a shared drive."


async def test_a_private_agents_home_must_be_its_owners_private_drive(
    world, drives, monkeypatch
):
    owner = uuid4()
    world.dao.add_agent(
        project_id=world.project_id, artifact_id=AGENT_ID, policy=_private(owner)
    )
    service, dao = _service(drives)
    error = await _refusal(
        service,
        world,
        _commit(drives=[{"slug": "price-lists"}], home_drive="price-lists"),
    )
    assert isinstance(error, HomeDriveNotAllowedError)
    assert error.to_detail()["code"] == "home_drive_not_allowed"
    assert error.next_step == (
        "Set home_drive to a private drive you own, or to null. Attach shared "
        "drives without making them home."
    )
    # The same shared drive, not as home, is allowed.
    await _commit_ok(
        service, world, _commit(drives=[{"slug": "price-lists"}], home_drive=None)
    )
    dao.commit_revision.assert_awaited_once()


async def test_without_a_lookup_an_agent_commit_fails_closed(world):
    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = None
    service = WorkflowsService(workflows_dao=workflows_dao)
    with pytest.raises(MountLookupMissing):
        await service.commit_workflow_revision(
            project_id=world.project_id,
            user_id=uuid4(),
            workflow_revision_commit=_commit(
                drives=[{"slug": "price-lists"}], home_drive=None
            ),
        )
    workflows_dao.commit_revision.assert_not_awaited()


async def test_a_workflow_that_is_not_an_agent_is_left_alone(world, drives):
    service, dao = _service(drives)
    commit = WorkflowRevisionCommit(
        slug="plain",
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        data={"parameters": {"prompt": {"drives": "anything"}}},
    )
    await _commit_ok(service, world, commit)
    dao.commit_revision.assert_awaited_once()
    assert drives.looked_up == []


# -- creation and the fill ----------------------------------------------------------------


async def test_the_first_agent_revision_creates_the_agents_drive(world, drives):
    service, dao = _service(drives)
    await _commit_ok(service, world, _commit())
    assert drives.created == [
        {"slug": "quote", "visibility": AccessPolicy(visibility=Visibility.PROJECT)}
    ]
    agent = _stored_agent(dao)
    assert agent["drives"] == [{"slug": "quote-files"}]
    assert agent["home_drive"] == "quote-files"


async def test_a_new_drive_is_appended_to_a_stated_list(world, drives):
    service, dao = _service(drives)
    await _commit_ok(
        service, world, _commit(drives=[{"slug": "price-lists", "access": "read"}])
    )
    agent = _stored_agent(dao)
    assert agent["drives"] == [
        {"slug": "price-lists", "access": "read"},
        {"slug": "quote-files"},
    ]
    assert agent["home_drive"] == "quote-files"


async def test_the_new_drive_gets_the_visibility_the_agent_will_have(world, drives):
    owner = uuid4()
    service, _ = _service(drives)
    await service.commit_workflow_revision(
        project_id=world.project_id,
        user_id=uuid4(),
        workflow_revision_commit=_commit(),
        first_agent_owner_user_id=owner,
    )
    assert drives.created[0]["visibility"] == AccessPolicy(
        visibility=Visibility.PROJECT, owner_user_id=owner
    )

    drives.own = None
    world.dao.add_agent(
        project_id=world.project_id, artifact_id=AGENT_ID, policy=_private(owner)
    )
    await world.service.fetch_agent_policy_cached(
        project_id=world.project_id, artifact_id=AGENT_ID
    )
    service, _ = _service(drives)

    async def owner_may_use(*, project_id, mount_id, context=None):
        return True

    world.service.may_use_mount = owner_may_use
    # A private agent's new drive is private to its owner, so it passes the home rule.
    await service.commit_workflow_revision(
        project_id=world.project_id,
        user_id=uuid4(),
        workflow_revision_commit=_commit(),
    )
    assert drives.created[1]["visibility"] == _private(owner)


@pytest.mark.parametrize("home", [None, "price-lists"])
async def test_a_stated_home_drive_creates_no_drive(world, drives, home):
    service, dao = _service(drives)
    await _commit_ok(
        service, world, _commit(drives=[{"slug": "price-lists"}], home_drive=home)
    )
    assert drives.created == []
    assert _stored_agent(dao)["home_drive"] == home


async def test_a_retried_commit_creates_one_drive(world, drives):
    service, _ = _service(drives)
    await _commit_ok(service, world, _commit())
    await _commit_ok(service, world, _commit())
    assert len(drives.created) == 1


async def test_a_commit_without_drives_fills_the_own_drive(world, drives):
    drives.own = drives.add("__ag__agent__x__default", agent_id=AGENT_ID)
    service, dao = _service(drives)
    await _commit_ok(service, world, _commit())
    agent = _stored_agent(dao)
    assert agent["drives"] == [{"slug": "__ag__agent__x__default"}]
    assert agent["home_drive"] == "__ag__agent__x__default"
    assert agent["has_session_drive"] is True
    assert drives.created == []


async def test_the_fill_gives_no_drive_when_the_home_rule_refuses(world, drives):
    owner = uuid4()
    world.dao.add_agent(
        project_id=world.project_id, artifact_id=AGENT_ID, policy=_private(owner)
    )
    drives.own = drives.add("quote-files", AccessPolicy(visibility=Visibility.PROJECT))
    service, dao = _service(drives)
    await _commit_ok(service, world, _commit(home_drive=None))
    agent = _stored_agent(dao)
    assert agent["drives"] == []
    assert agent["home_drive"] is None


async def test_reading_an_older_revision_fills_its_keys(world, drives):
    drives.own = drives.add("quote-files", agent_id=AGENT_ID)
    service, _ = _service(drives)
    revision = WorkflowRevision(
        id=uuid4(),
        slug="old",
        version="1",
        workflow_id=AGENT_ID,
        flags={"is_agent": True},
        data={"parameters": {"agent": {"llm": {"model": "m"}}}},
    )
    read = await service._normalize_revision_for_read(
        project_id=world.project_id,
        revision=revision,
        workflow=SimpleNamespace(flags=None),
    )
    agent = read.data.parameters["agent"]
    assert agent["drives"] == [{"slug": "quote-files"}]
    assert agent["home_drive"] == "quote-files"


async def test_reading_an_older_revision_without_a_drive_keeps_it_legacy(world, drives):
    service, _ = _service(drives)
    revision = WorkflowRevision(
        id=uuid4(),
        slug="old",
        version="1",
        workflow_id=AGENT_ID,
        flags={"is_agent": True},
        data={"parameters": {"agent": {"llm": {"model": "m"}}}},
    )
    read = await service._normalize_revision_for_read(
        project_id=world.project_id,
        revision=revision,
        workflow=SimpleNamespace(flags=None),
    )
    assert "drives" not in read.data.parameters["agent"]
    assert drives.created == []


# -- the routes and the early checks ------------------------------------------------------


@pytest.mark.parametrize(
    "error",
    [
        InvalidAgentDrivesError(field="drives", value=1, message="m", next_step="n"),
        InvalidHomeDriveError(field="home_drive", value=1, message="m", next_step="n"),
        AgentDriveNotFoundError(
            field="drives[0].slug", value="x", message="m", next_step="n"
        ),
        AgentDriveNotSharedError(
            field="drives[0].slug", value="x", message="m", next_step="n"
        ),
        HomeDriveNotAllowedError(
            field="home_drive", value="x", message="m", next_step="n"
        ),
    ],
)
async def test_the_routes_answer_422_with_the_envelope(error):
    @handle_workflow_exceptions()
    async def route():
        raise error

    with pytest.raises(HTTPException) as caught:
        await route()
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == error.code


_MISSING_DRIVE = {
    "uri": "agenta:builtin:agent:v0",
    "parameters": {"agent": {"drives": [{"slug": "missing"}], "home_drive": None}},
}


def _simple_service(drives):
    service, _ = _service(drives)
    workflows_service = AsyncMock()
    workflows_service.reject_unusable_agent_drives = (
        service.reject_unusable_agent_drives
    )
    return SimpleWorkflowsService(
        workflows_service=workflows_service
    ), workflows_service


async def test_simple_create_refuses_before_any_write(world, drives):
    simple, workflows_service = _simple_service(drives)
    with pytest.raises(AgentDriveNotFoundError):
        await simple.create(
            project_id=world.project_id,
            user_id=uuid4(),
            simple_workflow_create=SimpleWorkflowCreate(
                slug="drive-check", data=_MISSING_DRIVE
            ),
        )
    workflows_service.create_workflow.assert_not_awaited()


async def test_idempotent_create_refuses_before_any_write(world, drives):
    simple, workflows_service = _simple_service(drives)
    workflows_service.fetch_workflow = AsyncMock(return_value=None)
    with pytest.raises(AgentDriveNotFoundError):
        await simple.create_idempotent(
            project_id=world.project_id,
            user_id=uuid4(),
            namespace="ns",
            request_key="key",
            request_fingerprint="fp",
            component="agent",
            simple_workflow_create=SimpleWorkflowCreate(
                slug="drive-check", data=_MISSING_DRIVE
            ),
        )
    workflows_service.create_workflow.assert_not_awaited()


async def test_simple_edit_refuses_before_any_write(world, drives):
    simple, workflows_service = _simple_service(drives)
    with pytest.raises(AgentDriveNotFoundError):
        await simple.edit(
            project_id=world.project_id,
            user_id=uuid4(),
            simple_workflow_edit=SimpleWorkflowEdit(id=uuid4(), data=_MISSING_DRIVE),
        )
    workflows_service.edit_workflow.assert_not_awaited()


async def test_simple_edit_without_data_reads_the_current_revision_once(world, drives):
    simple, workflows_service = _simple_service(drives)
    variant_id = uuid4()
    workflows_service.fetch_workflow_variant = AsyncMock(
        return_value=WorkflowVariant(id=variant_id, slug="default")
    )
    workflows_service.fetch_workflow_revision = AsyncMock(
        return_value=WorkflowRevision(id=uuid4(), slug="head", data=_MISSING_DRIVE)
    )
    with pytest.raises(AgentDriveNotFoundError):
        await simple.edit(
            project_id=world.project_id,
            user_id=uuid4(),
            simple_workflow_edit=SimpleWorkflowEdit(id=uuid4(), name="Renamed"),
        )
    workflows_service.fetch_workflow_revision.assert_awaited_once()
    assert (
        workflows_service.fetch_workflow_revision.await_args.kwargs[
            "workflow_variant_ref"
        ].id
        == variant_id
    )
    workflows_service.edit_workflow.assert_not_awaited()
    workflows_service.commit_workflow_revision.assert_not_awaited()


async def test_simple_edit_applies_the_agents_rules_before_any_write(
    world, drives, monkeypatch
):
    """A rename of a shared agent with a private drive attached is refused before the
    rename is stored: the early check knows the agent."""
    owner = world.add_member(uuid4())
    drives.add("my-notes", _private(owner))

    async def saver_may_use(*, project_id, mount_id, context=None):
        return True

    monkeypatch.setattr(world.service, "may_use_mount", saver_may_use)
    simple, workflows_service = _simple_service(drives)
    workflows_service.fetch_workflow = AsyncMock(
        return_value=SimpleNamespace(id=AGENT_ID, flags=None, meta=None, tags=None)
    )
    with pytest.raises(AgentDriveNotSharedError):
        await simple.edit(
            project_id=world.project_id,
            user_id=uuid4(),
            simple_workflow_edit=SimpleWorkflowEdit(
                id=AGENT_ID,
                name="Renamed",
                data={
                    "uri": "agenta:builtin:agent:v0",
                    "parameters": {
                        "agent": {"drives": [{"slug": "my-notes"}], "home_drive": None}
                    },
                },
            ),
        )
    workflows_service.edit_workflow.assert_not_awaited()


async def test_application_rename_without_data_is_refused_before_the_rename(
    world, drives
):
    service, _ = _service(drives)
    applications_service = AsyncMock()
    applications_service.workflows_service = service
    applications_service.fetch_application = AsyncMock(
        return_value=SimpleNamespace(id=uuid4(), flags=None, meta=None, tags=None)
    )
    applications_service.fetch_application_variant = AsyncMock(
        return_value=SimpleNamespace(id=uuid4())
    )
    applications_service.fetch_application_revision = AsyncMock(
        return_value=ApplicationRevision(id=uuid4(), slug="head", data=_MISSING_DRIVE)
    )
    simple = SimpleApplicationsService(applications_service=applications_service)
    with pytest.raises(AgentDriveNotFoundError):
        await simple.edit(
            project_id=world.project_id,
            user_id=uuid4(),
            simple_application_edit=SimpleApplicationEdit(id=uuid4(), name="Renamed"),
        )
    applications_service.fetch_application_revision.assert_awaited_once()
    applications_service.edit_application.assert_not_awaited()
    applications_service.commit_application_revision.assert_not_awaited()
