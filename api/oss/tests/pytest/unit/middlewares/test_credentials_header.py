"""`X-AG-Credentials` is the gateways' inbound credentials header (D31).

It exists because on a subscription pass-through route `Authorization` carries the
caller's own vendor auth, which is not ours to read — so a fallback ordering would
read the wrong header exactly where the header was introduced to help.
"""

from starlette.requests import Request

from oss.src.middlewares.auth import _credentials_header


def _request(headers: dict) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw})


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
