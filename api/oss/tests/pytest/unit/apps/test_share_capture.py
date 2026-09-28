"""Publish-time capture: the reference graph, the budget, and what gets reported."""

import pytest

from oss.src.core.apps.share_capture import (
    CaptureFailed,
    Fetched,
    LocalFile,
    capture,
    css_references,
    external_url,
    html_references,
    local_path,
)

MB = 1024 * 1024


def _files(**texts):
    return {
        path: LocalFile(path=path, content=text.encode(), content_type="text/plain")
        for path, text in texts.items()
    }


class FakeWeb:
    """A tiny web: URL -> (content type, body), plus where each URL finally landed."""

    def __init__(self, pages, *, final=None, fail=()):
        self.pages = pages
        self.final = final or {}
        self.fail = set(fail)
        self.calls = []

    async def __call__(self, url, max_bytes):
        self.calls.append(url)
        if url in self.fail or url not in self.pages:
            raise CaptureFailed("the address is not reachable from the server")
        content_type, body = self.pages[url]
        if len(body) > max_bytes:
            raise CaptureFailed("the file is over the size limit")
        return Fetched(
            final_url=self.final.get(url, url), content=body, content_type=content_type
        )


def test_html_references_cover_every_kind():
    refs = html_references(
        '<link rel="stylesheet" href="a.css"><script src="b.js"></script>'
        '<img src="c.png"><style>.x{background:url(d.png)}</style>'
        '<div style="background:url(\'e.png\')"></div>'
    )
    assert refs.stylesheets == ["a.css"]
    assert refs.scripts == ["b.js"]
    assert refs.images == ["c.png"]
    assert [ref for ref, _ in refs.css] == ["d.png", "e.png"]


def test_css_references_mark_imports():
    refs = css_references('@import "base.css"; .a{src:url(f.woff2)}')
    assert ("base.css", True) in refs and ("f.woff2", False) in refs


def test_local_paths_stay_inside_the_app():
    assert local_path("img/a.png", base_dir="") == "img/a.png"
    assert local_path("../a.png", base_dir="css") == "a.png"
    assert local_path("../../x", base_dir="css") is None
    assert local_path("/abs", base_dir="") is None
    assert local_path("https://x/a", base_dir="") is None


def test_external_urls_are_https_only():
    assert external_url("//cdn/a.js") == "https://cdn/a.js"
    assert external_url("http://cdn/a.js") is None
    assert external_url("data:x") is None
    assert external_url("fonts/a.woff2", base_url="https://cdn/css/x.css") == (
        "https://cdn/css/fonts/a.woff2"
    )


@pytest.mark.asyncio
async def test_a_web_font_stylesheet_brings_its_font_files():
    css_url = "https://fonts.googleapis.com/css2?family=Inter"
    font_url = "https://fonts.gstatic.com/inter.woff2"
    web = FakeWeb(
        {
            css_url: ("text/css", f"@font-face{{src:url({font_url})}}".encode()),
            font_url: ("font/woff2", b"FONT"),
        }
    )
    result = await capture(
        files=_files(**{"index.html": f'<link rel="stylesheet" href="{css_url}">'}),
        byte_budget=25 * MB,
        max_file_bytes=5 * MB,
        fetch=web,
    )
    assert set(result.external) == {css_url, font_url}
    assert result.refs[f"url:{css_url}"][font_url] == {"url": font_url}


@pytest.mark.asyncio
async def test_relative_references_in_a_captured_stylesheet_resolve_against_its_final_url():
    css_url = "https://cdn/katex.css"
    web = FakeWeb(
        {
            css_url: ("text/css", b".k{src:url(fonts/k.woff2)}"),
            "https://cdn/v2/fonts/k.woff2": ("font/woff2", b"K"),
        },
        final={css_url: "https://cdn/v2/katex.css"},
    )
    result = await capture(
        files=_files(**{"index.html": f'<link rel="stylesheet" href="{css_url}">'}),
        byte_budget=25 * MB,
        max_file_bytes=5 * MB,
        fetch=web,
    )
    assert "https://cdn/v2/fonts/k.woff2" in result.external


@pytest.mark.asyncio
async def test_a_refused_address_is_reported_and_dropped_from_refs():
    bad = "https://10.0.0.5/lib.js"
    result = await capture(
        files=_files(**{"index.html": f'<script src="{bad}"></script>'}),
        byte_budget=25 * MB,
        max_file_bytes=5 * MB,
        fetch=FakeWeb({}, fail=[bad]),
    )
    assert [(f.url, f.reason) for f in result.failed] == [(bad, "the address is not reachable from the server")]
    assert bad not in result.refs.get("file:index.html", {})


@pytest.mark.asyncio
async def test_more_than_thirty_urls_are_reported():
    urls = [f"https://cdn/{i}.js" for i in range(32)]
    web = FakeWeb({u: ("application/javascript", b"x") for u in urls})
    html = "".join(f'<script src="{u}"></script>' for u in urls)
    result = await capture(
        files=_files(**{"index.html": html}),
        byte_budget=25 * MB,
        max_file_bytes=5 * MB,
        fetch=web,
    )
    assert len(result.external) == 30
    assert [f.reason for f in result.failed] == ["over the 30 URL limit"] * 2


@pytest.mark.asyncio
async def test_captured_bytes_share_the_snapshot_budget():
    url = "https://cdn/big.js"
    result = await capture(
        files=_files(**{"index.html": f'<script src="{url}"></script>'}),
        byte_budget=10,
        max_file_bytes=5 * MB,
        fetch=FakeWeb({url: ("application/javascript", b"x" * 11)}),
    )
    assert result.external == {}
    assert result.failed[0].reason == "over the 25 MB snapshot limit"


@pytest.mark.asyncio
async def test_a_module_that_imports_urls_is_a_warning():
    result = await capture(
        files=_files(
            **{
                "index.html": '<script type="module" src="mod.js"></script>',
                "mod.js": 'import {h} from "https://esm.sh/preact"',
            }
        ),
        byte_budget=25 * MB,
        max_file_bytes=5 * MB,
        fetch=FakeWeb({}),
    )
    assert [(w.code, w.path) for w in result.warnings] == [("module_imports_not_captured", "mod.js")]


def test_import_url_forms_are_imports():
    refs = dict(css_references("@import url(theme.css); @import url('x.css'); .a{background:url(b.png)}"))
    assert refs == {"theme.css": True, "x.css": True, "b.png": False}
