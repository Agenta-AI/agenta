"""The GitHub catalog adapter — the only registered provider in v1.

Everything GitHub-specific lives here: URL recognition, the REST tarball
fetch (public repos, no auth), and the provenance link shape. The shared
extraction safety rails (streamed size cap, decompression-bomb ceilings,
path-traversal rejection) stay in `fetcher.py` — they serve any provider
that ships archives.
"""

import re
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import httpx

from oss.src.utils.env import env

from oss.src.core.skills.exceptions import (
    SkillSourceFetchError,
    SkillSourceTooLargeError,
)
from oss.src.core.skills.fetcher import extract_tarball, sha_from_extracted_root
from oss.src.core.skills.providers.base import (
    CatalogProvider,
    SourceLocator,
    SourceSnapshot,
)

_GITHUB_URL = re.compile(
    r"^(?:https?://)?github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?/?$"
)


class GitHubProvider(CatalogProvider):
    provider = "github"

    def claims(self, source_url: str) -> Optional[SourceLocator]:
        match = _GITHUB_URL.match((source_url or "").strip())
        if not match:
            return None
        return SourceLocator(
            provider=self.provider,
            repository=f"{match.group('owner')}/{match.group('repo')}",
        )

    async def fetch_snapshot(
        self, locator: SourceLocator, *, dest: Path
    ) -> SourceSnapshot:
        repository = locator.repository
        ref = locator.ref
        target = f"https://api.github.com/repos/{repository}/tarball/{ref or ''}"
        max_bytes = env.agenta.api.skills_import.max_tarball_mb * 1024 * 1024

        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=env.agenta.api.skills_import.fetch_timeout_seconds,
            ) as client:
                async with client.stream("GET", target) as response:
                    if response.status_code == 404:
                        raise SkillSourceFetchError(
                            f"GitHub returned 404 for {repository}"
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
                            f"GitHub returned HTTP {response.status_code} for {repository}.",
                        )

                    # Enforce the cap WHILE streaming, so an oversized repository is
                    # cut off at the limit instead of buffered whole and then rejected.
                    chunks: list[bytes] = []
                    received = 0
                    async for chunk in response.aiter_bytes():
                        received += len(chunk)
                        if received > max_bytes:
                            raise SkillSourceTooLargeError(
                                f"The repository tarball exceeds the "
                                f"{env.agenta.api.skills_import.max_tarball_mb} MB import cap.",
                            )
                        chunks.append(chunk)
                    payload = b"".join(chunks)
        except httpx.HTTPError as e:
            raise SkillSourceFetchError(
                f"Could not reach GitHub for {repository}: {e.__class__.__name__}.",
                next_step="Check the URL and try again.",
            ) from e

        return SourceSnapshot(
            root=extract_tarball(payload, dest=dest),
            # GitHub encodes the resolved sha in the tarball's top-level dir
            # (<owner>-<repo>-<sha>); extract_tarball surfaces it via the dir name.
            resolved_version=sha_from_extracted_root(extracted=dest),
        )

    def item_url(
        self,
        locator: SourceLocator,
        *,
        path: str,
        resolved_version: Optional[str],
    ) -> Optional[str]:
        if not resolved_version:
            return None
        # Paths come from the repo tree and may hold spaces or `#`; encode them
        # (keeping separators) so the link stays valid.
        safe_path = quote(path, safe="/")
        return f"https://github.com/{locator.repository}/tree/{resolved_version}/{safe_path}"
