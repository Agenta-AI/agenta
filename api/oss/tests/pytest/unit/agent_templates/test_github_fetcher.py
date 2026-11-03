import asyncio

import httpx
import pytest

from oss.src.core.agent_templates.archive import PackageLimits
from oss.src.core.agent_templates.dtos import GitHubTemplateSource
from oss.src.core.agent_templates.exceptions import (
    TemplatePackageInvalid,
    TemplateSourceInvalid,
    TemplateSourceUnavailable,
)
from oss.src.core.agent_templates.github import GitHubPackageFetcher
from oss.tests.pytest.unit.agent_templates.fake_github import (
    COMMIT,
    OTHER_COMMIT,
    PACKAGE_PATH,
    FakeGitHub,
    Submodule,
    Symlink,
    monorepo,
    nest,
    package_files,
)


def _fetcher(fake: FakeGitHub) -> GitHubPackageFetcher:
    return GitHubPackageFetcher(transport=httpx.MockTransport(fake.handler))


def _source(**overrides) -> GitHubTemplateSource:
    return GitHubTemplateSource.model_validate(
        {
            "repo_url": "https://github.com/agenta-ai/agenta",
            "commit": COMMIT,
            "path": PACKAGE_PATH,
            **overrides,
        }
    )


@pytest.fixture
def fake() -> FakeGitHub:
    fake = FakeGitHub()
    fake.add_commit("agenta-ai/agenta", COMMIT, monorepo())
    return fake


async def test_fetches_only_the_selected_directory_of_a_large_repository(fake):
    entries = await _fetcher(fake).fetch(_source())

    assert entries == [
        ("ai.agenta/agents.json", b'{"agents": {}}'),
        ("ai.agenta/agents/code-qa/AGENTS.md", b"# Code QA\n"),
        ("plugin.json", b'{"name": "code-qa", "version": "1.0.0"}'),
    ]
    urls = [str(request.url) for request in fake.requests]
    assert not any("tarball" in url or "zipball" in url for url in urls)
    assert not any("web/" in url or "other" in url for url in urls)
    recursive = [r for r in fake.requests if r.url.params.get("recursive") == "1"]
    assert len(recursive) == 1
    # One commit read, one listing per path segment, one recursive package listing,
    # one raw download per package file.
    assert len(fake.requests) == 1 + len(PACKAGE_PATH.split("/")) + 1 + 3


async def test_every_request_pins_the_supplied_commit(fake):
    fake.add_commit(
        "agenta-ai/agenta",
        OTHER_COMMIT,
        monorepo({"plugin.json": b'{"name": "changed"}'}),
    )

    entries = await _fetcher(fake).fetch(_source())

    assert ("plugin.json", b'{"name": "code-qa", "version": "1.0.0"}') in entries
    raw = [r for r in fake.requests if r.url.host == "raw.githubusercontent.com"]
    assert raw and all(f"/{COMMIT}/" in r.url.path for r in raw)
    commits = [r for r in fake.requests if "/git/commits/" in r.url.path]
    assert [r.url.path.rsplit("/", 1)[-1] for r in commits] == [COMMIT]


async def test_fork_head_commit_loads_from_the_fork_repository(fake):
    fake.add_commit(
        "contributor/agenta",
        OTHER_COMMIT,
        nest(PACKAGE_PATH, {"plugin.json": b'{"name": "proposed"}'}),
    )

    entries = await _fetcher(fake).fetch(
        _source(repo_url="https://github.com/contributor/agenta", commit=OTHER_COMMIT)
    )

    assert entries == [("plugin.json", b'{"name": "proposed"}')]
    assert all("/contributor/agenta/" in request.url.path for request in fake.requests)


@pytest.mark.parametrize(
    "overrides",
    [
        {"repo_url": "https://github.com/agenta-ai/private-repo"},
        {"commit": OTHER_COMMIT},
    ],
)
async def test_missing_or_private_repository_or_commit_is_actionable(fake, overrides):
    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await _fetcher(fake).fetch(_source(**overrides))

    assert exc_info.value.code == "template_source_github_unavailable"
    assert "private" in exc_info.value.message
    assert exc_info.value.retryable is False
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


