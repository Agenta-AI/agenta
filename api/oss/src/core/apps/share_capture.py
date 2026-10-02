"""Reference discovery and external capture for a shared app's snapshot.

Publish follows the app's references once, downloads what is external, and records every resolved
reference in the manifest's `refs`. The rules are in docs/design/agent-html-apps/contracts.md.
"""

from __future__ import annotations

import asyncio
import posixpath
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx

from oss.src.core.apps.share_dtos import ShareIssue, ShareRefs
from oss.src.core.gateways.egress import (
    EgressRefusedError,
    egress_client,
    open_egress,
)

MAX_EXTERNAL_URLS = 30
MAX_EXTERNAL_DEPTH = 3
MAX_REDIRECTS = 3
FETCH_TIMEOUT_SECONDS = 10.0
# The whole download, redirects included: the httpx timeout only bounds each read.
FETCH_DEADLINE_SECONDS = 30.0
# The whole capture, so a publish answers well inside a proxy's timeout.
CAPTURE_DEADLINE_SECONDS = 45.0
_OVER_FILE_LIMIT = "the file is over the size limit"
_OVER_BUDGET = "over the 25 MB snapshot limit"
_OUT_OF_TIME = "the publish ran out of time"
# Downloads in flight at once; each level of the graph is fetched as one bounded batch.
FETCH_CONCURRENCY = 6
# Name resolution for captures only, so slow DNS in a publish never holds the relays' threads.
_RESOLVER = ThreadPoolExecutor(
    max_workers=FETCH_CONCURRENCY, thread_name_prefix="share-resolver"
)

_CSS_URL_RE = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)""", re.I)
# `@import "x"`, `@import 'x'`, and `@import url(x)` with or without quotes.
_CSS_IMPORT_RE = re.compile(
    r"""@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)"'\s;]+))""", re.I
)
_MODULE_URL_IMPORT_RE = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*\(?\s*)["'](?:https?:)?//""", re.I
)


def css_references(text: str) -> List[Tuple[str, bool]]:
    """Every `url()` and `@import` target in a stylesheet, as written, with "is an import"."""
    imports = {
        next(g for g in m.groups() if g is not None).strip()
        for m in _CSS_IMPORT_RE.finditer(text)
    }
    refs: List[Tuple[str, bool]] = [(ref, True) for ref in imports if ref]
    for match in _CSS_URL_RE.finditer(text):
        ref = next(g for g in match.groups() if g is not None).strip()
        if ref and ref not in imports:
            refs.append((ref, False))
    return refs


@dataclass
class HtmlReferences:
    scripts: List[str] = field(default_factory=list)
    stylesheets: List[str] = field(default_factory=list)
    images: List[str] = field(default_factory=list)
    # url()/@import inside <style> blocks and style="" attributes: CSS refs of the HTML itself.
    css: List[Tuple[str, bool]] = field(default_factory=list)
    module_scripts: List[str] = field(default_factory=list)
    inline_module_text: List[str] = field(default_factory=list)


class _HtmlRefParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs = HtmlReferences()
        self._in_style = False
        self._in_module = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if a.get("style"):
            self.refs.css.extend(css_references(a["style"]))
        if tag == "script":
            is_module = a.get("type", "").strip().lower() == "module"
            if a.get("src"):
                self.refs.scripts.append(a["src"].strip())
                if is_module:
                    self.refs.module_scripts.append(a["src"].strip())
            else:
                self._in_module = is_module
        elif tag == "link" and "stylesheet" in a.get("rel", "").lower().split():
            if a.get("href"):
                self.refs.stylesheets.append(a["href"].strip())
        elif tag == "img" and a.get("src"):
            self.refs.images.append(a["src"].strip())
        elif tag == "style":
            self._in_style = True

    def handle_endtag(self, tag):
        if tag == "style":
            self._in_style = False
        elif tag == "script":
            self._in_module = False

    def handle_data(self, data):
        if self._in_style:
            self.refs.css.extend(css_references(data))
        elif self._in_module:
            self.refs.inline_module_text.append(data)


def html_references(text: str) -> HtmlReferences:
    parser = _HtmlRefParser()
    parser.feed(text)
    parser.close()
    return parser.refs


def imports_urls(script_text: str) -> bool:
    """True when a module script imports another URL, which a share cannot load."""
    return bool(_MODULE_URL_IMPORT_RE.search(script_text))


def _is_ignored(ref: str) -> bool:
    lowered = ref.lower()
    return (
        not ref
        or ref.startswith("#")
        or lowered.startswith(("data:", "blob:", "javascript:", "mailto:", "about:"))
    )


