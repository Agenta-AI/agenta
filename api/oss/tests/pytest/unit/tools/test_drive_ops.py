"""The builder's drive reads, `list_agent_drives` and `read_drive` (design D26).

The access decisions are real: an `AccessService` and a `SharingService` over in-memory
rows decide the run authority's `VIEW_MOUNTS` on each drive and the D11 rule. The agent
lookup and the drive files are stubbed, because other cells cover them.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from agenta.sdk.agents.platform.op_catalog import (
    PLATFORM_OPS,
    READ_DRIVE_MAX_ENTRIES,
    READ_DRIVE_TEXT_MAX_BYTES,
)
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.mounts.dtos import MountFile, MountFileContent, MountFileList
from oss.src.core.mounts.service import validate_file_path
from oss.src.core.mounts.types import MountFileNotFound, MountFileTooLarge
from oss.src.core.sharing.dtos import AccessPolicy, SessionRole, Visibility
from oss.src.core.tools import platform_handlers
from oss.src.core.tools.platform_handlers import (
    LIST_AGENT_DRIVES_CALL_REF,
    PLATFORM_TOOL_HANDLERS,
    READ_DRIVE_CALL_REF,
    RUN_CREDENTIAL_REQUIRED,
    dispatch_platform_tool_handler,
)
from oss.src.core.workflows.builder_agent import (
    BUILDER_AGENT_SLUG,
    BUILDER_AGENT_TOOLS,
)
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import (
    InMemoryPrincipalsDAO,
    make_envelope,
    make_request_access,
)
from oss.tests.pytest.utils.sharing import NoopRunAdmission, SharingWorld

CATALOG = StaticWorkflowCatalog()
BUILDER_ID = CATALOG.retrieve_revision(slug=BUILDER_AGENT_SLUG).artifact_id


class _Mounts:
    """The mounts service calls the drive ops make, over dicts, scoped by project."""

    def __init__(self, project_id) -> None:
        self.project_id = project_id
        self.mounts = {}
        self.files = {}  # (mount_id, path) -> text, or an exception to raise
        self.listings = {}  # (mount_id, path or None) -> [MountFile]

    def add(self, visibility, *, slug, name, session_id=None):
        mount = SimpleNamespace(
            id=visibility.mount_id,
            slug=slug,
            name=name,
            session_id=session_id,
            deleted_at=None,
        )
        self.mounts[mount.id] = mount
        return mount

    async def fetch_mount(self, *, project_id, mount_id):
        return self.mounts.get(mount_id) if project_id == self.project_id else None

    async def fetch_mount_by_slug(self, *, project_id, slug):
        if project_id != self.project_id:
            return None
        return next(
            (
                m
                for m in self.mounts.values()
                if m.slug == slug and m.session_id is None
            ),
            None,
        )

    async def read_file(self, *, project_id, mount_id, path):
        validate_file_path(path)  # The service's own path check.
        value = self.files.get((mount_id, path))
        if value is None:
            raise MountFileNotFound()
        if isinstance(value, Exception):
            raise value
        return MountFileContent(path=path, content=value)

    async def list_files(self, *, project_id, mount_id, path=None, **_kwargs):
        return MountFileList(files=self.listings.get((mount_id, path), []))


class _World:
    """Ana and Ben in one project. Ana has a private session and a project-visible one.
    The tested agent "Email writer" lists a project drive, Ana's private drive and Ben's
    private drive, and its home drive is the project drive."""

    def __init__(self) -> None:
        self.world = SharingWorld()
        self.project_id = self.world.project_id
        self.ana = self.world.add_member(uuid4())
        self.ben = self.world.add_member(uuid4())
        principals = InMemoryPrincipalsDAO()
        for user in (self.ana, self.ben):
            principals.human(user)
        self.access = AccessService(
            memberships=self.world.service._memberships,
            rbac_entitlement=RecordingRbac(),
            principals=principals,
            resource_policy=self.world.service,
        )
        self.ana_private = self.world.add_session(policy=self.private(self.ana))
        self.ana_shared = self.world.add_session(
            policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=self.ana)
        )
        self.mounts = _Mounts(self.project_id)
        self.shared_drive = self._drive("email-drafts", "Email drafts", None)
        self.ana_drive = self._drive("ana-notes", "Ana notes", self.private(self.ana))
        self.ben_drive = self._drive("ben-notes", "Ben notes", self.private(self.ben))
        self.agent = SimpleNamespace(
            id=uuid4(), name="Email writer", slug="email-writer", description=None
        )
        self.head = self._head(
            drives=[
                {"slug": "email-drafts"},
                {"slug": "ana-notes"},
                {"slug": "ben-notes"},
                {"slug": "no-such-drive"},
            ],
            home_drive="email-drafts",
        )

    @staticmethod
    def private(owner) -> AccessPolicy:
        return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)

    def _drive(self, slug, name, policy, *, session_id=None):
        visibility = self.world.dao.add_mount(
            project_id=self.project_id, policy=policy, slug=slug, session_id=session_id
        )
        return self.mounts.add(visibility, slug=slug, name=name, session_id=session_id)

    @staticmethod
    def _head(**agent):
        return SimpleNamespace(data={"parameters": {"agent": agent}})

    def access_of(self, user, *, session, agent_id=BUILDER_ID, kind="run_credential"):
        envelope = make_envelope(
            kind="human",
            principal_id=user,
            project_id=self.project_id,
            organization_id=self.world.organization_id,
        )
        access = make_request_access(envelope=envelope, credential_kind=kind)
        return access.model_copy(
            update={"run_session_id": session.session_id, "run_agent_id": agent_id}
        )


@pytest.fixture
def world(monkeypatch) -> _World:
    import oss.src.core.access.service as access_module
    import oss.src.core.sharing.service as sharing_module

    world = _World()
    monkeypatch.setattr(access_module, "_access_service", world.access)
    monkeypatch.setattr(sharing_module, "_sharing_service", world.world.service)

    async def _resolve(**_kwargs):
        return world.agent, world.head

    async def _allowed(**_kwargs):
        return True

    monkeypatch.setattr(platform_handlers, "_resolve_other_agent", _resolve)
    monkeypatch.setattr(platform_handlers, "_allowed_on_agent", _allowed)
    return world


async def _call(world, call_ref, access, arguments):
    token = set_request_access(access)
    try:
        result = await dispatch_platform_tool_handler(
            call_ref=call_ref,
            arguments=arguments,
            headers={},
            project_id=world.project_id,
            user_id=access.acting_user_id,
            workflows_service=SimpleNamespace(static_catalog=CATALOG),
            tracing_service=None,
            run_admission=NoopRunAdmission(),
            mounts_service=world.mounts,
            access=access,
        )
    finally:
        reset_request_access(token)
    if result.ok:
        return result.content
    return result.content.model_dump(exclude_none=True)


async def _list(world, access):
    return await _call(
        world, LIST_AGENT_DRIVES_CALL_REF, access, {"agent": "email-writer"}
    )


async def _read(world, access, drive, path=None):
    arguments = {"drive_id": str(drive.id)}
    if path is not None:
        arguments["path"] = path
    return await _call(world, READ_DRIVE_CALL_REF, access, arguments)


def _slugs(content):
    return [drive["slug"] for drive in content["drives"]]


# -- the catalog and the registration ---------------------------------------------------


@pytest.mark.parametrize("op", ["list_agent_drives", "read_drive"])
def test_the_ops_are_read_only_builder_tools_that_bind_no_caller(op):
    entry = PLATFORM_OPS[op]
    registration = PLATFORM_TOOL_HANDLERS[entry.handler]

    assert entry.read_only
    assert entry.context_bindings == {}
    assert BUILDER_AGENT_TOOLS[op] == "allow"
    assert registration.needs_session_caller
    assert registration.needs_mounts
    # The mounts route's project check for a read.
    assert registration.elevated_permission == Permission.VIEW_MOUNTS
    assert entry.timeout_ms == registration.timeout_ms


# -- list_agent_drives ------------------------------------------------------------------


async def test_ana_lists_the_drives_she_can_see_from_her_private_session(world):
    content = await _list(world, world.access_of(world.ana, session=world.ana_private))

    assert content["agent"]["slug"] == "email-writer"
    assert content["drives"] == [
        {
            "drive_id": str(world.shared_drive.id),
            "slug": "email-drafts",
            "name": "Email drafts",
            "is_home": True,
        },
        {
            "drive_id": str(world.ana_drive.id),
            "slug": "ana-notes",
            "name": "Ana notes",
            "is_home": False,
        },
    ]


async def test_a_private_drive_of_another_owner_is_not_listed(world):
    """Ben's builder session: Ben's own drive shows, Ana's private drive does not."""
    ben_private = world.world.add_session(policy=world.private(world.ben))
    content = await _list(world, world.access_of(world.ben, session=ben_private))

    assert _slugs(content) == ["email-drafts", "ben-notes"]


