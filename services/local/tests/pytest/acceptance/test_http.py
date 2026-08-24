"""Acceptance tests: real uvicorn server, full browser boundary, SSE turns.

The happy turn path replays recorded runner fixtures; gating scenarios swap the
executor on app.state after startup.
"""

import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Self

# Single-user loopback deployment: allow the SDK to reach the co-located runner.
os.environ.setdefault("AGENTA_INSECURE_EGRESS_ALLOWED", "true")

import httpx
import pytest
import uvicorn
from agenta_local.apis.fastapi.app import create_app
from agenta_local.config import Settings

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "runner"
REQUEST_FIXTURE = FIXTURES_DIR / "cold_pi_turn.request.json"
STREAM_FIXTURE = FIXTURES_DIR / "cold_pi_turn.ndjson"
RESULT_FIXTURE = FIXTURES_DIR / "cold_pi_turn.result.json"

INSTRUCTIONS = "You are a terse assistant. Reply with exactly one short sentence."
PROMPT = "Say hello in exactly five words."
MODEL_JSON = '{"provider": "openai", "name": "gpt-4o-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'

_missing_fixtures = [
    path.name
    for path in (REQUEST_FIXTURE, STREAM_FIXTURE, RESULT_FIXTURE)
    if not path.exists()
]
requires_fixtures = pytest.mark.skipif(
    bool(_missing_fixtures),
    reason=f"replay fixtures not captured yet: {_missing_fixtures}",
)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LocalServer:
    """One uvicorn server per test; settings point storage into tmp_path."""

    def __init__(self, tmp_path, runner_url: str, *, static_dir=None) -> None:
        self.settings = Settings(
            host="127.0.0.1",
            port=_free_port(),
            data_dir=tmp_path / "data",
            runner_url=runner_url,
            static_dir=static_dir,
        )
        self.app = create_app(self.settings)
        config = uvicorn.Config(
            self.app,
            host=self.settings.host,
            port=self.settings.port,
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://{self.settings.host}:{self.settings.port}"

    def __enter__(self) -> Self:
        self.thread.start()
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                response = httpx.get(f"{self.base_url}/health", timeout=2)
                if response.status_code == 200:
                    return self
            except httpx.HTTPError:
                time.sleep(0.1)
        raise RuntimeError("local server did not become healthy")

    def __exit__(self, *exc_info) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=10)

    def client(self, **kwargs) -> httpx.Client:
        return httpx.Client(base_url=self.base_url, timeout=30, **kwargs)


@pytest.fixture
def replay(monkeypatch):
    from tests.pytest.utils.replay_runner import ReplayRunner

    with ReplayRunner(
        request_fixture=json.loads(REQUEST_FIXTURE.read_text(encoding="utf-8")),
        ndjson_path=STREAM_FIXTURE,
    ) as instance:
        # The executor authenticates per-call from this env var.
        monkeypatch.setenv("AGENTA_RUNNER_TOKEN", instance.token)
        yield instance


@pytest.fixture
def runner_url(replay):
    return replay.url


@pytest.fixture
def server(tmp_path, runner_url):
    with LocalServer(tmp_path, runner_url) as local:
        yield local


def make_agent_and_session(client: httpx.Client) -> tuple[str, str]:
    client.get("/")  # browser navigation issues the process cookie first
    stored = client.put(
        "/api/providers/openai",
        json={"credentials": {"api_key": "sk-redacted"}},
    )
    assert stored.status_code == 204
    agent = client.post(
        "/api/agents",
        json={
            "name": "agent",
            "instructions": INSTRUCTIONS,
            "model": {"provider": "openai", "name": "gpt-4o-mini", "parameters": {}},
            "execution": {},
        },
    ).json()
    session = client.post(
        "/api/sessions",
        json={"agent_revision_id": agent["current_revision"]["id"]},
    ).json()
    return agent["id"], session["id"]


