from agenta_local.apis.fastapi.runtime.router import router
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_shutdown_awaits_graceful_preparation_then_signals_server():
    calls = []
    app = FastAPI()
    app.include_router(router)

    async def prepare():
        calls.append("prepare")

    def request_shutdown():
        calls.append("signal")

    app.state.prepare_shutdown = prepare
    app.state.request_shutdown = request_shutdown

    response = TestClient(app).post("/api/runtime/shutdown")

    assert response.status_code == 202
    assert response.json() == {"stopping": True}
    assert calls == ["prepare", "signal"]


def test_shutdown_ignores_legacy_non_callable_state_safely():
    app = FastAPI()
    app.include_router(router)
    app.state.request_shutdown = False

    response = TestClient(app).post("/api/runtime/shutdown")

    assert response.status_code == 202