async def test_a_private_drive_is_left_out_of_a_project_visible_session(world):
    """Ana's project-visible session: Ben reads it, so Ana's private drive stays out."""
    content = await _list(world, world.access_of(world.ana, session=world.ana_shared))

    assert _slugs(content) == ["email-drafts"]


async def test_a_configuration_without_drives_lists_none(world):
    """The revision read fills the drive keys of a configuration stored before drives
    were configurable; one still without `drives` mounts no drive at run time."""
    world.head = world._head(instructions={"agents_md": "x"})
    content = await _list(world, world.access_of(world.ana, session=world.ana_private))

    assert content["drives"] == []


async def test_a_session_working_folder_is_never_listed(world):
    """A configuration that names a session folder's slug resolves to no drive."""
    folder = world._drive(
        "__ag__session__cwd",
        "cwd",
        None,
        session_id=world.ana_private.session_id,
    )
    world.head = world._head(drives=[{"slug": folder.slug}], home_drive=None)
    content = await _list(world, world.access_of(world.ana, session=world.ana_private))

    assert content["drives"] == []


# -- read_drive -------------------------------------------------------------------------


async def test_read_the_root_folder_and_a_file(world):
    drive = world.shared_drive
    world.mounts.listings[(drive.id, None)] = [
        MountFile(path="drafts", is_folder=True),
        MountFile(path="README.md", size=12),
    ]
    world.mounts.files[(drive.id, "drafts/welcome.md")] = "Hello Sam,\n"
    access = world.access_of(world.ana, session=world.ana_shared)

    assert await _read(world, access, drive) == {
        "kind": "folder",
        "path": "",
        "entries": [
            {"path": "README.md", "kind": "file", "size": 12},
            {"path": "drafts", "kind": "folder"},
        ],
        "is_entry_list_truncated": False,
    }
    assert await _read(world, access, drive, "/drafts/welcome.md") == {
        "kind": "file",
        "path": "drafts/welcome.md",
        "text": "Hello Sam,\n",
        "is_truncated": False,
        "is_binary": False,
        "is_too_large": False,
    }


