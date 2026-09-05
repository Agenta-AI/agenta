"""Source fetching for skill imports: a GitHub repo/marketplace → an
extracted temp directory + the commit sha it represents.

Snapshot-only by design: the tarball endpoint needs no git binary and no
clone; the extracted tree is handed to the parser and deleted afterwards.
Tests (and the archive-upload path later) inject their own fetcher.
"""

import io
import re
import tarfile
import tempfile
from pathlib import Path
from typing import Optional, Protocol

import httpx
from pydantic import BaseModel

from oss.src.utils.env import env
from oss.src.core.skills.exceptions import (
    SkillSourceFetchError,
    SkillSourceInvalidURLError,
    SkillSourceTooLargeError,
)

_GITHUB_URL = re.compile(
    r"^(?:https?://)?github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?/?$"
)


class FetchedSource(BaseModel):
    root: Path  # extracted tree root (inside a caller-owned temp dir)
    commit_sha: Optional[str] = None

    model_config = {"arbitrary_types_allowed": True}


class SourceFetcher(Protocol):
    async def fetch(
        self, *, repo_url: str, ref: Optional[str], dest: Path
    ) -> FetchedSource: ...


def parse_github_url(repo_url: str) -> tuple[str, str]:
    match = _GITHUB_URL.match(repo_url.strip())
    if not match:
        raise SkillSourceInvalidURLError(
            f"Not a GitHub repository URL: {repo_url!r}.",
            next_step="Pass a URL like github.com/<owner>/<repo>.",
        )
    return match.group("owner"), match.group("repo")


class GitHubTarballFetcher:
    """Public-repo fetch via the REST tarball endpoint. No auth in v1."""

    async def fetch(
        self, *, repo_url: str, ref: Optional[str], dest: Path
    ) -> FetchedSource:
        owner, repo = parse_github_url(repo_url)
        target = f"https://api.github.com/repos/{owner}/{repo}/tarball/{ref or ''}"
        max_bytes = env.agenta.api.skills_import.max_tarball_mb * 1024 * 1024

        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=env.agenta.api.skills_import.fetch_timeout_seconds,
            ) as client:
                response = await client.get(target)
        except httpx.HTTPError as e:
            raise SkillSourceFetchError(
                f"Could not reach GitHub for {owner}/{repo}: {e.__class__.__name__}.",
                next_step="Check the URL and try again.",
            ) from e

        if response.status_code == 404:
            raise SkillSourceFetchError(
                f"GitHub returned 404 for {owner}/{repo}"
                + (f"@{ref}" if ref else "")
                + " — the repository (or ref) does not exist or is private.",
                next_step="Check the URL; private repositories are not supported yet.",
            )
        if response.status_code == 403:
            raise SkillSourceFetchError(
                "GitHub rate limit hit while fetching the repository.",
                next_step="Wait a few minutes and try again.",
            )
        if response.status_code >= 400:
            raise SkillSourceFetchError(
                f"GitHub returned HTTP {response.status_code} for {owner}/{repo}.",
            )

        payload = response.content
        if len(payload) > max_bytes:
            raise SkillSourceTooLargeError(
                f"The repository tarball exceeds the "
                f"{env.agenta.api.skills_import.max_tarball_mb} MB import cap.",
            )

        return FetchedSource(
            root=extract_tarball(payload, dest=dest),
            # GitHub encodes the resolved sha in the tarball's top-level dir
            # (<owner>-<repo>-<sha>); extract_tarball surfaces it via the dir name.
            commit_sha=_sha_from_extracted_root(extracted=dest),
        )


def extract_tarball(payload: bytes, *, dest: Path) -> Path:
    """Extract safely (no absolute paths / traversal) and return the tree root.

    GitHub tarballs wrap everything in one `<owner>-<repo>-<sha>/` directory;
    when exactly one top-level directory exists, it IS the root.
    """
    try:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:*") as tar:
            for member in tar.getmembers():
                member_path = Path(member.name)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise SkillSourceFetchError(
                        "The archive contains unsafe paths and was rejected.",
                    )
            tar.extractall(dest, filter="data")
    except tarfile.TarError as e:
        raise SkillSourceFetchError(
            f"The downloaded archive could not be extracted: {e}.",
        ) from e

    entries = [p for p in dest.iterdir() if not p.name.startswith(".")]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest


def _sha_from_extracted_root(*, extracted: Path) -> Optional[str]:
    entries = [p for p in extracted.iterdir() if p.is_dir()]
    if len(entries) == 1:
        tail = entries[0].name.rsplit("-", 1)[-1]
        if re.fullmatch(r"[0-9a-f]{7,40}", tail):
            return tail
    return None


def make_workdir() -> tempfile.TemporaryDirectory:
    return tempfile.TemporaryDirectory(prefix="agenta-skill-import-")