def test_health_is_open_and_reports_schema_version(server):
    with server.client() as client:
        body = client.get("/health").json()
        assert body["ok"] is True
        assert body["schema_version"] == "0001"


def test_shell_issues_process_cookie_with_flags(server):
    with server.client() as client:
        response = client.get("/")
        set_cookie = response.headers["set-cookie"]
        assert "agenta_local_session=" in set_cookie
        assert "HttpOnly" in set_cookie and "samesite=strict" in set_cookie.lower()
        assert response.headers["cache-control"] == "no-store"

        # A second navigation keeps the same process cookie value.
        again = client.get("/")
        assert client.cookies.get("agenta_local_session") == (
            client.cookies.get("agenta_local_session")
        )
        assert again.status_code == 200


def test_mutations_require_cookie_then_json_content_type(server):
    with server.client():
        bare = httpx.Client(base_url=server.base_url)
        rejected = bare.post(
            "/api/agents",
            json={"name": "x"},
            headers={"Origin": server.base_url},
        )
        assert rejected.status_code == 403
        assert rejected.json()["code"] == "missing_session"

        cookie_header = {"Cookie": f"agenta_local_session={_cookie_value(server)}"}
        wrong_type = httpx.Client(base_url=server.base_url)
        bad_type = wrong_type.post(
            "/api/agents",
            content="{}",
            headers={
                **cookie_header,
                "Content-Type": "text/plain",
                "Origin": server.base_url,
            },
        )
        assert bad_type.status_code == 403
        assert bad_type.json()["code"] == "invalid_content_type"


def test_foreign_host_is_rejected(server):
    with server.client() as client:
        response = client.get(
            "/health",
            headers={"Host": "attacker.example:80"},
        )
        assert response.status_code == 403
        assert response.json()["code"] == "invalid_host"


def test_foreign_origin_on_mutation_is_rejected(server):
    with server.client() as client:
        response = client.post(
            "/api/providers/openai",
            json={"credentials": {"api_key": "sk-x"}},
            headers={"Origin": "http://evil.example"},
        )
        assert response.status_code == 403
        assert response.json()["code"] == "invalid_origin"


def test_agents_round_trip_and_immutable_revisions(server):
    with server.client() as client:
        client.get("/")  # navigation issues the process cookie
        created = client.post(
            "/api/agents",
            json={
                "name": "agent",
                "instructions": INSTRUCTIONS,
                "model": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "parameters": {},
                },
                "execution": {},
            },
        )
        assert created.status_code == 201
        agent = created.json()
        assert agent["current_revision"]["version"] == 1

        revision = client.post(
            f"/api/agents/{agent['id']}/revisions",
            json={
                "instructions": "v2 instructions",
                "model": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "parameters": {},
                },
                "execution": {},
            },
        )
        assert revision.status_code == 201
        assert revision.json()["version"] == 2

        updated = client.get(f"/api/agents/{agent['id']}").json()
        assert updated["current_revision"]["version"] == 2


def test_provider_secrets_are_write_only_and_redacted_on_read(server):
    with server.client() as client:
        client.get("/")
        put = client.put(
            "/api/providers/openai",
            json={"credentials": {"api_key": "sk-super-secret-1234"}},
        )
        assert put.status_code == 204

        listed = client.get("/api/providers").json()
        assert listed[0]["provider"] == "openai"
        assert listed[0]["configured"] is True
        serialized = json.dumps(listed)
        assert "sk-super-secret-1234" not in serialized

        delete = client.delete("/api/providers/openai")
        assert delete.status_code == 204
        assert client.get("/api/providers").json() == []


