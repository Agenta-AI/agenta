from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

from oss.src.apis.fastapi.agent_templates import router as router_module
from oss.src.core.agent_templates.dtos import (
    GitHubTemplateSource,
    InternalTemplateSource,
    TemplateLoadCommand,
    TemplateSourcePin,
)
from oss.src.core.agent_templates.exceptions import (
    TemplateCreateConflict,
    TemplateProvenanceInvalid,
    TemplateSourceDigestMismatch,
    TemplateSourceUnavailable,
)
from oss.src.core.agent_templates.github import (
    GitHubPackageFetcher,
    GitHubPackageStager,
)
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.provenance import read_template_origin
from oss.src.core.agent_templates.sources import (
    InternalTemplateSourceResolver,
    StagedTemplateSourceResolver,
    TemplateSources,
    package_digest,
)
from oss.src.core.agent_templates.validation import AgentTemplateValidator
from oss.tests.pytest.unit.agent_templates.fake_github import (
    COMMIT,
    OTHER_COMMIT,
    PACKAGE_PATH,
    FakeGitHub,
    Symlink,
    nest,
    tree_from_directory,
)
from oss.tests.pytest.unit.agent_templates.test_loader import (
    PROJECT_ID,
    USER_ID,
    _base_revision,
    _loader,
)
from oss.tests.pytest.unit.agent_templates.test_router import (
    _app,
    _body,
    _post,
    _validate,
    _validation_app,
)


RESOURCES = (
    Path(__file__).resolve().parents[4] / "src" / "resources" / "agent_templates"
)
BUNDLED = RESOURCES / "packages" / "code-qa" / "1.0.0"
REPO_URL = "https://github.com/agenta-ai/agenta"


def _repository(package: dict | None = None) -> dict:
    tree = nest(PACKAGE_PATH, package or tree_from_directory(BUNDLED))
    tree["web"] = {f"file-{index}.ts": b"x" * 64 for index in range(500)}
    return tree


@pytest.fixture
def github() -> FakeGitHub:
    fake = FakeGitHub()
    fake.add_commit("agenta-ai/agenta", COMMIT, _repository())
    return fake


def _sources(fake: FakeGitHub) -> TemplateSources:
    fetcher = GitHubPackageFetcher(transport=httpx.MockTransport(fake.handler))
    return TemplateSources(
        internal=InternalTemplateSourceResolver(
            catalog_path=RESOURCES / "catalog.json"
        ),
        staged=StagedTemplateSourceResolver(
            stagers={"github": GitHubPackageStager(fetcher=fetcher)}
        ),
    )


def _source(**overrides) -> GitHubTemplateSource:
    return GitHubTemplateSource.model_validate(
        {"repo_url": REPO_URL, "commit": COMMIT, "path": PACKAGE_PATH, **overrides}
    )


def _command(
    *, initial_message="Please set yourself up.", **source
) -> TemplateLoadCommand:
    return TemplateLoadCommand(
        source=_source(**source),
        base_revision=_base_revision(),
        initial_message=initial_message,
        request_key="github-request",
    )


async def test_github_package_resolves_to_the_same_bytes_as_the_bundled_package(github):
    async with _sources(github).open(
        project_id=PROJECT_ID, source=_source()
    ) as resolved:
        package = TemplatePackageParser().parse(resolved)
        files = sorted(
            path.relative_to(resolved.root).as_posix()
            for path in resolved.root.rglob("*")
            if path.is_file()
        )
        root = resolved.root

    assert resolved.key == "code-qa"
    assert resolved.version == "1.0.0"
    assert resolved.digest == package_digest(BUNDLED)
    assert package.agent.name
    assert files == sorted(
        path.relative_to(BUNDLED).as_posix()
        for path in BUNDLED.rglob("*")
        if path.is_file()
    )
    assert not root.exists()


async def test_github_pin_mismatch_is_rejected(github):
    pin = TemplateSourcePin(version="1.0.0", digest="sha256:" + "0" * 64)

    with pytest.raises(TemplateSourceDigestMismatch):
        async with _sources(github).open(
            project_id=PROJECT_ID, source=_source(), pin=pin
        ):
            pass


async def test_validate_returns_the_pin_for_a_github_package(github):
    validator = AgentTemplateValidator(
        source_resolver=_sources(github), package_parser=TemplatePackageParser()
    )

    result = await validator.validate(project_id=PROJECT_ID, source=_source())

    assert result.valid is True
    assert result.version == "1.0.0"
    assert result.digest == package_digest(BUNDLED)


