import hashlib
import json
from urllib.parse import unquote

import httpx
import pytest

from oss.src.core.agent_templates.dtos import GitHubTemplateSource
from oss.src.core.agent_templates.exceptions import (
    TemplateSourceInvalid,
    TemplateSourceUnavailable,
)
from oss.src.core.agent_templates.github import GitHubPackageFetcher


COMMIT = "0123456789abcdef0123456789abcdef01234567"
OTHER_COMMIT = "fedcba9876543210fedcba9876543210fedcba98"
PACKAGE_PATH = "api/resources/packages/code-qa/1.0.0"


class Symlink:
    def __init__(self, target: str) -> None:
        self.target = target.encode()


class Submodule:
    sha = "1" * 40


def _blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


class FakeGitHub:
    """Serves the git data API and raw content for in-memory repositories."""

    def __init__(self) -> None:
        self.repos: dict[str, dict[str, dict]] = {}
        self.trees: dict[str, dict] = {}
        self.blobs: dict[str, bytes] = {}
        self.requests: list[httpx.Request] = []
        self.raw_overrides: dict[str, bytes] = {}
        self.declared_sizes: dict[str, int] = {}
        self.truncated_trees: set[str] = set()
        self.fail_with: httpx.Response | None = None
        self.raise_error: Exception | None = None

    def add_commit(self, repo: str, commit: str, files: dict) -> None:
        self.repos.setdefault(repo, {})[commit] = {"tree": self._tree(files)}

    def _tree(self, node: dict) -> str:
        entries = []
        for name, value in sorted(node.items()):
            if isinstance(value, dict):
                entries.append(
                    {
                        "path": name,
                        "mode": "040000",
                        "type": "tree",
                        "sha": self._tree(value),
                    }
                )
            elif isinstance(value, Symlink):
                sha = _blob_sha(value.target)
                self.blobs[sha] = value.target
                entries.append(
                    {
                        "path": name,
                        "mode": "120000",
                        "type": "blob",
                        "sha": sha,
                        "size": len(value.target),
                    }
                )
            elif isinstance(value, Submodule):
                entries.append(
                    {"path": name, "mode": "160000", "type": "commit", "sha": value.sha}
                )
            else:
                sha = _blob_sha(value)
                self.blobs[sha] = value
                entries.append(
                    {
                        "path": name,
                        "mode": "100644",
                        "type": "blob",
                        "sha": sha,
                        "size": len(value),
                    }
                )
        sha = hashlib.sha1(json.dumps(entries, sort_keys=True).encode()).hexdigest()
        self.trees[sha] = {"entries": entries}
        return sha

    def _recursive(self, tree_sha: str, prefix: str = "") -> list[dict]:
        result = []
        for entry in self.trees[tree_sha]["entries"]:
            item = {**entry, "path": f"{prefix}{entry['path']}"}
            result.append(item)
            if entry["type"] == "tree":
                result.extend(self._recursive(entry["sha"], f"{item['path']}/"))
        return result

    def _find_blob(self, repo: str, commit: str, path: str) -> bytes | None:
        record = self.repos.get(repo, {}).get(commit)
        if record is None:
            return None
        for entry in self._recursive(record["tree"]):
            if entry["path"] == path and entry["type"] == "blob":
                return self.blobs[entry["sha"]]
        return None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.raise_error is not None:
            raise self.raise_error
        if self.fail_with is not None:
            return self.fail_with
        path = unquote(request.url.path)
        if request.url.host == "raw.githubusercontent.com":
            owner, repo, commit, file_path = path.lstrip("/").split("/", 3)
            if file_path in self.raw_overrides:
                return httpx.Response(200, content=self.raw_overrides[file_path])
            content = self._find_blob(f"{owner}/{repo}", commit, file_path)
            if content is None:
                return httpx.Response(404, text="404: Not Found")
            return httpx.Response(200, content=content)

        assert request.url.host == "api.github.com"
        parts = path.lstrip("/").split("/")
        assert parts[0] == "repos" and parts[3] == "git", path
        repo = f"{parts[1]}/{parts[2]}"
        if repo not in self.repos:
            return httpx.Response(404, json={"message": "Not Found"})
        if parts[4] == "commits":
            record = self.repos[repo].get(parts[5])
            if record is None:
                return httpx.Response(404, json={"message": "Not Found"})
            return httpx.Response(
                200, json={"sha": parts[5], "tree": {"sha": record["tree"]}}
            )
        if parts[4] == "trees":
            tree_sha = parts[5]
            if tree_sha not in self.trees:
                return httpx.Response(404, json={"message": "Not Found"})
            if request.url.params.get("recursive") == "1":
                entries = self._recursive(tree_sha)
            else:
                entries = self.trees[tree_sha]["entries"]
            entries = [
                {
                    **entry,
                    **(
                        {"size": self.declared_sizes[entry["path"]]}
                        if entry["path"] in self.declared_sizes
                        else {}
                    ),
                }
                for entry in entries
            ]
            return httpx.Response(
                200,
                json={
                    "sha": tree_sha,
                    "tree": entries,
                    "truncated": tree_sha in self.truncated_trees,
                },
            )
        return httpx.Response(404, json={"message": "Not Found"})


