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
window closed, 131056 pair rate limit, 190 bad token); with a phone number
ID, only that number's next send, so parallel tests do not trip each other.

No wall clock and no randomness: message ids come from a counter.
"""

import base64
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

# Meta error code -> HTTP status. Meta answers most errors, throttling
# included (131056), with a 400; code 2 is "service temporarily unavailable".
_ERROR_STATUS = {190: 401, 2: 503}


class FakeGraph:
    def __init__(self, *, public_url: str = "https://graph.facebook.com") -> None:
        # phone_number_id -> {"token", "display_phone_number", "verified_name"}
        self.numbers: dict[str, dict[str, str]] = {}
        # every accepted /messages body, with its number, in order
        self.sent: list[dict[str, Any]] = []
        # every "status": "read" call (read receipt + typing indicator)
        self.typing: list[dict[str, Any]] = []
        self.typing_attempts = 0
        # media_id -> {"data", "mime_type", "token"}
        self.media: dict[str, dict[str, Any]] = {}
        # phone_number_id (or None for any number) -> queued Meta error codes
        self._failures: dict[str | None, list[dict[str, Any]]] = {}
        self._typing_failure: dict[str, Any] | None = None
        self._next_id = 0
        self.public_url = public_url.rstrip("/")
        self.app = Starlette(
            routes=[
                Route("/_fake/state", self._state, methods=["GET"]),
                Route("/_fake/numbers", self._add_number_route, methods=["POST"]),
                Route("/_fake/fail_next", self._fail_next_route, methods=["POST"]),
                Route("/_fake/media", self._add_media_route, methods=["POST"]),
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
        can_send: bool = True,
    ) -> None:
        """`can_send=False` is a token that can read the number but whose
        system user has no WhatsApp account assigned: Meta answers every
        POST to /messages with error 100 "Authorization Error", before it
        looks at the recipient (seen live, 2026-09-25)."""

        self.numbers[phone_number_id] = {
            "token": token,
            "verified_name": verified_name,
            "display_phone_number": display_phone_number,
            "can_send": can_send,
        }

    def add_media(
        self, *, media_id: str, data: bytes, mime_type: str, token: str
    ) -> None:
        self.media[media_id] = {"data": data, "mime_type": mime_type, "token": token}

    def fail_next(
        self,
        code: int,
        phone_number_id: str | None = None,
        *,
        message: str | None = None,
        subcode: int | None = None,
        details: str | None = None,
    ) -> None:
        """Fail the next send with Meta's error shape. `message`, `subcode`
        and `details` fill `error.message`, `error.error_subcode` and
        `error.error_data.details`, as Meta sends them."""

        self._failures.setdefault(phone_number_id, []).append(
            {"code": code, "message": message, "subcode": subcode, "details": details}
        )

    def fail_typing(
        self, code: int = 100, message: str = "Authorization Error"
    ) -> None:
        """Every typing indicator (read receipt) from now on fails."""

        self._typing_failure = {"code": code, "message": message}

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
    def _error(
        code: int,
        message: str,
        status: int = 400,
        *,
        subcode: int | None = None,
        details: str | None = None,
    ) -> JSONResponse:
        error: dict[str, Any] = {
            "message": message,
            "type": "OAuthException",
            "code": code,
            "fbtrace_id": "AbCdEfFakeTrace",
        }
        if subcode is not None:
            error["error_subcode"] = subcode
        if details is not None:
            error["error_data"] = {"messaging_product": "whatsapp", "details": details}
        return JSONResponse({"error": error}, status_code=status)

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

        if not number.get("can_send", True):
            return self._error(100, "Authorization Error")

        body = await request.json()
        if body.get("messaging_product") != "whatsapp":
            return self._error(100, "messaging_product must be whatsapp")

        if body.get("status") == "read":
            if not body.get("message_id"):
                return self._error(100, "message_id is required")
            if self._typing_failure:
                self.typing_attempts += 1
                return self._error(
                    self._typing_failure["code"], self._typing_failure["message"]
                )
            self.typing.append({"phone_number_id": phone_number_id, **body})
            return JSONResponse({"success": True})

        queue = self._failures.get(phone_number_id) or self._failures.get(None)
        if queue:
            failure = queue.pop(0)
            code = failure["code"]
            return self._error(
                code,
                failure["message"] or f"fake failure {code}",
                _ERROR_STATUS.get(code, 400),
                subcode=failure["subcode"],
                details=failure["details"],
            )

        if body.get("to") == "0":
            # Not a WhatsApp number: Meta refuses the recipient, sends nothing.
            return self._error(
                131030,
                "(#131030) Recipient phone number not in allowed list",
                details="Recipient phone number not in allowed list",
            )
        if not body.get("to") or body.get("type") not in (
            "text",
            "interactive",
            "template",
            "image",
            "document",
        ):
            return self._error(100, "Invalid parameter")

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

    async def _add_media_route(self, request: Request) -> Response:
        body = await request.json()
        self.add_media(
            media_id=body["media_id"],
            data=base64.b64decode(body["data_base64"]),
            mime_type=body["mime_type"],
            token=body["token"],
        )
        return JSONResponse({"ok": True})

    async def _fail_next_route(self, request: Request) -> Response:
        body = await request.json()
        self.fail_next(int(body["code"]), body.get("phone_number_id"))
        return JSONResponse({"ok": True})
