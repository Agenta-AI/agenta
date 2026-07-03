import pytest

from oss.src.middlewares.prefix import ApiPrefixStripMiddleware


def _scope(path: str, raw_path: bytes | None = None) -> dict:
    scope = {"type": "http", "path": path}
    if raw_path is not None:
        scope["raw_path"] = raw_path
    return scope


async def _run(scope: dict) -> dict:
    captured: dict = {}

    async def app(inner_scope, receive, send):
        captured["scope"] = inner_scope

    async def receive():
        return {}

    async def send(message):
        pass

    await ApiPrefixStripMiddleware(app)(scope, receive, send)
    return captured["scope"]


@pytest.mark.asyncio
async def test_strips_single_api_prefix():
    scope = await _run(_scope("/api/sessions/streams/", b"/api/sessions/streams/"))
    assert scope["path"] == "/sessions/streams/"
    assert scope["raw_path"] == b"/sessions/streams/"


@pytest.mark.asyncio
async def test_strips_double_api_prefix():
    # The bug this middleware exists to guard against: a caller that double-prefixes must
    # still route rather than 404 on a single strip pass.
    scope = await _run(
        _scope("/api/api/sessions/streams/", b"/api/api/sessions/streams/")
    )
    assert scope["path"] == "/sessions/streams/"
    assert scope["raw_path"] == b"/sessions/streams/"


@pytest.mark.asyncio
async def test_bare_api_root_strips_to_slash():
    scope = await _run(_scope("/api"))
    assert scope["path"] == "/"


@pytest.mark.asyncio
async def test_no_prefix_left_untouched():
    scope = await _run(_scope("/sessions/streams/", b"/sessions/streams/"))
    assert scope["path"] == "/sessions/streams/"
    assert scope["raw_path"] == b"/sessions/streams/"


@pytest.mark.asyncio
async def test_path_that_merely_starts_with_api_word_is_untouched():
    # `/apiary` must not be mistaken for a prefixed `/api` path.
    scope = await _run(_scope("/apiary/thing"))
    assert scope["path"] == "/apiary/thing"
