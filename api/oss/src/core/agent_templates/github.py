"""Bounded fetch of one package directory from a public GitHub repository.

The fetcher reads the git data API at the supplied commit only: one commit read,
one non-recursive tree listing per path segment, one recursive listing of the
package directory, then one raw download per package file. It never downloads a
repository archive, so a small package in a large monorepo stays small.

Every download is pinned to the commit and checked against the blob SHA from
the listing, so the returned bytes are exactly the files at that commit.
"""

import asyncio
import hashlib
import json
from typing import Any, NamedTuple
from urllib.parse import quote
from uuid import UUID

import httpx

from oss.src.core.agent_templates.archive import PackageLimits, PackageTreeWriter
from oss.src.core.agent_templates.dtos import GitHubTemplateSource, TemplateSource
from oss.src.core.agent_templates.exceptions import (
    TemplateSourceInvalid,
    TemplateSourceUnavailable,
)

GITHUB_API_URL = "https://api.github.com"
GITHUB_RAW_URL = "https://raw.githubusercontent.com"

_MAX_LISTING_BYTES = 2 * 1024 * 1024
_MAX_CONCURRENT_DOWNLOADS = 8
_DEFAULT_TIMEOUT_SECONDS = 30.0

_FILE_MODES = {"100644", "100755"}
_SYMLINK_MODE = "120000"
_SUBMODULE_MODE = "160000"
_TREE_MODE = "040000"


class GitHubPackageFile(NamedTuple):
    path: str
    content: bytes


def _invalid(code: str, message: str, **details: object) -> TemplateSourceInvalid:
    return TemplateSourceInvalid(code, message, details=details or None)


def _limit(message: str, **details: object) -> TemplateSourceInvalid:
    return _invalid("template_source_limit_exceeded", message, **details)


def _git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


class GitHubPackageFetcher:
    """Public-repository fetch without credentials; private repositories are unsupported."""

    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._transport = transport
        self._timeout_seconds = timeout_seconds

    async def fetch(
        self,
        source: GitHubTemplateSource,
        *,
        limits: PackageLimits | None = None,
    ) -> list[GitHubPackageFile]:
        """Return the package files as sorted (package-relative path, bytes) pairs."""
        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=self._timeout_seconds,
            follow_redirects=False,
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "agenta-template-loader",
            },
        ) as client:
            session = _FetchSession(
                client=client, source=source, limits=limits or PackageLimits()
            )
            return await session.run()


