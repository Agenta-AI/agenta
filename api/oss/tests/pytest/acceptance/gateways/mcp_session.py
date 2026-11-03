"""Speak to an MCP surface the way a conforming client has to.

These suites sent `tools/list` and `tools/call` with no session headers and read the answer
with `response.json()`. That works against an obliging server and against nothing else. The
mock enforces what a real server enforces (D54), so every one of those cases fails there,
and every one of them was measuring the mock's tolerance rather than the gateway.

Two rules, both the server's and neither optional:

- every request after `initialize` carries `MCP-Protocol-Version`, and it must be the
  version the server negotiated, not the one the client asked for;
- the answer may arrive as an event stream, with notifications ahead of it, so it is found
  by its frame rather than by position.

The negotiated version is read from the handshake rather than written down here, so a server
that negotiates a different one keeps these cases honest.
"""

import json
from typing import Any, Callable, Dict


#: What a client offers. The server answers with the version it will actually speak.
_OFFERED_VERSION = "2025-06-18"


def jsonrpc_envelope(response) -> Dict[str, Any]:
    """The JSON-RPC envelope, whichever framing came back."""
    body = response.text
    if "data:" not in body:
        return response.json()
    payloads = [
        json.loads(line[len("data:") :].strip())
        for line in body.splitlines()
        if line.startswith("data:")
    ]
    answers = [p for p in payloads if "result" in p or "error" in p]
    assert answers, body
    return answers[-1]


def assert_ok(response) -> Dict[str, Any]:
    assert response.status_code == 200, response.text
    return jsonrpc_envelope(response)


def session_headers(post: Callable[[Dict[str, Any]], Any]) -> Dict[str, str]:
    """Handshake through `post` and return the headers the rest of the session needs.

    `post` takes one JSON-RPC payload and returns the response, so a caller passes whatever
    it already uses to reach the surface: the gateway relay, a browser session, or the mock
    directly.
    """
    handshake = post(
        {
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": _OFFERED_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "agenta-acceptance", "version": "0"},
            },
        }
    )
    negotiated = assert_ok(handshake)["result"]["protocolVersion"]
    return {"MCP-Protocol-Version": negotiated}


def listed_tools(post: Callable[..., Any]) -> set:
    """Every tool the surface offers, following its pagination.

    `post` takes a payload and keyword `headers`. A server may page, and the mock pages one
    tool at a time on purpose: a caller that reads the first page only sees one tool and
    calls it the catalogue.
    """
    headers = session_headers(lambda payload: post(payload, headers=None))
    names: set = set()
    cursor = None
    for request_id in range(1, 20):
        params = {"cursor": cursor} if cursor else {}
        result = assert_ok(
            post(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": "tools/list",
                    "params": params,
                },
                headers=headers,
            )
        )["result"]
        names.update(tool["name"] for tool in result.get("tools", []))
        cursor = result.get("nextCursor")
        if not cursor:
            return names
    raise AssertionError("the surface paginated further than any real catalogue would")