async def test_a_path_keeps_its_spaces(world):
    """A file name may start with a space; it never reads a file of another name."""
    drive = world.shared_drive
    world.mounts.files[(drive.id, "notes.md")] = "other file"
    world.mounts.files[(drive.id, " notes.md")] = "spaced file"
    access = world.access_of(world.ana, session=world.ana_shared)

    assert (await _read(world, access, drive, " notes.md"))["text"] == "spaced file"


async def test_read_a_sub_folder(world):
    drive = world.shared_drive
    world.mounts.listings[(drive.id, "drafts")] = [
        MountFile(path="drafts/welcome.md", size=11)
    ]
    content = await _read(
        world, world.access_of(world.ana, session=world.ana_shared), drive, "drafts"
    )

    assert content["kind"] == "folder"
    assert content["entries"] == [
        {"path": "drafts/welcome.md", "kind": "file", "size": 11}
    ]


async def test_a_long_file_is_cut_and_a_large_folder_is_capped(world):
    drive = world.shared_drive
    world.mounts.files[(drive.id, "long.txt")] = "é" * READ_DRIVE_TEXT_MAX_BYTES
    world.mounts.listings[(drive.id, None)] = [
        MountFile(path=f"f{i:04}.txt") for i in range(READ_DRIVE_MAX_ENTRIES + 1)
    ]
    access = world.access_of(world.ana, session=world.ana_shared)

    long = await _read(world, access, drive, "long.txt")
    assert long["is_truncated"] is True
    assert len(long["text"].encode("utf-8")) <= READ_DRIVE_TEXT_MAX_BYTES
    assert set(long["text"]) == {"é"}

    folder = await _read(world, access, drive)
    assert len(folder["entries"]) == READ_DRIVE_MAX_ENTRIES
    assert folder["is_entry_list_truncated"] is True