async def test_validate_reports_unsafe_github_entries_as_issues():
    fake = FakeGitHub()
    fake.add_commit(
        "agenta-ai/agenta",
        COMMIT,
        _repository({**tree_from_directory(BUNDLED), "link": Symlink("/etc/passwd")}),
    )
    validator = AgentTemplateValidator(
        source_resolver=_sources(fake), package_parser=TemplatePackageParser()
    )

    result = await validator.validate(project_id=PROJECT_ID, source=_source())

    assert result.valid is False
    assert [(issue.code, issue.path) for issue in result.issues] == [
        ("template_source_symlink", "link")
    ]


@pytest.mark.parametrize(
    "overrides",
    [
        {"repo_url": "https://github.com/agenta-ai/private"},
        {"path": "api/resources/packages/missing/1.0.0"},
    ],
)
async def test_validate_keeps_missing_or_private_sources_as_errors(github, overrides):
    validator = AgentTemplateValidator(
        source_resolver=_sources(github), package_parser=TemplatePackageParser()
    )

    with pytest.raises(TemplateSourceUnavailable):
        await validator.validate(project_id=PROJECT_ID, source=_source(**overrides))


def _github_loader(fake: FakeGitHub, **kwargs):
    loader, events, skills, workflows, _, mounts, starts = _loader(**kwargs)
    loader._source_resolver = _sources(fake)
    return loader, skills, workflows, mounts, starts


async def test_load_records_repository_commit_path_version_and_digest(github):
    loader, _, workflows, _, _ = _github_loader(github)

    result = await loader.load(
        project_id=PROJECT_ID, user_id=USER_ID, command=_command()
    )

    [workflow] = workflows.records.values()
    assert result.workflow_slug.startswith("code-qa-")
    assert read_template_origin(workflow.meta) == {
        "kind": "github",
        "key": "code-qa",
        "version": "1.0.0",
        "digest": package_digest(BUNDLED),
        "repo_url": REPO_URL,
        "commit": COMMIT,
        "path": PACKAGE_PATH,
    }


async def test_contribution_from_a_fork_head_loads_without_touching_the_catalog(github):
    github.add_commit(
        "contributor/agenta",
        OTHER_COMMIT,
        _repository({**tree_from_directory(BUNDLED), "NOTES.md": b"proposed change"}),
    )
    catalog = (RESOURCES / "catalog.json").read_bytes()
    loader, _, workflows, _, _ = _github_loader(github)

    await loader.load(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        command=_command(
            repo_url="https://github.com/contributor/agenta", commit=OTHER_COMMIT
        ),
    )

    [workflow] = workflows.records.values()
    origin = read_template_origin(workflow.meta)
    assert origin["repo_url"] == "https://github.com/contributor/agenta"
    assert origin["commit"] == OTHER_COMMIT
    assert origin["digest"] != package_digest(BUNDLED)
    assert (RESOURCES / "catalog.json").read_bytes() == catalog
    assert all("/contributor/agenta/" in r.url.path for r in github.requests)


async def test_missing_or_private_source_creates_nothing(github):
    loader, skills, workflows, mounts, starts = _github_loader(github)

    with pytest.raises(TemplateSourceUnavailable):
        await loader.load(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            command=_command(repo_url="https://github.com/agenta-ai/private"),
        )

    assert workflows.records == {}
    assert skills.records == {}
    assert mounts.calls == []
    assert starts.calls == []


async def test_completed_replay_does_not_contact_github(github):
    loader, skills, workflows, mounts, starts = _github_loader(github)
    first = await loader.load(
        project_id=PROJECT_ID, user_id=USER_ID, command=_command()
    )
    requests = len(github.requests)

    github.raise_error = httpx.ConnectError("GitHub is down")
    replay = await loader.load(
        project_id=PROJECT_ID, user_id=USER_ID, command=_command()
    )

    assert replay.replayed is True
    assert replay.model_dump(exclude={"replayed"}) == first.model_dump(
        exclude={"replayed"}
    )
    assert len(github.requests) == requests
    assert len(workflows.records) == 1
    assert len(starts.calls) == 1


async def test_completed_request_with_another_commit_or_path_conflicts(github):
    loader, _, workflows, _, starts = _github_loader(github)
    await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=_command())
    github.raise_error = httpx.ConnectError("GitHub is down")

    for changed in (
        _command(commit=OTHER_COMMIT),
        _command(path="api/resources/packages/other/1.0.0"),
        _command(repo_url="https://github.com/contributor/agenta"),
        _command(initial_message="Something else."),
    ):
        with pytest.raises(TemplateCreateConflict):
            await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=changed)

    assert len(workflows.records) == 1
    assert len(starts.calls) == 1