@pytest.mark.parametrize(
    "path",
    [
        "api/resources/packages/missing/1.0.0",
        f"{PACKAGE_PATH}/plugin.json",
        "api/resources/packages/code-qa/1.0.0/nope",
    ],
)
async def test_missing_directory_is_actionable(fake, path):
    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await _fetcher(fake).fetch(_source(path=path))

    assert exc_info.value.code == "template_source_github_path_not_found"
    assert exc_info.value.details["path"] == path
    assert exc_info.value.details["commit"] == COMMIT


@pytest.mark.parametrize(
    ("entry", "code"),
    [
        (Symlink("../../../../secrets"), "template_source_symlink"),
        (Submodule(), "template_source_github_submodule"),
    ],
)
async def test_symlinks_and_submodules_inside_the_package_are_rejected(entry, code):
    fake = FakeGitHub()
    fake.add_commit(
        "agenta-ai/agenta",
        COMMIT,
        monorepo({**package_files(), "linked": entry}),
    )

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == code
    assert exc_info.value.details["path"] == "linked"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


@pytest.mark.parametrize(
    ("entry", "code"),
    [
        (Symlink("elsewhere"), "template_source_symlink"),
        (Submodule(), "template_source_github_submodule"),
    ],
)
async def test_symlinks_and_submodules_on_the_package_path_are_rejected(entry, code):
    fake = FakeGitHub()
    fake.add_commit("agenta-ai/agenta", COMMIT, {"packages": {"code-qa": entry}})

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source(path="packages/code-qa"))

    assert exc_info.value.code == code


async def test_truncated_listing_is_rejected(fake):
    record = fake.repos["agenta-ai/agenta"][COMMIT]
    fake.truncated_trees.add(record["tree"])

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"


async def test_too_many_files_are_rejected_before_download():
    fake = FakeGitHub()
    files = {f"file-{index}.md": b"x" for index in range(257)}
    fake.add_commit("agenta-ai/agenta", COMMIT, nest(PACKAGE_PATH, files))

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


async def test_oversized_file_is_rejected_before_download():
    fake = FakeGitHub()
    files = {"plugin.json": b"{}", "big.md": b"x" * (1024 * 1024 + 1)}
    fake.add_commit("agenta-ai/agenta", COMMIT, nest(PACKAGE_PATH, files))

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"
    assert exc_info.value.details["path"] == "big.md"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


async def test_oversized_package_is_rejected_before_download():
    fake = FakeGitHub()
    files = {f"part-{index}.md": b"x" * (900 * 1024) for index in range(5)}
    fake.add_commit("agenta-ai/agenta", COMMIT, nest(PACKAGE_PATH, files))

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


async def test_too_deep_package_path_is_rejected():
    fake = FakeGitHub()
    fake.add_commit(
        "agenta-ai/agenta",
        COMMIT,
        nest(PACKAGE_PATH, nest("/".join(["d"] * 12), {"file.md": b"x"})),
    )

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"


async def test_understated_listing_size_is_cut_off_while_streaming(fake):
    fake.declared_sizes["plugin.json"] = 4
    fake.raw_overrides[f"{PACKAGE_PATH}/plugin.json"] = b"x" * (2 * 1024 * 1024)

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_github_content_mismatch"


async def test_content_that_does_not_match_the_commit_blob_is_rejected(fake):
    original = b'{"name": "code-qa", "version": "1.0.0"}'
    fake.raw_overrides[f"{PACKAGE_PATH}/plugin.json"] = b"X" * len(original)

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_github_content_mismatch"
    assert exc_info.value.details["path"] == "plugin.json"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, json={"message": "Too Many Requests"}),
        httpx.Response(
            403,
            headers={"x-ratelimit-remaining": "0"},
            json={"message": "API rate limit exceeded"},
        ),
        httpx.Response(502, text="Bad Gateway"),
    ],
)
async def test_rate_limits_and_server_errors_are_retryable(fake, response):
    fake.fail_with = response

    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.retryable is True


