"""Unit tests for WP-A5: SkillImportService with an injected local fetcher.

No network, no DB — the fetcher copies a fixture tree, the workflows service
and the sources DAO are in-memory stubs."""

import shutil
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
from uuid import uuid4

import pytest

from oss.src.core.skills.fetcher import FetchedSource
from oss.src.core.skills.import_service import SkillImportService
from oss.src.core.skills.sources_dtos import SkillSource, SkillSourceLink

PROJECT_ID = uuid4()
USER_ID = uuid4()


class LocalFetcher:
    def __init__(self, fixture_root: Path, commit_sha: str = "abc1234"):
        self.fixture_root = fixture_root
        self.commit_sha = commit_sha

    async def fetch(
        self, *, repo_url: str, ref: Optional[str], dest: Path
    ) -> FetchedSource:
        root = dest / "tree"
        shutil.copytree(self.fixture_root, root)
        return FetchedSource(root=root, commit_sha=self.commit_sha)


class _StubCreated:
    def __init__(self):
        self.id = uuid4()


class _StubWorkflowsService:
    def __init__(self, existing_slugs: Optional[set] = None):
        self.existing_slugs = existing_slugs or set()
        self.created = []
        self.commits = []

    async def fetch_workflow(self, *, project_id, workflow_ref):
        if workflow_ref.slug in self.existing_slugs:
            return object()
        return None

    async def commit_workflow_revision_checked(
        self, *, project_id, user_id, workflow_revision_commit
    ):
        self.commits.append(workflow_revision_commit)
        return SimpleNamespace(
            revision=SimpleNamespace(id=uuid4()),
            status="committed",
            warnings=[],
        )


class _StubSimpleWorkflowsService:
    def __init__(self, existing_slugs: Optional[set] = None):
        self.workflows_service = _StubWorkflowsService(existing_slugs)
        self.created = []
        # workflow_id -> current head payload (what `fetch` answers with)
        self.heads = {}

    async def create(self, *, project_id, user_id, simple_workflow_create):
        self.created.append(simple_workflow_create)
        created = _StubCreated()
        self.heads[created.id] = SimpleNamespace(
            data=SimpleNamespace(
                parameters=dict(simple_workflow_create.data.parameters)
            ),
            variant_id=uuid4(),
            revision_id=uuid4(),
        )
        return created

    async def fetch(self, *, project_id, workflow_id):
        return self.heads.get(workflow_id)


class _StubSourcesDAO:
    def __init__(self):
        self.sources = []
        self.links = []

    async def create_source(self, *, project_id, user_id, source_create):
        source = SkillSource(
            id=uuid4(),
            slug=source_create.slug,
            repo_url=source_create.repo_url,
            ref=source_create.ref,
            last_seen_commit_sha=source_create.last_seen_commit_sha,
            sync_enabled=source_create.sync_enabled,
        )
        self.sources.append(source)
        return source

    async def fetch_source(self, *, project_id, source_id):
        return next((s for s in self.sources if s.id == source_id), None)

    async def update_source(self, *, project_id, source_id, **updates):
        source = await self.fetch_source(project_id=project_id, source_id=source_id)
        if source is None:
            return None
        for key, value in updates.items():
            if value is not None:
                setattr(source, key, value)
        return source

    async def create_links(self, *, project_id, user_id, link_creates):
        links = [
            SkillSourceLink(
                id=uuid4(),
                source_id=link.source_id,
                workflow_id=link.workflow_id,
                path_in_repo=link.path_in_repo,
                imported_commit_sha=link.imported_commit_sha,
                content_hash=link.content_hash,
            )
            for link in link_creates
        ]
        self.links.extend(links)
        return links

    async def list_links(self, *, project_id, source_id):
        return [x for x in self.links if x.source_id == source_id]

    async def update_link(self, *, project_id, link_id, **updates):
        link = next((x for x in self.links if x.id == link_id), None)
        if link is None:
            return None
        for key, value in updates.items():
            if value is not None:
                setattr(link, key, value)
        return link


def _write_skill(root: Path, dirname: str, name: str, *, body: str = "Do the thing."):
    skill_dir = root / dirname
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: A test skill named {name}.\n---\n\n{body}\n"
    )
    return skill_dir


@pytest.fixture
def fixture_tree(tmp_path: Path) -> Path:
    root = tmp_path / "fixture"
    root.mkdir()
    _write_skill(root, "skills/alpha", "alpha")
    _write_skill(root, "skills/beta", "beta")
    (root / "skills/beta/reference.md").write_text("Extra reference.\n")
    # invalid: bad name (uppercase)
    _write_skill(root, "skills/broken", "Not A Valid Name")
    return root


def _service(fixture_tree: Path, *, existing_slugs: Optional[set] = None):
    simple = _StubSimpleWorkflowsService(existing_slugs)
    dao = _StubSourcesDAO()
    service = SkillImportService(
        simple_workflows_service=simple,
        sources_dao=dao,
        fetcher=LocalFetcher(fixture_tree),
    )
    return service, simple, dao


@pytest.mark.asyncio
async def test_scan_source_reports_candidates(fixture_tree):
    service, _, _ = _service(fixture_tree)
    result = await service.scan_source(repo_url="github.com/acme/skills")

    assert result.commit_sha == "abc1234"
    by_path = {c.path_in_repo: c for c in result.scan.candidates}
    assert by_path["skills/alpha"].valid
    assert by_path["skills/beta"].valid
    assert not by_path["skills/broken"].valid


