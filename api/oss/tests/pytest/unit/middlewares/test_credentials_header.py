"""`X-AG-Credentials` is the gateways' inbound credentials header (D31).

It exists because on a subscription pass-through route `Authorization` carries the
caller's own vendor auth, which is not ours to read — so a fallback ordering would
read the wrong header exactly where the header was introduced to help.
"""

from starlette.requests import Request

from oss.src.middlewares.auth import _credentials_header


def _request(headers: dict, path: str = "/") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "GET", "path": path, "headers": raw})


_DATA_PLANE = "/gateways/llms/custom/acme/v1/chat/completions"
_CRUD = "/gateways/llms/endpoints/"


def test_authorization_alone_is_still_read():
    assert _credentials_header(_request({"Authorization": "ApiKey k"})) == "ApiKey k"


def test_credentials_header_alone_is_read():
    assert (
        _credentials_header(_request({"X-AG-Credentials": "Secret jwt"}))
        == "Secret jwt"
    )


def test_credentials_header_wins_when_both_are_present():
    request = _request(
        {
            "Authorization": "Bearer vendor-subscription",
            "X-AG-Credentials": "Secret jwt",
        }
    )

    assert _credentials_header(request) == "Secret jwt"


def test_neither_header_yields_none():
    assert _credentials_header(_request({})) is None


def test_header_lookup_is_case_insensitive():
    assert _credentials_header(_request({"x-ag-credentials": "Secret jwt"})) == (
        "Secret jwt"
    )


# Data-plane credentials


def test_data_plane_ignores_authorization_entirely():
    """There `Authorization` is the caller's own vendor auth, bound for the upstream —
    reading it as ours is how a subscription token gets mistaken for a gateway token."""
    request = _request({"Authorization": "ApiKey k"}, path=_DATA_PLANE)

    assert _credentials_header(request) is None


def test_data_plane_still_reads_our_header():
    request = _request({"X-AG-Credentials": "Secret jwt"}, path=_DATA_PLANE)

    assert _credentials_header(request) == "Secret jwt"


def test_the_crud_routes_under_the_same_prefix_keep_the_fallback():
    """`/gateways/{plane}/endpoints/...` is ordinary CRUD; no namespace spells
    `endpoints`, which is what keeps the two apart under one mount prefix."""
    request = _request({"Authorization": "ApiKey k"}, path=_CRUD)

    assert _credentials_header(request) == "ApiKey k"


def test_the_mcp_data_plane_is_covered_too():
    request = _request({"Authorization": "ApiKey k"}, path="/gateways/mcps/custom/acme")

    assert _credentials_header(request) is None


def test_the_api_prefixed_data_plane_is_covered_too():
    request = _request(
        {"Authorization": "ApiKey k"},
        path="/api/gateways/llms/standard/openai/v1/models",
    )

    assert _credentials_header(request) is None
