"""A fake Slack Web API: an `httpx.AsyncBaseTransport` backed by a small
scripted workspace (channels, messages, threads).

Unlike a stub that answers any request with the next canned body, this
answers the request it actually received: an unknown method, a missing
bearer token, or a missing `channel` gets Slack's own error shape, and
`chat.postMessage` / `chat.update` / `conversations.*` read and write real
state, so "post then edit" is provable against what the fake is holding
rather than against the adapter's own request log.

No wall clock, no randomness: message `ts` values come from a counter seeded
in the constructor.
"""

import json
from typing import Any, Dict, List, Optional

import httpx


class FakeSlackWorkspace:
    """Scripted state: a bot token, a channel set, and the messages posted or
    pre-seeded into each. `ts` is minted from a seeded counter, never from
    `time.time()`, so a test asserting a specific value is stable."""

    def __init__(
        self,
        *,
        bot_token: str = "xoxb-fake",
        channels: Optional[List[Dict[str, Any]]] = None,
        ts_seed: float = 1000.0,
        team_id: str = "T-fake",
        bot_user_id: str = "UBOT1",
        bot_username: str = "agenta",
        api_app_id: str = "A-fake",
    ) -> None:
        self.bot_token = bot_token
        self.team_id = team_id
        self.bot_user_id = bot_user_id
        self.bot_username = bot_username
        self.api_app_id = api_app_id
        self.channels: Dict[str, Dict[str, Any]] = {
            entry["id"]: dict(entry) for entry in (channels or [])
        }
        # messages[channel_id][ts] = message dict; insertion order is post order.
        self.messages: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._next_ts = ts_seed

    def add_channel(self, *, id: str, name: str, **extra: Any) -> None:
        self.channels[id] = {"id": id, "name": name, **extra}

    def seed_message(
        self, *, channel: str, text: str, thread_ts: Optional[str] = None, **extra: Any
    ) -> str:
        """Pre-populate a message without going through `chat.postMessage`,
        for tests that need history to already exist."""

        ts = self._mint_ts()
        bucket = self.messages.setdefault(channel, {})
        bucket[ts] = {
            "type": "message",
            "channel": channel,
            "ts": ts,
            "text": text,
            **({"thread_ts": thread_ts} if thread_ts else {}),
            **extra,
        }
        # Slack stamps the parent with its own ts once it has a reply, which is
        # what makes a thread parent distinguishable in a history read.
        if thread_ts and thread_ts in bucket:
            bucket[thread_ts]["thread_ts"] = thread_ts
        return ts

    def _mint_ts(self) -> str:
        ts = f"{self._next_ts:.1f}"
        self._next_ts += 1.0
        return ts

    def post_message(
        self,
        *,
        channel: str,
        text: str,
        thread_ts: Optional[str] = None,
        blocks: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        ts = self._mint_ts()
        message = {
            "type": "message",
            "channel": channel,
            "ts": ts,
            "text": text,
            "user": "UBOT1",
        }
        if thread_ts:
            message["thread_ts"] = thread_ts
        if blocks:
            message["blocks"] = blocks
        self.messages.setdefault(channel, {})[ts] = message
        return message

    def update_message(
        self,
        *,
        channel: str,
        ts: str,
        text: str,
        blocks: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, Any]]:
        bucket = self.messages.get(channel, {})
        message = bucket.get(ts)
        if message is None:
            return None
        message["text"] = text
        if blocks:
            message["blocks"] = blocks
        return message

    def history(
        self, *, channel: str, limit: int, latest: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Top-level channel messages, oldest first, threaded replies excluded —
        matching `conversations.history`. With `latest` (exclusive), the
        `limit` newest messages before it, newest first, as Slack pages."""

        bucket = self.messages.get(channel, {})
        top_level = [
            m for m in bucket.values() if m.get("thread_ts") in (None, m["ts"])
        ]
        if latest:
            before = [m for m in top_level if float(m["ts"]) < float(latest)]
            before.reverse()
            return before[:limit] if limit else before
        return top_level[:limit] if limit else top_level

    def replies(
        self, *, channel: str, thread_ts: str, limit: int
    ) -> List[Dict[str, Any]]:
        """The parent plus every reply, oldest first — matching
        `conversations.replies`."""

        bucket = self.messages.get(channel, {})
        parent = bucket.get(thread_ts)
        replies = [
            m
            for ts, m in bucket.items()
            if ts != thread_ts and m.get("thread_ts") == thread_ts
        ]
        ordered = ([parent] if parent else []) + replies
        return ordered[:limit] if limit else ordered


_READ_METHODS = {
    "users.conversations",
    "conversations.list",
    "conversations.history",
    "conversations.replies",
    "conversations.info",
    "conversations.join",
}


class FakeSlackTransport(httpx.AsyncBaseTransport):
    """Routes each request to the endpoint it names, rejecting a request
    Slack would reject rather than answering it. `force_error` lets a test
    make the next call to a given method fail with a chosen Slack error
    shape without mutating the fake's stored state."""

    def __init__(self, workspace: FakeSlackWorkspace) -> None:
        self.workspace = workspace
        self.requests: List[httpx.Request] = []
        self._forced_errors: Dict[str, List[Dict[str, Any]]] = {}

    def force_error(
        self,
        method: str,
        *,
        error: str,
        status_code: int = 200,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        """Queue one forced failure for the next call to `method`."""

        self._forced_errors.setdefault(method, []).append(
            {"error": error, "status_code": status_code, "headers": headers or {}}
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        method = request.url.path.removeprefix("/api/").lstrip("/")

        token = _bearer_token(request.headers.get("authorization"))
        if not token:
            return _error_response("not_authed")
        if token != self.workspace.bot_token:
            return _error_response("invalid_auth")

        forced_queue = self._forced_errors.get(method)
        if forced_queue:
            forced = forced_queue.pop(0)
            return _error_response(
                forced["error"],
                status_code=forced["status_code"],
                headers=forced["headers"],
            )

        handler = self._ROUTES.get(method)
        if handler is None:
            return _error_response("unknown_method", status_code=404)

        # Slack reads a read method's arguments from the query string and a
        # write method's from the JSON body; the fake keeps that split.
        if method in _READ_METHODS:
            payload = _query_args(request)
        else:
            payload = _json_body(request)
        return handler(self, payload)

    # --- endpoints --- #

    def _auth_test(self, payload: Dict[str, Any]) -> httpx.Response:
        return _ok_response(
            {
                "team_id": self.workspace.team_id,
                "user_id": self.workspace.bot_user_id,
                "user": self.workspace.bot_username,
                "api_app_id": self.workspace.api_app_id,
            }
        )

    def _chat_post_message(self, payload: Dict[str, Any]) -> httpx.Response:
        channel = payload.get("channel")
        if not channel:
            return _error_response("channel_not_found")

        message = self.workspace.post_message(
            channel=channel,
            text=payload.get("text") or "",
            thread_ts=payload.get("thread_ts"),
            blocks=payload.get("blocks"),
        )
        return _ok_response({"channel": channel, "ts": message["ts"]})

    def _chat_update(self, payload: Dict[str, Any]) -> httpx.Response:
        channel = payload.get("channel")
        ts = payload.get("ts")
        if not channel or not ts:
            return _error_response("channel_not_found")

        message = self.workspace.update_message(
            channel=channel,
            ts=ts,
            text=payload.get("text") or "",
            blocks=payload.get("blocks"),
        )
        if message is None:
            return _error_response("message_not_found")
        return _ok_response({"channel": channel, "ts": message["ts"]})

    def _conversations_list(self, payload: Dict[str, Any]) -> httpx.Response:
        limit = payload.get("limit") or 100
        cursor = payload.get("cursor") or ""
        all_channels = list(self.workspace.channels.values())

        start = int(cursor) if cursor else 0
        page = all_channels[start : start + limit]
        next_cursor = str(start + limit) if start + limit < len(all_channels) else ""

        return _ok_response(
            {
                "channels": page,
                "response_metadata": {"next_cursor": next_cursor},
            }
        )

    def _users_conversations(self, payload: Dict[str, Any]) -> httpx.Response:
        limit = payload.get("limit") or 100
        cursor = payload.get("cursor") or ""
        mine = [c for c in self.workspace.channels.values() if c.get("is_member")]

        start = int(cursor) if cursor else 0
        page = mine[start : start + limit]
        next_cursor = str(start + limit) if start + limit < len(mine) else ""

        return _ok_response(
            {"channels": page, "response_metadata": {"next_cursor": next_cursor}}
        )

    def _conversations_history(self, payload: Dict[str, Any]) -> httpx.Response:
        channel = payload.get("channel")
        if not channel:
            return _error_response("channel_not_found")
        if channel not in self.workspace.channels:
            return _error_response("channel_not_found")

        limit = payload.get("limit") or 0
        latest = str(payload["latest"]) if payload.get("latest") else None
        messages = self.workspace.history(channel=channel, limit=limit, latest=latest)
        everything = self.workspace.history(channel=channel, limit=0, latest=latest)
        return _ok_response(
            {"messages": messages, "has_more": bool(limit) and len(everything) > limit}
        )

    def _conversations_replies(self, payload: Dict[str, Any]) -> httpx.Response:
        channel = payload.get("channel")
        thread_ts = payload.get("ts")
        if not channel or not thread_ts:
            return _error_response("channel_not_found")
        if channel not in self.workspace.channels:
            return _error_response("channel_not_found")

        everything = self.workspace.replies(
            channel=channel, thread_ts=thread_ts, limit=0
        )
        limit = payload.get("limit") or len(everything) or 1
        start = int(payload.get("cursor") or 0)
        page = everything[start : start + limit]
        more = start + limit < len(everything)
        return _ok_response(
            {
                "messages": page,
                "has_more": more,
                "response_metadata": {
                    "next_cursor": str(start + limit) if more else ""
                },
            }
        )

    def _conversations_info(self, payload: Dict[str, Any]) -> httpx.Response:
        entry = self.workspace.channels.get(payload.get("channel") or "")
        # A bot token cannot see a private channel it is not in.
        if entry is None or (entry.get("is_private") and not entry.get("is_member")):
            return _error_response("channel_not_found")
        return _ok_response({"channel": dict(entry)})

    def _conversations_join(self, payload: Dict[str, Any]) -> httpx.Response:
        entry = self.workspace.channels.get(payload.get("channel") or "")
        if entry is None:
            return _error_response("channel_not_found")
        if entry.get("is_private"):
            return _error_response("method_not_supported_for_channel_type")
        if entry.get("is_archived"):
            return _error_response("is_archived")
        entry["is_member"] = True
        return _ok_response({"channel": dict(entry)})

    _ROUTES = {
        "auth.test": _auth_test,
        "chat.postMessage": _chat_post_message,
        "chat.update": _chat_update,
        "users.conversations": _users_conversations,
        "conversations.list": _conversations_list,
        "conversations.history": _conversations_history,
        "conversations.replies": _conversations_replies,
        "conversations.info": _conversations_info,
        "conversations.join": _conversations_join,
    }


def _bearer_token(header_value: Optional[str]) -> Optional[str]:
    if not header_value or not header_value.startswith("Bearer "):
        return None
    return header_value.removeprefix("Bearer ")


def _json_body(request: httpx.Request) -> Dict[str, Any]:
    """A write method's arguments: the JSON body, as Slack reads them."""
    if not request.content:
        return {}
    return json.loads(request.content)


def _query_args(request: httpx.Request) -> Dict[str, Any]:
    """A read method's arguments: the query string ONLY, as Slack reads them.
    A JSON body on a read method is ignored here exactly as Slack ignores it,
    so an adapter that sends one gets the defaults and the test sees it.
    Numeric values come back as ints so handlers page the same way."""
    args: Dict[str, Any] = {}
    for key, value in request.url.params.multi_items():
        args[key] = int(value) if value.isdigit() else value
    return args


def _ok_response(body: Dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json={"ok": True, **body})


def _error_response(
    error: str,
    *,
    status_code: int = 200,
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    return httpx.Response(
        status_code, json={"ok": False, "error": error}, headers=headers or {}
    )


def make_adapter_and_workspace(**workspace_kwargs: Any):
    """Convenience for tests: a `SlackAdapter` wired to a fresh fake, plus the
    workspace and transport so a test can seed state or force an error."""

    from oss.src.core.channels.adapters.slack.adapter import SlackAdapter

    workspace = FakeSlackWorkspace(**workspace_kwargs)
    transport = FakeSlackTransport(workspace)
    client = httpx.AsyncClient(transport=transport, base_url="https://slack.com/api")
    adapter = SlackAdapter(http_client=client)
    return adapter, workspace, transport
