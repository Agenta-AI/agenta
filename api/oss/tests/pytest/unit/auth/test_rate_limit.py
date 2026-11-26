import asyncio
import pytest

from oss.src.core.auth import rate_limit
from oss.src.core.auth.rate_limit import (
    AUTH_CODE_RATE_LIMIT_MESSAGE,
    enforce_auth_code_rate_limit,
)
from oss.src.utils.env import env
from oss.src.utils.exceptions import TooManyRequestsException


class _Request:
    def __init__(self, headers: dict[str, str]):
        self._headers = {key.lower(): value for key, value in headers.items()}

    def get_header(self, key: str):
        return self._headers.get(key.lower())


class _FakeRedis:
    """INCR with a first-call EXPIRE, on a clock the test moves by hand."""

    def __init__(self):
        self.now = 0
        self._counts: dict[str, int] = {}
        self._expires_at: dict[str, int] = {}

    async def eval(self, script, numkeys, key, window_seconds):
        if key in self._expires_at and self._expires_at[key] <= self.now:
            del self._counts[key]
            del self._expires_at[key]
        self._counts[key] = self._counts.get(key, 0) + 1
        if self._counts[key] == 1:
            self._expires_at[key] = self.now + int(window_seconds)
        return self._counts[key]


class _DownRedis:
    async def eval(self, *args):
        raise ConnectionError("redis is down")


class _Log:
    def __init__(self):
        self.warnings: list[str] = []

    def warning(self, message, *args, **kwargs):
        self.warnings.append(message % args)

    def info(self, message, *args, **kwargs):
        pass


class _SlowRedis:
    async def eval(self, *args):
        await asyncio.sleep(30)


@pytest.fixture(autouse=True)
def _limit_config(monkeypatch):
    monkeypatch.setattr(rate_limit, "_redis_failing", False)
    monkeypatch.setattr(env.agenta.auth_code_rate_limit, "enabled", True)
    monkeypatch.setattr(env.agenta.auth_code_rate_limit, "requests_per_window", 5)
    monkeypatch.setattr(env.agenta.auth_code_rate_limit, "window_seconds", 600)


@pytest.fixture
def redis(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "get_cache_engine", lambda: fake)
    return fake


def _request(ip: str = "203.0.113.10") -> _Request:
    return _Request({"x-forwarded-for": f"{ip}, 10.0.0.1"})


async def test_requests_under_the_limit_pass(redis):
    for _ in range(5):
        await enforce_auth_code_rate_limit(
            request=_request(), api_name="create_code_post"
        )


async def test_sixth_request_in_the_window_is_rejected(redis):
    for _ in range(5):
        await enforce_auth_code_rate_limit(
            request=_request(), api_name="create_code_post"
        )

    with pytest.raises(TooManyRequestsException) as excinfo:
        await enforce_auth_code_rate_limit(
            request=_request(), api_name="resend_code_post"
        )

    assert excinfo.value.status_code == 429
    assert excinfo.value.detail == {"message": AUTH_CODE_RATE_LIMIT_MESSAGE}


async def test_endpoints_share_one_counter_per_ip(redis):
    for api_name in (
        "sign_up_post",
        "create_code_post",
        "resend_code_post",
        "create_code_post",
        "sign_up_post",
    ):
        await enforce_auth_code_rate_limit(request=_request(), api_name=api_name)

    with pytest.raises(TooManyRequestsException):
        await enforce_auth_code_rate_limit(request=_request(), api_name="sign_up_post")

    # A different client keeps its own counter.
    await enforce_auth_code_rate_limit(
        request=_request("198.51.100.7"), api_name="sign_up_post"
    )


async def test_new_window_resets_the_counter(redis):
    for _ in range(5):
        await enforce_auth_code_rate_limit(
            request=_request(), api_name="create_code_post"
        )
    with pytest.raises(TooManyRequestsException):
        await enforce_auth_code_rate_limit(
            request=_request(), api_name="create_code_post"
        )

    redis.now += 600

    await enforce_auth_code_rate_limit(request=_request(), api_name="create_code_post")


async def test_redis_down_allows_the_request(monkeypatch):
    monkeypatch.setattr(rate_limit, "get_cache_engine", lambda: _DownRedis())

    for _ in range(6):
        await enforce_auth_code_rate_limit(
            request=_request(), api_name="create_code_post"
        )


async def test_redis_outage_is_logged_once(monkeypatch):
    log = _Log()
    monkeypatch.setattr(rate_limit, "log", log)
    monkeypatch.setattr(rate_limit, "get_cache_engine", lambda: _DownRedis())

    for _ in range(3):
        await enforce_auth_code_rate_limit(
            request=_request(), api_name="create_code_post"
        )

    assert len([w for w in log.warnings if "rate limit skipped" in w]) == 1


async def test_redis_recovery_logs_a_new_warning_on_the_next_outage(monkeypatch):
    log = _Log()
    monkeypatch.setattr(rate_limit, "log", log)
    engine = {"current": _DownRedis()}
    monkeypatch.setattr(rate_limit, "get_cache_engine", lambda: engine["current"])

    await enforce_auth_code_rate_limit(request=_request(), api_name="create_code_post")
    engine["current"] = _FakeRedis()
    await enforce_auth_code_rate_limit(request=_request(), api_name="create_code_post")
    engine["current"] = _DownRedis()
    await enforce_auth_code_rate_limit(request=_request(), api_name="create_code_post")

    assert len([w for w in log.warnings if "rate limit skipped" in w]) == 2


async def test_slow_redis_allows_the_request_quickly(monkeypatch):
    monkeypatch.setattr(rate_limit, "get_cache_engine", lambda: _SlowRedis())
    monkeypatch.setattr(rate_limit, "_REDIS_TIMEOUT_SECONDS", 0.05)

    await asyncio.wait_for(
        enforce_auth_code_rate_limit(request=_request(), api_name="create_code_post"),
        timeout=1,
    )


async def test_disabled_limit_never_touches_redis(monkeypatch):
    monkeypatch.setattr(env.agenta.auth_code_rate_limit, "enabled", False)
    monkeypatch.setattr(rate_limit, "get_cache_engine", lambda: _DownRedis())

    await enforce_auth_code_rate_limit(request=_request(), api_name="create_code_post")
