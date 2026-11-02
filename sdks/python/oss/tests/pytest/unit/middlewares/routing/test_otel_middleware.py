from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from agenta.sdk.middlewares.routing.otel import OTelMiddleware


TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"


def _client():
    app = FastAPI()
    app.add_middleware(OTelMiddleware)

    @app.get("/")
    async def read(request: Request):
        return {"traceparent": request.state.otel["traceparent"] is not None}

    return TestClient(app)


def test_traceparent_is_adopted():
    response = _client().get("/", headers={"traceparent": TRACEPARENT})

    assert response.json() == {"traceparent": True}


def test_traceparent_is_adopted_with_a_newrelic_header():
    # a vendor header no longer makes the middleware drop the caller's traceparent
    response = _client().get(
        "/", headers={"traceparent": TRACEPARENT, "newrelic": "anything"}
    )

    assert response.json() == {"traceparent": True}
