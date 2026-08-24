"""Reusable stdlib-HTTP replay of the local runner wire: health, token gate, POST /run.

Serves the recorded cold_pi_turn NDJSON stream and asserts the outbound /run request
matches the redacted request fixture. No third-party dependencies.
"""

import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Self


class ReplayRunner:
    """Fake runner serving recorded fixtures; records and validates outbound requests."""

    def __init__(
        self,
        *,
        request_fixture: dict[str, Any],
        ndjson_path: Path,
        token: str | None = None,
    ) -> None:
        self.token = token or secrets.token_hex(32)
        self.request_fixture = request_fixture
        self.ndjson_lines = [
            line
            for line in ndjson_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.last_request: dict[str, Any] | None = None
        self.request_matches: bool | None = None
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(self))
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def start(self) -> Self:
        self._thread.start()
        return self

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)

    def __enter__(self) -> Self:
        return self.start()

    def __exit__(self, *exc_info) -> None:
        self.stop()

    def _authorized(self, headers: Any) -> bool:
        return headers.get("Authorization") == f"Bearer {self.token}"


def _make_handler(runner: ReplayRunner) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path == "/health":
                # Liveness is unauthenticated per the local-runner contract.
                self._json_response(200, {"ok": True})
            elif self.path == "/subscription-status":
                if runner._authorized(self.headers):
                    self._json_response(200, {"ok": True, "subscribed": True})
                else:
                    self._json_response(401, {"ok": False, "error": "unauthorized"})
            else:
                self._json_response(404, {"ok": False})

        def do_POST(self) -> None:
            if self.path != "/run" or not runner._authorized(self.headers):
                self._json_response(404 if self.path != "/run" else 401, {"ok": False})
                return
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            runner.last_request = body
            runner.request_matches = body == runner.request_fixture
            payload = ("\n".join(runner.ndjson_lines) + "\n").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _json_response(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: Any) -> None:
            pass

    return Handler
