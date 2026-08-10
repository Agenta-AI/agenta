"""Unit test for `api_call`'s query merging (run: `uv run --no-sync pytest` from `api/`,
or any interpreter with pytest + httpx: `pytest test_qa_matrix_lib_api_call.py`).

The trap this pins: httpx REPLACES an URL-embedded query string entirely when
`params=` is also passed. `api_call` hardcodes `params={"project_id": ...}`, so a
caller writing `api_call("GET", "/sessions/streams/?session_id=...")` silently lost
`session_id` and the endpoint 422ed with "Field required" — observed live as
benchmark scenarios failing at seed/verify while direct curls worked.
"""

import importlib
import sys
from pathlib import Path
from unittest.mock import patch


def _lib(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "https://qa.example")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("qa_matrix_lib", None)
    return importlib.import_module("qa_matrix_lib")


def _sent_url(lib, method, path, **kwargs):
    import httpx

    captured = {}

    def fake_request(method_, url, *, params=None, **kw):
        request = httpx.Request(method_, url, params=params)
        captured["url"] = str(request.url)
        return httpx.Response(200, request=request)

    with patch.object(lib, "httpx") as fake:
        fake.request = fake_request
        lib.api_call(method, path, **kwargs)
    return captured["url"]


def test_path_without_query_builds_the_same_request_as_before(monkeypatch):
    lib = _lib(monkeypatch)
    url = _sent_url(lib, "GET", "/workflows/abc")
    assert url == "https://qa.example/api/workflows/abc?project_id=proj-1"


def test_path_embedded_query_survives_the_project_id_params(monkeypatch):
    lib = _lib(monkeypatch)
    url = _sent_url(lib, "GET", "/sessions/streams/?session_id=sess-1")
    assert "session_id=sess-1" in url
    assert "project_id=proj-1" in url


def test_explicit_params_kwarg_merges_and_wins_over_the_path_query(monkeypatch):
    lib = _lib(monkeypatch)
    url = _sent_url(
        lib, "GET", "/sessions/streams/?session_id=old", params={"session_id": "new"}
    )
    assert "session_id=new" in url
    assert "session_id=old" not in url
    assert "project_id=proj-1" in url


def test_repeated_query_keys_are_preserved(monkeypatch):
    lib = _lib(monkeypatch)
    url = _sent_url(lib, "GET", "/workflows/query?workflow_refs=a&workflow_refs=b")
    assert "workflow_refs=a" in url
    assert "workflow_refs=b" in url
    assert "project_id=proj-1" in url