class _FetchSession:
    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        source: GitHubTemplateSource,
        limits: PackageLimits,
    ):
        self._client = client
        self._source = source
        self._limits = limits
        self._api = (
            f"{GITHUB_API_URL}/repos/{quote(source.owner, safe='')}"
            f"/{quote(source.repo, safe='')}/git"
        )

    def _details(self, **extra: object) -> dict:
        return {
            "repo_url": self._source.repo_url,
            "commit": self._source.commit,
            "path": self._source.path,
            **extra,
        }

    def _unavailable(self) -> TemplateSourceUnavailable:
        return TemplateSourceUnavailable(
            "template_source_github_unavailable",
            "The repository or commit was not found on GitHub. Only public "
            "repositories are supported; private repositories cannot be loaded. "
            "Check the repository URL and that the full commit SHA exists there.",
            details=self._details(),
        )

    def _path_not_found(self) -> TemplateSourceUnavailable:
        return TemplateSourceUnavailable(
            "template_source_github_path_not_found",
            "The package directory does not exist at this commit. Supply the "
            "directory that contains plugin.json, relative to the repository root.",
            details=self._details(),
        )

    def _transport_failure(
        self, status_code: int | None = None
    ) -> TemplateSourceUnavailable:
        return TemplateSourceUnavailable(
            "template_source_github_fetch_failed",
            "GitHub could not be reached or is limiting requests. Retry later "
            "with the same request.",
            retryable=True,
            details=self._details(
                **({"status_code": status_code} if status_code is not None else {})
            ),
        )

    async def _get(self, url: str, *, max_bytes: int, params: dict | None = None):
        try:
            async with self._client.stream("GET", url, params=params) as response:
                if response.status_code == 404:
                    return response, None
                rate_limited = response.status_code == 429 or (
                    response.status_code == 403
                    and response.headers.get("x-ratelimit-remaining") == "0"
                )
                if rate_limited or response.status_code >= 500:
                    raise self._transport_failure(response.status_code)
                if response.status_code != 200:
                    # 403 without rate limiting, 409 (empty repository), 422 (bad sha)
                    # and redirects all mean this exact source cannot be served.
                    return response, None
                received = bytearray()
                async for chunk in response.aiter_bytes():
                    received.extend(chunk)
                    if len(received) > max_bytes:
                        return response, _OVERSIZED
                return response, bytes(received)
        except httpx.HTTPError as exc:
            raise self._transport_failure() from exc

    async def _get_json(self, url: str, *, params: dict | None = None) -> Any:
        _, body = await self._get(url, max_bytes=_MAX_LISTING_BYTES, params=params)
        if body is _OVERSIZED:
            raise _limit(
                "The GitHub listing for this package is too large.",
                **self._details(),
            )
        if body is None:
            return None
        try:
            return json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise self._transport_failure() from None

    async def _tree_entries(self, tree_sha: str, *, recursive: bool) -> list[dict]:
        listing = await self._get_json(
            f"{self._api}/trees/{quote(tree_sha, safe='')}",
            params={"recursive": "1"} if recursive else None,
        )
        if not isinstance(listing, dict) or not isinstance(listing.get("tree"), list):
            raise self._path_not_found()
        if listing.get("truncated"):
            raise _limit(
                "GitHub truncated the listing for this package directory.",
                **self._details(),
            )
        entries = listing["tree"]
        if recursive and len(entries) > self._limits.max_archive_entries:
            raise _limit(
                "The template package contains too many entries.",
                limit=self._limits.max_files,
                **self._details(),
            )
        return [entry for entry in entries if isinstance(entry, dict)]

    async def _package_tree_sha(self) -> str:
        commit = await self._get_json(
            f"{self._api}/commits/{quote(self._source.commit, safe='')}"
        )
        if (
            not isinstance(commit, dict)
            or commit.get("sha") != self._source.commit
            or not isinstance(commit.get("tree"), dict)
            or not isinstance(commit["tree"].get("sha"), str)
        ):
            raise self._unavailable()

        tree_sha = commit["tree"]["sha"]
        walked: list[str] = []
        for segment in self._source.path.split("/"):
            walked.append(segment)
            entries = await self._tree_entries(tree_sha, recursive=False)
            match = next((e for e in entries if e.get("path") == segment), None)
            if match is None:
                raise self._path_not_found()
            self._reject_special(match, path="/".join(walked), package=False)
            if match.get("mode") != _TREE_MODE or not isinstance(match.get("sha"), str):
                raise self._path_not_found()
            tree_sha = match["sha"]
        return tree_sha

    def _reject_special(self, entry: dict, *, path: str, package: bool) -> None:
        mode = entry.get("mode")
        if mode == _SYMLINK_MODE:
            raise _invalid(
                "template_source_symlink",
                "Template packages cannot contain or be reached through symbolic links.",
                path=path,
            )
        if mode == _SUBMODULE_MODE or entry.get("type") == "commit":
            raise _invalid(
                "template_source_github_submodule",
                "Template packages cannot contain or be reached through git submodules.",
                path=path,
            )
        if package and mode not in _FILE_MODES and mode != _TREE_MODE:
            raise _invalid(
                "template_source_file_invalid",
                "Template packages can contain only regular files and directories.",
                path=path,
            )

    def _plan_downloads(self, entries: list[dict]) -> list[tuple[str, str, int]]:
        planned: list[tuple[str, str, int]] = []
        total = 0
        for entry in entries:
            path = entry.get("path")
            if not isinstance(path, str) or not path:
                raise self._transport_failure()
            self._reject_special(entry, path=path, package=True)
            parts = path.split("/")
            if any(part in {"", ".", ".."} for part in parts) or "\\" in path:
                raise _invalid(
                    "template_source_path_invalid",
                    "The template package contains an invalid path.",
                    path=path,
                )
            if len(parts) > self._limits.max_path_segments:
                raise _limit("A template package path is too deep.", path=path)
            if entry.get("mode") == _TREE_MODE:
                continue
            size = entry.get("size")
            sha = entry.get("sha")
            if not isinstance(size, int) or size < 0 or not isinstance(sha, str):
                raise self._transport_failure()
            if size > self._limits.max_file_bytes:
                raise _limit(
                    "A template package file is too large.",
                    path=path,
                    limit=self._limits.max_file_bytes,
                )
            total += size
            if total > self._limits.max_total_bytes:
                raise _limit(
                    "The template package is too large.",
                    limit=self._limits.max_total_bytes,
                )
            planned.append((path, sha, size))
            if len(planned) > self._limits.max_files:
                raise _limit(
                    "The template package contains too many files.",
                    limit=self._limits.max_files,
                )
        return sorted(planned)

    async def _download(self, path: str, sha: str, size: int) -> GitHubPackageFile:
        repo_path = f"{self._source.path}/{path}"
        url = (
            f"{GITHUB_RAW_URL}/{quote(self._source.owner, safe='')}"
            f"/{quote(self._source.repo, safe='')}/{self._source.commit}"
            f"/{quote(repo_path, safe='/')}"
        )
        _, body = await self._get(url, max_bytes=size)
        if body is None:
            raise self._unavailable()
        if body is _OVERSIZED or len(body) != size or _git_blob_sha(body) != sha:
            raise _invalid(
                "template_source_github_content_mismatch",
                "A downloaded file does not match the file recorded at this commit.",
                path=path,
            )
        return GitHubPackageFile(path, body)

    async def run(self) -> list[GitHubPackageFile]:
        tree_sha = await self._package_tree_sha()
        entries = await self._tree_entries(tree_sha, recursive=True)
        planned = self._plan_downloads(entries)

        semaphore = asyncio.Semaphore(_MAX_CONCURRENT_DOWNLOADS)

        async def bounded(item: tuple[str, str, int]) -> GitHubPackageFile:
            async with semaphore:
                return await self._download(*item)

        return list(await asyncio.gather(*(bounded(item) for item in planned)))


class GitHubPackageStager:
    """Stage a commit-pinned GitHub package directory through the shared writer."""

    def __init__(self, *, fetcher: GitHubPackageFetcher | None = None) -> None:
        self._fetcher = fetcher or GitHubPackageFetcher()

    async def stage(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        writer: PackageTreeWriter,
    ) -> None:
        if not isinstance(source, GitHubTemplateSource):
            raise TypeError("GitHubPackageStager stages GitHub sources only.")
        for file in await self._fetcher.fetch(source, limits=writer.limits):
            writer.write_file(file.path, [file.content])


class _Oversized:
    pass


_OVERSIZED: Any = _Oversized()
