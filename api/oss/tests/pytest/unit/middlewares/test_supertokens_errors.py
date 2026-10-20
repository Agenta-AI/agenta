import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from oss.src.middlewares.supertokens_errors import SuperTokensHTTPExceptionMiddleware
from oss.src.utils.exceptions import UnauthorizedException

ORIGIN = "https://cloud.agenta.ai"


def _supertokens_like_middleware(error: Exception):
    """Stands in for SuperTokens: answers /auth/* itself and raises from an API override."""

    class _Middleware:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            if scope["type"] == "http" and scope["path"].startswith("/auth/"):
                raise error
            await self.app(scope, receive, send)

    return _Middleware


def _client(error: Exception) -> TestClient:
    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"ok": True}

    # Same order as entrypoints/routers.py.
    app.add_middleware(_supertokens_like_middleware(error))
    app.add_middleware(SuperTokensHTTPExceptionMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return TestClient(app, raise_server_exceptions=False)


def test_turnstile_rejection_returns_401_with_message_and_cors():
    client = _client(
        UnauthorizedException(message="Please complete the security check.")
    )

    response = client.post("/auth/signin", headers={"Origin": ORIGIN})

    assert response.status_code == 401
    assert response.json() == {
        "detail": {"message": "Please complete the security check."}
    }
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_other_errors_still_return_500():
    client = _client(RuntimeError("boom"))

    response = client.post("/auth/signin", headers={"Origin": ORIGIN})

    assert response.status_code == 500


def test_non_auth_routes_pass_through():
    client = _client(UnauthorizedException())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.asyncio
async def test_reraises_when_response_already_started():
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise UnauthorizedException()

    async def receive():
        return {"type": "http.request"}

    async def send(message):
        pass

    with pytest.raises(UnauthorizedException):
        await SuperTokensHTTPExceptionMiddleware(app)({"type": "http"}, receive, send)
