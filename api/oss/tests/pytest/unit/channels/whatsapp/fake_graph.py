"""A fake Meta Graph API for the WhatsApp Cloud API, as an ASGI app.

Unit tests mount it under `httpx.ASGITransport`; the local end-to-end run
serves the same app with uvicorn, so both exercise one fake. It answers the
request it received rather than replaying canned bodies: a wrong bearer token
gets Meta's error 190, an unknown number a 400, and every accepted message is
kept so a test asserts on what the fake holds, not on the adapter's own log.

Only the calls the adapter makes are served:

- GET  /{version}/{phone_number_id}           read the number
- POST /{version}/{phone_number_id}/messages  send, or mark read + typing
- GET  /{version}/{media_id}                  media metadata (a download URL)
- GET  /media/{media_id}                      the media bytes

`fail_next(code)` makes the next send fail with a Meta error code (131047
window closed, 131056 pair rate limit, 190 bad token).

No wall clock and no randomness: message ids come from a counter.
"""

from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

_ERROR_STATUS = {190: 401, 131056: 429}


class FakeGraph:
    def __init__(self, *, public_url: str = "https://graph.facebook.com") -> None:
        # phone_number_id -> {"token", "display_phone_number", "verified_name"}
        self.numbers: dict[str, dict[str, str]] = {}
        # every accepted /messages body, with its number, in order
        self.sent: list[dict[str, Any]] = []
        # every "status": "read" call (read receipt + typing indicator)
        self.typing: list[dict[str, Any]] = []
        # media_id -> {"data", "mime_type", "token"}
        self.media: dict[str, dict[str, Any]] = {}
        self._failures: list[int] = []
        self._next_id = 0
        self.public_url = public_url.rstrip("/")
        self.app = Starlette(
            routes=[
                Route("/_fake/state", self._state, methods=["GET"]),
                Route("/_fake/numbers", self._add_number_route, methods=["POST"]),
                Route("/_fake/fail_next", self._fail_next_route, methods=["POST"]),
                Route("/media/{media_id}", self._media_bytes, methods=["GET"]),
                Route(
                    "/{version}/{phone_number_id}/messages",
                    self._messages,
                    methods=["POST"],
                ),
                Route("/{version}/{object_id}", self._read_object, methods=["GET"]),
            ]
        )

    # --- scripting ---------------------------------------------------------- #

    def add_number(
        self,
        *,
        phone_number_id: str,
        token: str,
        verified_name: str = "Bella Shoes",
        display_phone_number: str = "+1 555-010-0000",
    ) -> None:
        self.numbers[phone_number_id] = {
            "token": token,
            "verified_name": verified_name,
            "display_phone_number": display_phone_number,
        }

    def add_media(
        self, *, media_id: str, data: bytes, mime_type: str, token: str
    ) -> None:
        self.media[media_id] = {"data": data, "mime_type": mime_type, "token": token}

    def fail_next(self, code: int) -> None:
        self._failures.append(code)

    def texts_to(self, wa_id: str) -> list[str]:
        return [
            m["text"]["body"]
            for m in self.sent
            if m["to"] == wa_id and m["type"] == "text"
        ]

    # --- handlers ----------------------------------------------------------- #

    def _authorized(self, request: Request, token: str | None) -> bool:
        header = request.headers.get("authorization", "")
        return bool(token) and header == f"Bearer {token}"

    @staticmethod
    def _error(code: int, message: str, status: int = 400) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "message": message,
                    "type": "OAuthException",
                    "code": code,
                    "fbtrace_id": "fake",
                }
            },
            status_code=status,
        )

    async def _read_object(self, request: Request) -> Response:
        object_id = request.path_params["object_id"]
        number = self.numbers.get(object_id)
        if number is not None:
            if not self._authorized(request, number["token"]):
                return self._error(190, "Invalid OAuth access token.", 401)
            return JSONResponse(
                {
                    "id": object_id,
                    "display_phone_number": number["display_phone_number"],
                    "verified_name": number["verified_name"],
                    "quality_rating": "GREEN",
                }
            )
        media = self.media.get(object_id)
        if media is not None:
            if not self._authorized(request, media["token"]):
                return self._error(190, "Invalid OAuth access token.", 401)
            return JSONResponse(
                {
                    "id": object_id,
                    "url": f"{self.public_url}/media/{object_id}",
                    "mime_type": media["mime_type"],
                    "file_size": len(media["data"]),
                }
            )
        return self._error(
            100, f"Unsupported get request. Object {object_id} not found"
        )

    async def _media_bytes(self, request: Request) -> Response:
        media = self.media.get(request.path_params["media_id"])
        if media is None:
            return Response(status_code=404)
        if not self._authorized(request, media["token"]):
            return Response(status_code=401)
        return Response(media["data"], media_type=media["mime_type"])

    async def _messages(self, request: Request) -> Response:
        phone_number_id = request.path_params["phone_number_id"]
        number = self.numbers.get(phone_number_id)
        if number is None:
            return self._error(100, "Unknown phone number id")
        if not self._authorized(request, number["token"]):
            return self._error(190, "Invalid OAuth access token.", 401)

        body = await request.json()
        if body.get("messaging_product") != "whatsapp":
            return self._error(100, "messaging_product must be whatsapp")

        if body.get("status") == "read":
            if not body.get("message_id"):
                return self._error(100, "message_id is required")
            self.typing.append({"phone_number_id": phone_number_id, **body})
            return JSONResponse({"success": True})

        if not body.get("to") or body.get("type") not in (
            "text",
            "interactive",
            "template",
            "image",
            "document",
        ):
            return self._error(100, "Invalid parameter")

        if self._failures:
            code = self._failures.pop(0)
            return self._error(
                code, f"fake failure {code}", _ERROR_STATUS.get(code, 400)
            )

        self._next_id += 1
        message_id = f"wamid.out.{self._next_id}"
        self.sent.append({"phone_number_id": phone_number_id, "id": message_id, **body})
        return JSONResponse(
            {
                "messaging_product": "whatsapp",
                "contacts": [{"input": body["to"], "wa_id": body["to"]}],
                "messages": [{"id": message_id}],
            }
        )

    # --- control routes, for the live end-to-end run ------------------------ #

    async def _state(self, request: Request) -> Response:
        return JSONResponse({"sent": self.sent, "typing": self.typing})

    async def _add_number_route(self, request: Request) -> Response:
        self.add_number(**(await request.json()))
        return JSONResponse({"ok": True})

    async def _fail_next_route(self, request: Request) -> Response:
        self.fail_next(int((await request.json())["code"]))
        return JSONResponse({"ok": True})
