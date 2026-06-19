from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.routers.health_router import router


def test_health_check_returns_ok_status():
    app = FastAPI()
    app.include_router(router, prefix="/health")
    client = TestClient(app)

    response = client.get("/health/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}