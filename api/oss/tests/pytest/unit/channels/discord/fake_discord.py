"""A fake Discord REST API, as an ASGI app.

Unit tests mount it under `httpx.ASGITransport`. It answers the request it
received rather than replaying canned bodies: a wrong bot token gets a 401,
an unknown channel Discord's error 10003, a second thread on one message
error 160004, and every accepted call is kept so a test asserts on what the
fake holds.

Only the calls the adapter makes are served, under `/api/v10`:

- GET    /applications/@me
- GET    /channels/{channel_id}
- GET    /channels/{channel_id}/messages
- POST   /channels/{channel_id}/messages
- PATCH  /channels/{channel_id}/messages/{message_id}
- POST   /channels/{channel_id}/messages/{message_id}/threads
- POST   /channels/{channel_id}/typing
- PUT    /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me
- DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me
- POST   /interactions/{interaction_id}/{interaction_token}/callback

No wall clock and no randomness: message ids come from a counter.
"""

from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import payloads as p

BASE_URL = "https://discord.com/api/v10"


class FakeDiscord:
    def __init__(
        self, *, token: str = p.BOT_TOKEN, flags: int = p.MESSAGE_CONTENT_FLAG
    ) -> None:
        self.token = token
        self.flags = flags
        # channel id -> channel object; threads are added when started
        self.channels: Dict[str, Dict[str, Any]] = {
            p.CHANNEL_ID: {
                "id": p.CHANNEL_ID,
                "type": 0,
                "guild_id": p.GUILD_ID,
                "name": p.CHANNEL_NAME,
            },
            p.DM_CHANNEL_ID: {"id": p.DM_CHANNEL_ID, "type": 1},
        }
        self.history: Dict[str, List[Dict[str, Any]]] = {}
        # every accepted message body, with its channel and new id, in order
        self.sent: List[Dict[str, Any]] = []
        self.edits: List[Dict[str, Any]] = []
        self.threads_started: List[Dict[str, Any]] = []
        # the message id of every thread start call, refused ones included
        self.thread_start_attempts: List[str] = []
        self.deleted_messages: set = set()
        self.typing: List[str] = []
        self.reactions: List[Dict[str, str]] = []
        self.callbacks: List[Dict[str, Any]] = []
        self.channel_reads: List[str] = []
        self.thread_start_failures: List[int] = []
        self.roles: List[Dict[str, Any]] = [
            {"id": p.GUILD_ID, "name": "@everyone"},
            {"id": p.OTHER_ROLE_ID, "name": "Support"},
            {
                "id": p.BOT_ROLE_ID,
                "name": p.APPLICATION_NAME,
                "managed": True,
                "tags": {"bot_id": p.BOT_USER_ID},
            },
        ]
        self.role_reads: List[str] = []
        self.fail_role_reads = False
        self._next_id = 1_500_000_000_000_000_000
        prefix = "/api/v10"
        self.app = Starlette(
            routes=[
                Route(f"{prefix}/applications/@me", self._application),
                Route(
                    f"{prefix}/channels/{{channel_id}}/messages/{{message_id}}"
                    "/reactions/{emoji}/@me",
                    self._reaction,
                    methods=["PUT", "DELETE"],
                ),
                Route(
                    f"{prefix}/channels/{{channel_id}}/messages/{{message_id}}/threads",
                    self._start_thread,
                    methods=["POST"],
                ),
                Route(
                    f"{prefix}/channels/{{channel_id}}/messages/{{message_id}}",
                    self._edit,
                    methods=["PATCH"],
                ),
                Route(
                    f"{prefix}/channels/{{channel_id}}/messages",
                    self._messages,
                    methods=["GET", "POST"],
                ),
                Route(
                    f"{prefix}/channels/{{channel_id}}/typing",
                    self._typing,
                    methods=["POST"],
                ),
                Route(f"{prefix}/channels/{{channel_id}}", self._channel),
                Route(f"{prefix}/guilds/{{guild_id}}/roles", self._roles),
                Route(
                    f"{prefix}/interactions/{{interaction_id}}/{{token}}/callback",
                    self._callback,
                    methods=["POST"],
                ),
            ]
        )

    # --- scripting ---------------------------------------------------------- #

    def add_thread(self, thread_id: str, *, parent_id: str = p.CHANNEL_ID) -> None:
        self.channels[thread_id] = {
            "id": thread_id,
            "type": 11,
            "guild_id": p.GUILD_ID,
            "parent_id": parent_id,
        }

    def fail_thread_start(self, status: int = 503) -> None:
        """The next thread start answers with this HTTP status."""

        self.thread_start_failures.append(status)

    def texts_in(self, channel_id: str) -> List[str]:
        return [m["content"] for m in self.sent if m["channel_id"] == channel_id]

    # --- handlers ----------------------------------------------------------- #

    def _authorized(self, request: Request) -> bool:
        return request.headers.get("authorization") == f"Bot {self.token}"

    @staticmethod
    def _error(code: int, message: str, status: int) -> JSONResponse:
        return JSONResponse({"code": code, "message": message}, status_code=status)

    def _unauthorized(self) -> JSONResponse:
        return self._error(0, "401: Unauthorized", 401)

    def _unknown_channel(self) -> JSONResponse:
        return self._error(10003, "Unknown Channel", 404)

    def _new_id(self) -> str:
        self._next_id += 1
        return str(self._next_id)

    async def _application(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        return JSONResponse(
            {
                "id": p.APPLICATION_ID,
                "name": p.APPLICATION_NAME,
                "flags": self.flags,
                "bot": {"id": p.BOT_USER_ID, "username": p.BOT_USERNAME, "bot": True},
            }
        )

    async def _channel(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        channel_id = request.path_params["channel_id"]
        self.channel_reads.append(channel_id)
        channel = self.channels.get(channel_id)
        return JSONResponse(channel) if channel else self._unknown_channel()

    async def _roles(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        self.role_reads.append(request.path_params["guild_id"])
        if self.fail_role_reads:
            return self._error(0, "503: fake failure", 503)
        return JSONResponse(self.roles)

    async def _messages(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        channel_id = request.path_params["channel_id"]
        if channel_id not in self.channels:
            return self._unknown_channel()
        if request.method == "GET":
            limit = int(request.query_params.get("limit", 50))
            return JSONResponse(self.history.get(channel_id, [])[:limit])
        body = await request.json()
        if len(body.get("content") or "") > 2000:
            return self._error(50035, "Invalid Form Body", 400)
        message = {"id": self._new_id(), "channel_id": channel_id, **body}
        self.sent.append(message)
        return JSONResponse(message)

    async def _edit(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        self.edits.append({**request.path_params, **(await request.json())})
        return JSONResponse({"id": request.path_params["message_id"]})

    async def _start_thread(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        channel_id = request.path_params["channel_id"]
        message_id = request.path_params["message_id"]
        if channel_id not in self.channels:
            return self._unknown_channel()
        self.thread_start_attempts.append(message_id)
        if message_id in self.deleted_messages:
            return self._error(10008, "Unknown Message", 404)
        if self.thread_start_failures:
            status = self.thread_start_failures.pop(0)
            return self._error(0, f"{status}: fake failure", status)
        if message_id in self.channels:
            return self._error(
                160004, "A thread has already been created for this message", 400
            )
        body = await request.json()
        self.add_thread(message_id, parent_id=channel_id)
        self.threads_started.append(
            {"channel_id": channel_id, "message_id": message_id, **body}
        )
        return JSONResponse(self.channels[message_id], status_code=201)

    async def _typing(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        channel_id = request.path_params["channel_id"]
        if channel_id not in self.channels:
            return self._unknown_channel()
        self.typing.append(channel_id)
        return Response(status_code=204)

    async def _reaction(self, request: Request) -> Response:
        if not self._authorized(request):
            return self._unauthorized()
        self.reactions.append(
            {
                "method": request.method,
                "channel_id": request.path_params["channel_id"],
                "message_id": request.path_params["message_id"],
                "emoji": unquote(request.path_params["emoji"]),
            }
        )
        return Response(status_code=204)

    async def _callback(self, request: Request) -> Response:
        self.callbacks.append({**request.path_params, **(await request.json())})
        return Response(status_code=204)


def answer(
    fake: FakeDiscord, channel_id: str, content: str, *, author: Optional[dict] = None
) -> None:
    """Put a message in a channel's history, newest first, as Discord reads."""

    fake.history.setdefault(channel_id, []).insert(
        0,
        p.message(
            content,
            message_id=fake._new_id(),
            channel_id=channel_id,
            author=author,
        )["d"],
    )