async def test_a_binary_file_and_a_file_above_the_route_cap_return_no_text(world):
    drive = world.shared_drive
    world.mounts.files[(drive.id, "logo.png")] = "�PNG\x00\x00"
    world.mounts.files[(drive.id, "dump.json")] = MountFileTooLarge(max_bytes=4)
    access = world.access_of(world.ana, session=world.ana_shared)

    assert await _read(world, access, drive, "logo.png") == {
        "kind": "file",
        "path": "logo.png",
        "text": None,
        "is_truncated": False,
        "is_binary": True,
        "is_too_large": False,
    }
    assert await _read(world, access, drive, "dump.json") == {
        "kind": "file",
        "path": "dump.json",
        "text": None,
        "is_truncated": False,
        "is_binary": False,
        "is_too_large": True,
    }


@pytest.mark.parametrize(
    "path",
    [
        "missing.md",
        "../escape.md",
        "drafts//x.md",
        ".git/config",
        "repo/.git/HEAD",
        "agents/claude/state.json",
        ".agenta-ready",
    ],
)
async def test_a_path_that_does_not_exist_answers_drive_file_not_found(world, path):
    """A missing path, a path the service refuses, and the `.git` plumbing and runner
    files that the folder answer hides."""
    for hidden in (".git/config", "repo/.git/HEAD", "agents/claude/state.json"):
        world.mounts.files[(world.shared_drive.id, hidden)] = "url = token"
    world.mounts.files[(world.shared_drive.id, ".agenta-ready")] = "1"
    content = await _read(
        world,
        world.access_of(world.ana, session=world.ana_shared),
        world.shared_drive,
        path,
    )

    assert content["code"] == "drive_file_not_found"
    assert content["next_step"] == (
        "Read the folder first, then pass a path from its entries."
    )


async def test_a_session_working_folder_answers_drive_not_found(world):
    """Check first of M12a: the mounts route lets Ana read her session's folder (a
    session drive follows its session). `read_drive` takes drives only."""
    folder = world._drive(
        "__ag__session__cwd", "cwd", None, session_id=world.ana_private.session_id
    )
    world.mounts.files[(folder.id, "notes.md")] = "private text"
    access = world.access_of(world.ana, session=world.ana_private)

    token = set_request_access(access)
    try:
        assert await platform_handlers._allowed_on_drive(
            project_id=world.project_id, mount_id=folder.id
        )
    finally:
        reset_request_access(token)
    content = await _read(world, access, folder, "notes.md")
    assert content["code"] == "drive_not_found"
    assert "text" not in content


async def test_an_archived_drive_answers_drive_not_found(world):
    drive = world.shared_drive
    drive.deleted_at = "2026-11-01T00:00:00Z"
    world.mounts.files[(drive.id, "notes.md")] = "archived text"
    content = await _read(
        world, world.access_of(world.ana, session=world.ana_shared), drive, "notes.md"
    )

    assert content["code"] == "drive_not_found"
    assert "text" not in content


