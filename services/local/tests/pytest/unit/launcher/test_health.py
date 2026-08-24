import urllib.error

from agenta_local.launcher.health import (
    request_service_shutdown,
    wait_for_endpoint,
    wait_for_runner,
)


class Clock:
    def __init__(self):
        self.value = 0.0

    def monotonic(self):
        return self.value

    def sleep(self, seconds):
        self.value += max(seconds, 0.01)


def test_health_auth_header_and_deadline():
    clock = Clock()
    requests = []

    def unavailable(request, timeout):
        requests.append((request, timeout))
        raise urllib.error.URLError("not ready")

    assert not wait_for_endpoint(
        "http://127.0.0.1:1234/subscription-status",
        deadline=0.25,
        token="secret-token",
        request=unavailable,
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )
    assert clock.value >= 0.25
    assert requests
    assert requests[0][0].get_header("Authorization") == "Bearer secret-token"
    assert max(timeout for _, timeout in requests) <= 0.25


def test_shutdown_request_carries_cookie_in_header_not_url():
    seen = {}

    def request(target, timeout):
        seen["url"] = target.full_url
        seen["cookie"] = target.get_header("Cookie")
        seen["origin"] = target.get_header("Origin")
        seen["data"] = target.data
        return 202

    assert request_service_shutdown(
        "http://127.0.0.1:8765",
        "browser-secret",
        request=request,
    )
    assert "browser-secret" not in seen["url"]
    assert seen["cookie"] == "agenta_local_session=browser-secret"
    assert seen["origin"] == "http://127.0.0.1:8765"
    assert seen["data"] == b"{}"


def test_runner_readiness_checks_open_health_then_authenticated_status():
    seen = []

    def request(target, timeout):
        seen.append((target.full_url, target.get_header("Authorization"), timeout))
        return 200

    assert wait_for_runner(
        "http://127.0.0.1:8001",
        "runner-secret",
        deadline=1.0,
        request=request,
    )
    assert [(url, auth) for url, auth, _ in seen] == [
        ("http://127.0.0.1:8001/health", None),
        (
            "http://127.0.0.1:8001/subscription-status",
            "Bearer runner-secret",
        ),
    ]


def test_health_stops_immediately_when_cancelled():
    called = False

    def request(target, timeout):
        nonlocal called
        called = True
        return 200

    assert not wait_for_endpoint(
        "http://127.0.0.1:8001/health",
        deadline=10,
        request=request,
        cancelled=lambda: True,
    )
    assert called is False