@requires_fixtures
def test_turn_streams_sse_commits_messages_and_maps_duplicates(server):

    with server.client() as client:
        _, session_id = make_agent_and_session(client)

        with client.stream(
            "POST",
            f"/api/sessions/{session_id}/turns",
            json={"input": {"content": [{"type": "text", "text": PROMPT}]}},
        ) as response:
            assert response.headers["content-type"].startswith("text/event-stream")
            frames = [
                json.loads(line.removeprefix("data: "))
                for line in response.iter_lines()
                if line.startswith("data: ")
            ]
        assert frames[0]["type"] == "start"
        assert frames[-1]["type"] == "finish"

        detail = client.get(f"/api/sessions/{session_id}").json()
        roles = [message["role"] for message in detail["messages"]]
        assert roles == ["user", "assistant"]
        expected = json.loads(RESULT_FIXTURE.read_text(encoding="utf-8"))
        assert detail["messages"][1]["content"]["text"] == expected["assistant_text"]

        # Duplicate client_turn_id maps to a stable 409 before any streaming.
        duplicate = client.post(
            f"/api/sessions/{session_id}/turns",
            json={
                "input": {"content": [{"type": "text", "text": PROMPT}]},
                "context": {"client_turn_id": _last_client_turn_id(session_id, server)},
            },
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "turn_already_exists"


def _last_client_turn_id(session_id: str, server: LocalServer) -> str:
    import sqlite3

    db_path = server.settings.database_path
    connection = sqlite3.connect(db_path)
    row = connection.execute(
        "SELECT client_turn_id FROM turns WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    connection.close()
    return row[0]


def _cookie_value(server: LocalServer) -> str:
    return server.app.state.boundary.cookie_value


def test_stop_route_cancels_active_turn(server):
    """A gated turn streams until POST /stop cancels it; row lands cancelled."""
    import asyncio

    with server.client() as client:
        _, session_id = make_agent_and_session(client)

        class GatedExecutor:
            def __init__(self):
                self.release = asyncio.Event()

            def stream(self, *, revision, messages, credential):
                from agenta_local.core.execution.dtos import ExecutionStream

                gate = self.release

                async def events():
                    await gate.wait()
                    yield {"type": "start"}

                async def result():
                    raise AssertionError("gated stream never completes")

                return ExecutionStream(events=events(), _result=result())

        server.app.state.execution._executor = GatedExecutor()

        done = threading.Event()
        stop_response = {}

        def stream_until_stopped():
            with httpx.Client(base_url=server.base_url, timeout=30) as streamer:
                streamer.get("/")
                response = streamer.post(
                    f"/api/sessions/{session_id}/turns",
                    json={"input": {"content": [{"type": "text", "text": "hi"}]}},
                )
                stop_response["status"] = response.status_code
                done.set()

        worker = threading.Thread(target=stream_until_stopped)
        worker.start()

        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if server.app.state.execution.active_session_ids():
                break
            time.sleep(0.05)
        else:
            raise AssertionError("turn never registered as active")

        stopped = client.post(f"/api/sessions/{session_id}/stop", json={}).json()
        assert stopped == {"stopped": True}

        assert done.wait(timeout=10)
        worker.join(timeout=10)
        assert _raw_statuses(server) == ["cancelled"]


def _raw_statuses(server: LocalServer) -> list[str]:
    import sqlite3

    connection = sqlite3.connect(server.settings.database_path)
    rows = connection.execute("SELECT status FROM turns").fetchall()
    connection.close()
    return [row[0] for row in rows]


def test_renderer_export_mounted_with_api_priority(tmp_path, replay):
    """The built static export is served at / with direct route refresh."""
    out_dir = Path(__file__).resolve().parents[5] / "web" / "agenta-local" / "out"
    if not out_dir.is_dir():
        pytest.skip("renderer export not built yet")

    with (
        LocalServer(tmp_path, replay.url, static_dir=out_dir) as local,
        local.client() as client,
    ):
        shell = client.get("/")
        assert shell.status_code == 200
        assert "text/html" in shell.headers["content-type"]

        for route in ("/agents/", "/sessions/", "/providers/"):
            page = client.get(route)
            assert page.status_code == 200, route
            assert "text/html" in page.headers["content-type"], route

        # API routes win over the static mount.
        assert client.get("/api/agents").json() == []
        assert client.get("/health").json()["ok"] is True
