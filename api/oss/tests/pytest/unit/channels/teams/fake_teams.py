"""Microsoft's side of the Teams adapter, faked: the Bot Framework OpenID
document and key set, and the Microsoft Entra token service, served to the
adapter through `httpx.ASGITransport`. Test JWTs are signed with an RSA key
generated here, so nothing reaches Microsoft."""

import json
import time
from typing import Any, Dict, List, Optional

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
            ]
        )

    def refuse_token(self, *, status: int, error: str, code: int) -> None:
        self.token_status = status
        self.token_body = {
            "error": error,
            "error_description": f"AADSTS{code}: refused for the test.",
            "error_codes": [code],
        }

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
        return JSONResponse(self.token_body, status_code=self.token_status)


def client_for(fake: FakeMicrosoft) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fake.app))


def adapter_for(fake: FakeMicrosoft) -> TeamsAdapter:
    return TeamsAdapter(http_client=client_for(fake))
