"""Microsoft's side of the Teams adapter, faked: the Bot Framework OpenID
document and key set, the Microsoft Entra token service and the Bot
Framework connector (sends and updates), served to the adapter through
`httpx.ASGITransport`. Test JWTs are signed with an RSA key
generated here, so nothing reaches Microsoft."""

import itertools
import json
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from oss.src.core.channels.adapters.teams.adapter import TeamsAdapter
from oss.src.core.channels.adapters.teams.signature import ISSUER

from . import payloads as p

KEY_ID = "test-key-1"
OTHER_KEY_ID = "test-key-2"
JWKS_URI = "https://login.botframework.com/v1/.well-known/keys"

_CONNECTOR_PATH = re.compile(
    r"^(?P<prefix>.*)/v3/conversations/(?P<conversation>[^/]+)/activities"
    r"(?:/(?P<activity_id>[^/]+))?$"
)


def _private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


PRIVATE_KEY = _private_key()
OTHER_PRIVATE_KEY = _private_key()


def public_jwk(private_key: rsa.RSAPrivateKey, key_id: str) -> Dict[str, Any]:
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": key_id, "use": "sig", "endorsements": ["msteams"]})
    return jwk


def sign_token(
    *,
    audience: str = p.APP_ID,
    issuer: str = ISSUER,
    service_url: Optional[str] = p.SERVICE_URL,
    expires_in: int = 3600,
    private_key: rsa.RSAPrivateKey = PRIVATE_KEY,
    key_id: str = KEY_ID,
    algorithm: str = "RS256",
) -> str:
    now = int(time.time())
    claims: Dict[str, Any] = {
        "iss": issuer,
        "aud": audience,
        "iat": now - 10,
        "nbf": now - 10,
        "exp": now + expires_in,
    }
    if service_url is not None:
        claims["serviceurl"] = service_url
    return jwt.encode(claims, private_key, algorithm=algorithm, headers={"kid": key_id})


def auth_headers(token: Optional[str] = None) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token or sign_token()}"}


class FakeMicrosoft:
    def __init__(self) -> None:
        self.keys: List[Dict[str, Any]] = [public_jwk(PRIVATE_KEY, KEY_ID)]
        self.key_reads = 0
        self.token_requests: List[Dict[str, Any]] = []
        self.token_status = 200
        self.token_body: Dict[str, Any] = {
            "token_type": "Bearer",
            "expires_in": 3599,
            "access_token": "fake-access-token",
        }
        # Each token request issues a new token after the first one.
        self.issued_tokens: List[str] = []
        self._token_numbers = itertools.count(1)
        # Every connector call, in order: method, host, conversation (as the
        # path names it, decoded), activity id for an update, the bearer
        # token and the JSON body.
        self.calls: List[Dict[str, Any]] = []
        self._failures: List[tuple] = []
        self._activity_numbers = itertools.count(1)
        self.app = Starlette(
            routes=[
                Route(
                    "/v1/.well-known/openidconfiguration",
                    self._openid_configuration,
                ),
                Route("/v1/.well-known/keys", self._keys),
                Route(
                    "/{tenant_id}/oauth2/v2.0/token",
                    self._token,
                    methods=["POST"],
                ),
                Route("/{path:path}", self._connector, methods=["POST", "PUT"]),
            ]
        )

    def refuse_token(self, *, status: int, error: str, code: int) -> None:
        self.token_status = status
        self.token_body = {
            "error": error,
            "error_description": f"AADSTS{code}: refused for the test.",
            "error_codes": [code],
        }

    def fail_next(
        self,
        status: int,
        *,
        code: str = "BadRequest",
        sub_code: Optional[str] = None,
        times: int = 1,
    ) -> None:
        """The next `times` connector calls answer `status`."""

        error: Dict[str, Any] = {"code": code, "message": f"{code} for the test."}
        if sub_code:
            error["subCode"] = sub_code
        self._failures.extend([(status, {"error": error})] * times)

    def sent(self, type_: str = "message") -> List[Dict[str, Any]]:
        return [
            call
            for call in self.calls
            if call["method"] == "POST"
            and call["status"] < 400
            and call["body"].get("type") == type_
        ]

    def updates(self) -> List[Dict[str, Any]]:
        return [c for c in self.calls if c["method"] == "PUT" and c["status"] < 400]

    def texts(self) -> List[str]:
        return [call["body"].get("text") for call in self.sent()]

    async def _connector(self, request: Request) -> JSONResponse:
        match = _CONNECTOR_PATH.match("/" + request.path_params["path"])
        if match is None:
            return JSONResponse({"error": {"code": "NotFound"}}, status_code=404)
        status, body = self._failures.pop(0) if self._failures else (200, None)
        activity_id = match.group("activity_id")
        if body is None:
            activity_id = (
                unquote(activity_id)
                if activity_id
                else f"1700000000{next(self._activity_numbers):03d}"
            )
            body = {"id": activity_id}
        authorization = request.headers.get("authorization") or ""
        self.calls.append(
            {
                "method": request.method,
                "host": request.headers.get("host"),
                "prefix": match.group("prefix"),
                "conversation": unquote(match.group("conversation")),
                "activity_id": match.group("activity_id"),
                "token": authorization.removeprefix("Bearer "),
                "body": await request.json(),
                "status": status,
            }
        )
        return JSONResponse(body, status_code=status)

    async def _openid_configuration(self, request: Request) -> JSONResponse:
        return JSONResponse({"issuer": ISSUER, "jwks_uri": JWKS_URI})

    async def _keys(self, request: Request) -> JSONResponse:
        self.key_reads += 1
        return JSONResponse({"keys": self.keys})

    async def _token(self, request: Request) -> JSONResponse:
        form = await request.form()
        self.token_requests.append(
            {
                "host": request.headers.get("host"),
                "tenant_id": request.path_params["tenant_id"],
                **dict(form),
            }
        )
        body = dict(self.token_body)
        if self.token_status < 400 and body.get("access_token"):
            number = next(self._token_numbers)
            if number > 1:
                body["access_token"] = f"{body['access_token']}-{number}"
            self.issued_tokens.append(body["access_token"])
        return JSONResponse(body, status_code=self.token_status)


def client_for(fake: FakeMicrosoft) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fake.app))


def adapter_for(fake: FakeMicrosoft) -> TeamsAdapter:
    return TeamsAdapter(http_client=client_for(fake))