def external_url(ref: str, *, base_url: Optional[str] = None) -> Optional[str]:
    """The absolute `https:` URL a reference names, or None when it names no external file.

    A relative reference is external only inside a captured file (`base_url`).
    """
    if _is_ignored(ref):
        return None
    if ref.startswith("//"):
        ref = f"https:{ref}"
    parsed = urlparse(ref)
    if parsed.scheme:
        return ref.split("#", 1)[0] if parsed.scheme.lower() == "https" else None
    if base_url is None:
        return None
    return urljoin(base_url, ref).split("#", 1)[0]


def local_path(ref: str, *, base_dir: str) -> Optional[str]:
    """The app-relative path a relative reference names, or None when it is not local or leaves
    the app folder."""
    if _is_ignored(ref) or ref.startswith("//") or urlparse(ref).scheme:
        return None
    clean = ref.split("#", 1)[0].split("?", 1)[0]
    if not clean or clean.startswith("/"):
        return None
    joined = posixpath.normpath(posixpath.join(base_dir, clean))
    if joined == "." or joined.startswith("../") or joined == "..":
        return None
    return joined


# --------------------------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Fetched:
    final_url: str
    content: bytes
    content_type: str


class CaptureFailed(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


Fetcher = Callable[[str, int], Awaitable[Fetched]]


async def fetch_external(url: str, max_bytes: int) -> Fetched:
    """GET one public `https:` URL, following up to 3 redirects, each checked by `open_egress`."""
    current = url
    async with egress_client(timeout=FETCH_TIMEOUT_SECONDS) as client:
        for _ in range(MAX_REDIRECTS + 1):
            if urlparse(current).scheme.lower() != "https":
                raise CaptureFailed("only https URLs are captured")
            try:
                target = await open_egress(
                    current, operator_exemptions=False, resolver=_RESOLVER
                )
            except EgressRefusedError as exc:
                raise CaptureFailed(
                    "the address is not reachable from the server"
                ) from exc
            try:
                response = await client.send(
                    client.build_request(
                        "GET",
                        target.url,
                        headers=target.headers,
                        extensions=target.extensions,
                    ),
                    stream=True,
                )
            except httpx.RequestError as exc:
                raise CaptureFailed("the download failed") from exc
            try:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise CaptureFailed("a redirect had no location")
                    current = urljoin(current, location)
                    continue
                if response.status_code != 200:
                    raise CaptureFailed(f"the server answered {response.status_code}")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise CaptureFailed(_OVER_FILE_LIMIT)
                content_type = (
                    response.headers.get("content-type", "application/octet-stream")
                    .split(";", 1)[0]
                    .strip()
                )
                return Fetched(
                    final_url=current, content=bytes(body), content_type=content_type
                )
            except httpx.RequestError as exc:
                raise CaptureFailed("the download failed") from exc
            finally:
                await response.aclose()
    raise CaptureFailed("too many redirects")


# --------------------------------------------------------------------------------------------
# The graph walk
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class LocalFile:
    path: str
    content: bytes
    content_type: str


@dataclass
class CaptureResult:
    # external key (the absolute URL as written) -> what was downloaded
    external: Dict[str, Fetched] = field(default_factory=dict)
    refs: ShareRefs = field(default_factory=dict)
    failed: List[ShareIssue] = field(default_factory=list)
    warnings: List[ShareIssue] = field(default_factory=list)


def file_key(path: str) -> str:
    return f"file:{path}"


def url_key(url: str) -> str:
    return f"url:{url}"


def _is_css(path_or_type: str) -> bool:
    return path_or_type.endswith(".css") or path_or_type == "text/css"


def _is_html(path: str) -> bool:
    return path.endswith((".html", ".htm"))


def _text(content: bytes) -> str:
    return content.decode("utf-8", "replace")


async def capture(
    *,
    files: Dict[str, LocalFile],
    byte_budget: int,
    max_file_bytes: int,
    fetch: Fetcher = fetch_external,
) -> CaptureResult:
    """Walk the app's references, download what is external, and record every resolved ref.

    `byte_budget` is what is left of the snapshot budget after the app's own files.
    """
    result = CaptureResult()
    # (external url, depth, referenced as a stylesheet)
    pending: List[Tuple[str, int, bool]] = []
    queued: set[str] = set()
    module_urls: set[str] = set()

    def resolve(
        entry: str,
        ref: str,
        *,
        base_dir: Optional[str],
        base_url: Optional[str],
        depth: int,
        stylesheet: bool,
    ) -> Optional[str]:
        """Record where `ref` points and queue it when external. Returns the external URL."""
        if base_dir is not None:
            path = local_path(ref, base_dir=base_dir)
            if path is not None:
                if path in files:
                    result.refs.setdefault(entry, {})[ref] = {"file": path}
                return None
        url = external_url(ref, base_url=base_url)
        if url is None:
            return None
        result.refs.setdefault(entry, {})[ref] = {"url": url}
        if url not in queued:
            queued.add(url)
            pending.append((url, depth, stylesheet))
        return url

    def warn_module(path: str) -> None:
        result.warnings.append(
            ShareIssue(code="module_imports_not_captured", path=path)
        )

    for path, item in files.items():
        base_dir = posixpath.dirname(path)
        entry = file_key(path)
        if _is_html(path):
            refs = html_references(_text(item.content))
            for ref in refs.scripts + refs.images:
                resolve(
                    entry,
                    ref,
                    base_dir=base_dir,
                    base_url=None,
                    depth=1,
                    stylesheet=False,
                )
            for ref in refs.stylesheets:
                resolve(
                    entry,
                    ref,
                    base_dir=base_dir,
                    base_url=None,
                    depth=1,
                    stylesheet=True,
                )
            for ref, is_import in refs.css:
                resolve(
                    entry,
                    ref,
                    base_dir=base_dir,
                    base_url=None,
                    depth=1,
                    stylesheet=is_import,
                )
            for ref in refs.module_scripts:
                local = local_path(ref, base_dir=base_dir)
                if local is not None:
                    if local in files and imports_urls(_text(files[local].content)):
                        warn_module(local)
                elif (url := external_url(ref)) is not None:
                    module_urls.add(url)
            if any(imports_urls(block) for block in refs.inline_module_text):
                warn_module(path)
        elif _is_css(path):
            for ref, is_import in css_references(_text(item.content)):
                resolve(
                    entry,
                    ref,
                    base_dir=base_dir,
                    base_url=None,
                    depth=1,
                    stylesheet=is_import,
                )

    used = 0
    index = 0
    gate = asyncio.Semaphore(FETCH_CONCURRENCY)
    deadline = time.monotonic() + CAPTURE_DEADLINE_SECONDS

    async def fetch_one(url: str) -> Fetched | CaptureFailed:
        """One download, capped by what is left of the budget when it starts."""
        nonlocal used
        async with gate:
            limit = min(max_file_bytes, byte_budget - used)
            if limit <= 0:
                return CaptureFailed(_OVER_BUDGET)
            left = deadline - time.monotonic()
            if left <= 0:
                return CaptureFailed(_OUT_OF_TIME)
            try:
                fetched = await asyncio.wait_for(
                    fetch(url, limit), min(FETCH_DEADLINE_SECONDS, left)
                )
            except asyncio.TimeoutError:
                return CaptureFailed(
                    "the download took too long"
                    if left > FETCH_DEADLINE_SECONDS
                    else _OUT_OF_TIME
                )
            except CaptureFailed as exc:
                over_budget = exc.reason == _OVER_FILE_LIMIT and limit < max_file_bytes
                return CaptureFailed(_OVER_BUDGET) if over_budget else exc
            # Parallel downloads can each fit the budget they started with and not all fit.
            if used + len(fetched.content) > byte_budget:
                return CaptureFailed(_OVER_BUDGET)
            used += len(fetched.content)
            return fetched

    # One level of the graph per pass: everything queued so far is fetched together, and the
    # stylesheets it brings in queue the next level.
    while index < len(pending):
        level, index = pending[index:], len(pending)
        room = max(0, MAX_EXTERNAL_URLS - len(result.external))
        for url, _, _ in level[room:]:
            result.failed.append(ShareIssue(url=url, reason="over the 30 URL limit"))
        level = level[:room]
        outcomes = await asyncio.gather(*(fetch_one(url) for url, _, _ in level))
        for (url, depth, stylesheet), fetched in zip(level, outcomes):
            if isinstance(fetched, CaptureFailed):
                result.failed.append(ShareIssue(url=url, reason=fetched.reason))
                continue
            result.external[url] = fetched

            if stylesheet or _is_css(fetched.content_type):
                if depth < MAX_EXTERNAL_DEPTH:
                    for ref, is_import in css_references(_text(fetched.content)):
                        resolve(
                            url_key(url),
                            ref,
                            base_dir=None,
                            base_url=fetched.final_url,
                            depth=depth + 1,
                            stylesheet=is_import,
                        )
            elif url in module_urls and imports_urls(_text(fetched.content)):
                warn_module(url)

    # A reference whose target was not captured has no entry, so the viewer drops it.
    missing = queued - set(result.external)
    for refs in result.refs.values():
        for ref in [r for r, t in refs.items() if t.get("url") in missing]:
            del refs[ref]
    return result