async def test_transport_errors_are_retryable(fake):
    fake.raise_error = httpx.ConnectError("boom")

    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_github_fetch_failed"
    assert exc_info.value.retryable is True


async def test_oversized_listing_response_is_rejected(fake):
    fake.fail_with = httpx.Response(200, content=b"[" + b" " * (3 * 1024 * 1024))

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"


async def test_one_failed_download_cancels_the_rest():
    fake = FakeGitHub()
    files = {"plugin.json": b"{}", **{f"doc-{i:02}.md": b"x" for i in range(40)}}
    fake.add_commit("agenta-ai/agenta", COMMIT, nest(PACKAGE_PATH, files))
    fake.raw_overrides[f"{PACKAGE_PATH}/doc-00.md"] = b"tampered"

    async def handler(request):
        if not request.url.path.endswith("/doc-00.md"):
            await asyncio.sleep(0.01)
        return fake.handler(request)

    fetcher = GitHubPackageFetcher(transport=httpx.MockTransport(handler))
    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await fetcher.fetch(_source())
    after_failure = len(fake.requests)
    await asyncio.sleep(0.05)

    assert exc_info.value.code == "template_source_github_content_mismatch"
    assert len(fake.requests) == after_failure
    raw = [r for r in fake.requests if r.url.host == "raw.githubusercontent.com"]
    assert len(raw) <= 8


async def test_secondary_rate_limit_is_retryable(fake):
    fake.fail_with = httpx.Response(
        403,
        headers={"retry-after": "60", "x-ratelimit-remaining": "42"},
        json={"message": "You have exceeded a secondary rate limit."},
    )

    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.retryable is True


async def test_a_parent_of_the_package_directory_is_rejected(fake):
    with pytest.raises(TemplatePackageInvalid) as exc_info:
        await _fetcher(fake).fetch(_source(path="api/resources/packages/code-qa"))

    assert exc_info.value.code == "plugin_manifest_invalid"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


@pytest.mark.parametrize(
    ("override", "code"),
    [
        ({"path": "../escape"}, "template_source_path_invalid"),
        ({"path": "a\\b"}, "template_source_path_invalid"),
        ({"size": True}, "template_source_github_response_invalid"),
        ({"size": "12"}, "template_source_github_response_invalid"),
        ({"sha": "../../x"}, "template_source_github_response_invalid"),
        ({"path": None}, "template_source_github_response_invalid"),
    ],
)
async def test_hostile_listing_entries_are_rejected(override, code):
    fake = FakeGitHub()
    fake.add_commit("agenta-ai/agenta", COMMIT, nest(PACKAGE_PATH, package_files()))
    original = fake.handler

    def handler(request):
        response = original(request)
        if request.url.params.get("recursive") == "1":
            listing = response.json()
            index = next(
                i for i, e in enumerate(listing["tree"]) if e["path"] == "plugin.json"
            )
            listing["tree"][index] = {**listing["tree"][index], **override}
            return httpx.Response(200, json=listing)
        return response

    fetcher = GitHubPackageFetcher(transport=httpx.MockTransport(handler))
    with pytest.raises((TemplateSourceInvalid, TemplateSourceUnavailable)) as exc_info:
        await fetcher.fetch(_source())

    assert exc_info.value.code == code
    assert exc_info.value.retryable is False


async def test_listing_entry_bound_applies_to_the_recursive_listing(fake):
    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(
            _source(), limits=PackageLimits(max_archive_entries=2)
        )

    assert exc_info.value.code == "template_source_limit_exceeded"
    assert exc_info.value.details["limit"] == 2


async def test_whole_fetch_has_a_total_time_bound(fake):
    async def slow(request):
        await asyncio.sleep(1)
        return fake.handler(request)

    fetcher = GitHubPackageFetcher(
        transport=httpx.MockTransport(slow), total_timeout_seconds=0.05
    )
    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await fetcher.fetch(_source())

    assert exc_info.value.code == "template_source_github_fetch_failed"
    assert exc_info.value.retryable is True