async def test_interrupted_load_recovers_from_the_same_commit_and_stored_pin(github):
    loader, skills, workflows, _, starts = _github_loader(github, start_fail_once=True)
    with pytest.raises(RuntimeError, match="session failure"):
        await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=_command())
    first_attempt = len(github.requests)

    # Content served for the commit no longer matches the stored digest: refuse it.
    github.raw_overrides[f"{PACKAGE_PATH}/plugin.json"] = b"{}"
    with pytest.raises(Exception) as changed:
        await loader.load(project_id=PROJECT_ID, user_id=USER_ID, command=_command())
    assert getattr(changed.value, "code", None) in {
        "template_source_github_content_mismatch",
        "template_source_digest_mismatch",
    }

    github.raw_overrides.clear()
    result = await loader.load(
        project_id=PROJECT_ID, user_id=USER_ID, command=_command()
    )

    assert result.replayed is True
    assert len(workflows.records) == 1
    assert len(skills.records) == 1
    assert len(starts.calls) == 2
    raw = [r for r in github.requests[first_attempt:] if r.url.host.startswith("raw.")]
    assert raw and all(f"/{COMMIT}/" in r.url.path for r in raw)


def _github_body(**source):
    return {
        **_body(),
        "source": {
            "kind": "github",
            "repo_url": REPO_URL,
            "commit": COMMIT,
            "path": PACKAGE_PATH,
            **source,
        },
    }


async def test_router_passes_a_github_source_to_the_loader(monkeypatch):
    loader = AsyncMock()
    loader.load.side_effect = TemplateSourceUnavailable(
        "template_source_github_unavailable", "missing"
    )
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _post(_app(loader), body=_github_body(commit=COMMIT.upper()))

    command = loader.load.await_args.kwargs["command"]
    assert command.source == _source()
    assert response.status_code == 404
    assert response.json()["code"] == "template_source_unavailable"
    assert response.json()["retryable"] is False
    assert response.json()["next_step"]
    assert response.json()["details"]["reason"] == "template_source_github_unavailable"


async def test_router_maps_github_rate_limits_to_a_retryable_503(monkeypatch):
    loader = AsyncMock()
    loader.load.side_effect = TemplateSourceUnavailable(
        "template_source_github_fetch_failed", "limited", retryable=True
    )
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _post(_app(loader), body=_github_body())

    assert response.status_code == 503
    assert response.json()["code"] == "template_source_fetch_failed"
    assert response.json()["retryable"] is True
    assert response.json()["next_step"]


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ({"commit": "main"}, "full 40-character commit SHA"),
        ({"commit": COMMIT[:7]}, "abbreviated"),
        ({"ref": "main"}, "'ref' is not supported"),
        ({"path": "../outside"}, "package directory"),
    ],
)
async def test_router_rejects_mutable_or_unsafe_github_sources(
    monkeypatch, source, expected
):
    loader = AsyncMock()
    validator = AsyncMock()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    loaded = await _post(_app(loader), body=_github_body(**source))
    validated = await _validate(
        _validation_app(validator), {"source": _github_body(**source)["source"]}
    )

    for response in (loaded, validated):
        assert response.status_code == 422
        assert expected in response.text
    loader.load.assert_not_awaited()
    validator.validate.assert_not_awaited()


def test_internal_sources_are_unchanged():
    assert InternalTemplateSource.model_validate({"key": "code-qa"}).kind == "internal"


def _origin(**overrides):
    return {
        "_ag": {
            "template_origin": {
                "kind": "github",
                "key": "code-qa",
                "version": "1.0.0",
                "digest": "sha256:" + "1" * 64,
                "repo_url": REPO_URL,
                "commit": COMMIT,
                "path": PACKAGE_PATH,
                **overrides,
            }
        }
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"commit": None},
        {"commit": COMMIT[:7]},
        {"commit": COMMIT.upper()},
        {"repo_url": "https://github.com/agenta-ai/agenta.git"},
        {"path": "../outside"},
        {"ref": "main"},
    ],
)
def test_github_provenance_must_be_complete_and_normalized(overrides):
    meta = _origin(**overrides)
    origin = meta["_ag"]["template_origin"]
    for key in [key for key, value in overrides.items() if value is None]:
        del origin[key]

    with pytest.raises(TemplateProvenanceInvalid):
        read_template_origin(meta)


def test_github_provenance_round_trips():
    assert read_template_origin(_origin()) == _origin()["_ag"]["template_origin"]