def _package_files() -> dict:
    return {
        "plugin.json": b'{"name": "code-qa", "version": "1.0.0"}',
        "ai.agenta": {
            "agents.json": b'{"agents": {}}',
            "agents": {"code-qa": {"AGENTS.md": b"# Code QA\n"}},
        },
    }


def _nest(path: str, leaf: dict) -> dict:
    node = leaf
    for part in reversed(path.split("/")):
        node = {part: node}
    return node


def _monorepo(package: dict | None = None) -> dict:
    tree = _nest(PACKAGE_PATH, package or _package_files())
    # Unrelated siblings at every level must never be listed recursively or downloaded.
    tree["web"] = {f"file-{index}.ts": b"x" * 64 for index in range(500)}
    tree["api"]["other"] = {"big.bin": b"y" * 4096}
    tree["api"]["resources"]["packages"]["other-template"] = {
        "1.0.0": {"plugin.json": b"{}"}
    }
    return tree


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
    fake.add_commit("agenta-ai/agenta", COMMIT, _monorepo())
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
        _monorepo({"plugin.json": b'{"name": "changed"}'}),
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
        _nest(PACKAGE_PATH, {"plugin.json": b'{"name": "proposed"}'}),
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
        _monorepo({**_package_files(), "linked": entry}),
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
    fake.add_commit("agenta-ai/agenta", COMMIT, _nest(PACKAGE_PATH, files))

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


async def test_oversized_file_is_rejected_before_download():
    fake = FakeGitHub()
    files = {"plugin.json": b"{}", "big.md": b"x" * (1024 * 1024 + 1)}
    fake.add_commit("agenta-ai/agenta", COMMIT, _nest(PACKAGE_PATH, files))

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"
    assert exc_info.value.details["path"] == "big.md"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


async def test_oversized_package_is_rejected_before_download():
    fake = FakeGitHub()
    files = {f"part-{index}.md": b"x" * (900 * 1024) for index in range(5)}
    fake.add_commit("agenta-ai/agenta", COMMIT, _nest(PACKAGE_PATH, files))

    with pytest.raises(TemplateSourceInvalid) as exc_info:
        await _fetcher(fake).fetch(_source())

    assert exc_info.value.code == "template_source_limit_exceeded"
    assert not any(r.url.host == "raw.githubusercontent.com" for r in fake.requests)


async def test_too_deep_package_path_is_rejected():
    fake = FakeGitHub()
    fake.add_commit(
        "agenta-ai/agenta",
        COMMIT,
        _nest(PACKAGE_PATH, _nest("/".join(["d"] * 12), {"file.md": b"x"})),
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