async def test_a_private_drive_of_another_owner_answers_drive_not_found(world):
    world.mounts.files[(world.ben_drive.id, "notes.md")] = "Ben's text"
    content = await _read(
        world,
        world.access_of(world.ana, session=world.ana_private),
        world.ben_drive,
        "notes.md",
    )

    assert content["code"] == "drive_not_found"
    assert content["next_step"] == "List the drives with `list_agent_drives`."
    assert "text" not in content


async def test_a_drive_of_another_project_or_a_bad_id_answers_drive_not_found(world):
    access = world.access_of(world.ana, session=world.ana_private)
    other = SimpleNamespace(id=uuid4())
    assert (await _read(world, access, other))["code"] == "drive_not_found"
    content = await _call(world, READ_DRIVE_CALL_REF, access, {"drive_id": "nope"})
    assert content["code"] == "drive_not_found"


async def test_a_private_drive_read_into_a_project_visible_session_would_widen(world):
    world.mounts.files[(world.ana_drive.id, "notes.md")] = "Ana's text"
    access = world.access_of(world.ana, session=world.ana_shared)

    content = await _read(world, access, world.ana_drive, "notes.md")
    assert content["code"] == "sharing_would_widen"
    assert content["next_step"] == (
        "Ask the person to open the drive in a session that only they can see."
    )
    assert "text" not in content

    own = await _read(
        world,
        world.access_of(world.ana, session=world.ana_private),
        world.ana_drive,
        "notes.md",
    )
    assert own["text"] == "Ana's text"


# -- who may call -----------------------------------------------------------------------


@pytest.mark.parametrize("call_ref", [LIST_AGENT_DRIVES_CALL_REF, READ_DRIVE_CALL_REF])
async def test_an_agent_that_is_not_the_builder_is_refused(world, call_ref):
    access = world.access_of(world.ana, session=world.ana_private, agent_id=uuid4())
    arguments = {"agent": "email-writer", "drive_id": str(world.shared_drive.id)}

    content = await _call(world, call_ref, access, arguments)
    assert content["code"] == "agent_not_allowed"


@pytest.mark.parametrize("call_ref", [LIST_AGENT_DRIVES_CALL_REF, READ_DRIVE_CALL_REF])
@pytest.mark.parametrize("kind", ["bearer_session", "api_key"])
async def test_a_call_without_a_run_credential_is_refused(world, call_ref, kind):
    access = world.access_of(world.ana, session=world.ana_private, kind=kind)
    arguments = {"agent": "email-writer", "drive_id": str(world.shared_drive.id)}

    content = await _call(world, call_ref, access, arguments)
    assert content["code"] == RUN_CREDENTIAL_REQUIRED


# -- the D11 stand-in -------------------------------------------------------------------


async def test_a_grant_or_a_channel_makes_a_private_session_wider(world):
    service = world.world.service
    session = world.world.add_session(policy=world.private(world.ana))

    async def wider():
        return await service.session_wider_than_drive(
            project_id=world.project_id,
            session_id=session.session_id,
            mount_id=world.ana_drive.id,
        )

    assert not await wider()
    world.world.add_grant(state=session, user_id=world.ben, role=SessionRole.VIEWER)
    assert await wider()

    # A channel shows the text outside the project: wider than a project drive too.
    session = world.world.add_session(policy=world.private(world.ana), is_channel=True)
    assert await wider()
    assert await service.session_wider_than_drive(
        project_id=world.project_id,
        session_id=session.session_id,
        mount_id=world.shared_drive.id,
    )


@pytest.mark.parametrize("drive", ["shared_drive", "ana_drive"])
async def test_a_session_with_no_row_is_wider_than_any_drive(world, drive):
    assert await world.world.service.session_wider_than_drive(
        project_id=world.project_id,
        session_id=str(uuid4()),
        mount_id=getattr(world, drive).id,
    )


async def test_a_project_drive_is_not_narrower_than_a_project_visible_session(world):
    assert not await world.world.service.session_wider_than_drive(
        project_id=world.project_id,
        session_id=world.ana_shared.session_id,
        mount_id=world.shared_drive.id,
    )
