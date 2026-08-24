from agenta_local.apis.fastapi.app import create_app
from agenta_local.config import Settings
from fastapi.testclient import TestClient


def test_exported_routes_refresh_directly_and_issue_injected_cookie(tmp_path):
    static = tmp_path / "read only export"
    static.mkdir()
    (static / "index.html").write_text("home")
    for route in ("agents", "sessions", "providers"):
        directory = static / route
        directory.mkdir()
        (directory / "index.html").write_text(route)
    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_dir=tmp_path / "data",
        static_dir=static,
        browser_session="injected-browser-value",
    )
    app = create_app(settings)
    client = TestClient(app, base_url="http://127.0.0.1:8765")

    for path, expected in (
        ("/", "home"),
        ("/agents/", "agents"),
        ("/sessions/", "sessions"),
        ("/providers/", "providers"),
    ):
        response = client.get(path)
        assert response.status_code == 200
        assert response.text == expected

    assert client.cookies.get("agenta_local_session") == "injected-browser-value"
    assert app.routes[-1].path == ""
    assert any(route.path == "/health" for route in app.routes[:-1])