@pytest.mark.asyncio
async def test_import_creates_workflows_and_links(fixture_tree):
    service, simple, dao = _service(fixture_tree)
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
    )

    assert {i.name for i in result.imported} == {"alpha", "beta"}
    assert {s.path_in_repo for s in result.skipped} == {"skills/broken"}

    assert len(simple.created) == 2
    create = next(c for c in simple.created if c.slug == "alpha")
    assert create.flags.is_skill is True
    assert create.flags.is_snippet is True
    assert create.data.parameters["skill"]["name"] == "alpha"
    assert "Do the thing." in create.data.parameters["skill"]["body"]

    assert len(dao.links) == 2
    link = next(x for x in dao.links if x.path_in_repo == "skills/alpha")
    assert link.source_id == result.source.id
    assert link.imported_commit_sha == "abc1234"
    assert len(link.content_hash) == 64


@pytest.mark.asyncio
async def test_import_respects_path_selection(fixture_tree):
    service, simple, _ = _service(fixture_tree)
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
        paths=["skills/alpha"],
    )

    assert [i.name for i in result.imported] == ["alpha"]
    assert len(simple.created) == 1


@pytest.mark.asyncio
async def test_import_skips_name_collisions(fixture_tree):
    service, simple, dao = _service(fixture_tree, existing_slugs={"alpha"})
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
    )

    assert {i.name for i in result.imported} == {"beta"}
    collision = next(s for s in result.skipped if s.path_in_repo == "skills/alpha")
    assert collision.issues[0].code == "name_collision"
    assert len(dao.links) == 1


@pytest.mark.asyncio
async def test_import_includes_extra_files(fixture_tree):
    service, simple, _ = _service(fixture_tree)
    await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
        paths=["skills/beta"],
    )

    create = simple.created[0]
    files = create.data.parameters["skill"]["files"]
    assert [f["path"] for f in files] == ["reference.md"]


# --- refresh (WP-A6) ---------------------------------------------------------


async def _import_then(fixture_tree: Path, service, **kwargs):
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
        **kwargs,
    )
    return result.source


def _statuses(result):
    return {x.path_in_repo: x.status for x in result.links}


@pytest.mark.asyncio
async def test_refresh_commits_changed_skills(fixture_tree):
    service, simple, dao = _service(fixture_tree)
    source = await _import_then(fixture_tree, service)

    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nDo the NEW thing.\n"
    )
    service.fetcher.commit_sha = "def5678"

    result = await service.refresh_source(
        project_id=PROJECT_ID, user_id=USER_ID, source_id=source.id
    )

    assert _statuses(result) == {
        "skills/alpha": "updated",
        "skills/beta": "unchanged",
    }
    assert len(simple.workflows_service.commits) == 1
    commit = simple.workflows_service.commits[0]
    assert commit.base_revision_id is not None
    assert commit.meta["skill_sync"]["source_id"] == str(source.id)
    assert commit.meta["skill_sync"]["commit_sha"] == "def5678"
    assert "Do the NEW thing." in commit.data.parameters["skill"]["body"]

    link = next(x for x in dao.links if x.path_in_repo == "skills/alpha")
    assert link.imported_commit_sha == "def5678"
    assert dao.sources[0].last_seen_commit_sha == "def5678"


@pytest.mark.asyncio
async def test_refresh_detaches_locally_edited_skills(fixture_tree):
    service, simple, dao = _service(fixture_tree)
    source = await _import_then(fixture_tree, service)

    # Hand-edit the workflow head after import.
    alpha_id = next(
        wid
        for wid, head in simple.heads.items()
        if head.data.parameters["skill"]["name"] == "alpha"
    )
    simple.heads[alpha_id].data.parameters["skill"]["body"] = "Edited by hand."

    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nUpstream change.\n"
    )

    result = await service.refresh_source(
        project_id=PROJECT_ID, user_id=USER_ID, source_id=source.id
    )

    assert _statuses(result)["skills/alpha"] == "detached"
    assert not simple.workflows_service.commits
    link = next(x for x in dao.links if x.path_in_repo == "skills/alpha")
    assert link.detached is True


@pytest.mark.asyncio
async def test_refresh_marks_paths_missing_in_source(fixture_tree):
    service, _, dao = _service(fixture_tree)
    source = await _import_then(fixture_tree, service)

    shutil.rmtree(fixture_tree / "skills/beta")

    result = await service.refresh_source(
        project_id=PROJECT_ID, user_id=USER_ID, source_id=source.id
    )

    assert _statuses(result)["skills/beta"] == "missing_in_source"
    link = next(x for x in dao.links if x.path_in_repo == "skills/beta")
    assert link.missing_in_source is True
    # The workflow itself is untouched.
    assert not any(
        x.status == "updated" for x in result.links if x.path_in_repo == "skills/beta"
    )


@pytest.mark.asyncio
async def test_refresh_skips_detached_links(fixture_tree):
    service, simple, dao = _service(fixture_tree)
    source = await _import_then(fixture_tree, service)

    link = next(x for x in dao.links if x.path_in_repo == "skills/alpha")
    link.detached = True
    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nUpstream change.\n"
    )

    result = await service.refresh_source(
        project_id=PROJECT_ID, user_id=USER_ID, source_id=source.id
    )

    assert _statuses(result)["skills/alpha"] == "detached"
    assert not simple.workflows_service.commits
