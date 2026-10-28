"""Unit tests for the startup report of the registered Composio webhook URL.

The resolver logs the URL the Composio project's webhook posts to, and warns when
it is not the URL this deployment expects. It never changes the webhook.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.core.triggers import utils
from oss.src.core.triggers.dtos import TriggerWebhookRegistration
from oss.src.core.triggers.utils import WebhookSecretResolver
from oss.src.utils.env import env

_EXPECTED = "https://staging.example.org/api/triggers/composio/events/"
_OTHER = "https://demo.example.org/api/triggers/composio/events/"
_SECRET = "whsec_do_not_log"


@pytest.fixture
def log(monkeypatch):
    log = MagicMock()
    monkeypatch.setattr(utils, "log", log)
    return log


@pytest.fixture
def cache(monkeypatch):
    store = {}

    async def get_cache(*, namespace, key, **_):
        return store.get(key)

    async def set_cache(*, namespace, key, value, **_):
        store[key] = value

    monkeypatch.setattr(utils, "get_cache", get_cache)
    monkeypatch.setattr(utils, "set_cache", set_cache)
    monkeypatch.setattr(utils, "encrypt", lambda v: f"enc:{v}")
    monkeypatch.setattr(utils, "decrypt", lambda v: v.removeprefix("enc:"))
    return store


@pytest.fixture(autouse=True)
def expected_url(monkeypatch):
    monkeypatch.setattr(env.composio, "webhook_url", _EXPECTED)


def _resolver(registered_url):
    adapter = MagicMock()
    adapter.ensure_webhook_subscription = AsyncMock(
        return_value=TriggerWebhookRegistration(
            secret=_SECRET, webhook_url=registered_url
        )
    )
    registry = MagicMock()
    registry.get.return_value = adapter
    return WebhookSecretResolver(adapter_registry=registry), adapter


def _logged_text(log):
    calls = log.info.call_args_list + log.warning.call_args_list
    return " ".join(str(arg) for call in calls for arg in call.args)


async def test_matching_url_logs_info_and_no_warning(log, cache):
    resolver, adapter = _resolver(_EXPECTED)

    assert await resolver.resolve() == _SECRET
    await resolver.report_webhook_url()

    log.info.assert_called_once()
    assert _EXPECTED in log.info.call_args.args
    log.warning.assert_not_called()
    adapter.ensure_webhook_subscription.assert_awaited_once_with(webhook_url=_EXPECTED)


async def test_trailing_slash_difference_is_a_match(log, cache):
    resolver, _ = _resolver(_EXPECTED.rstrip("/"))

    await resolver.resolve()
    await resolver.report_webhook_url()

    log.warning.assert_not_called()


async def test_mismatched_url_logs_a_warning_with_both_urls(log, cache):
    resolver, adapter = _resolver(_OTHER)

    assert await resolver.resolve() == _SECRET
    await resolver.report_webhook_url()

    log.info.assert_called_once()
    log.warning.assert_called_once()
    assert _OTHER in log.warning.call_args.args
    assert _EXPECTED in log.warning.call_args.args
    # Reporting never touches the webhook: one GET-or-create, no update.
    adapter.ensure_webhook_subscription.assert_awaited_once()


async def test_cache_hit_reports_the_cached_url_without_calling_composio(log, cache):
    first, _ = _resolver(_OTHER)
    await first.resolve()

    restarted, adapter = _resolver(_OTHER)
    assert await restarted.resolve() == _SECRET
    await restarted.report_webhook_url()

    adapter.ensure_webhook_subscription.assert_not_awaited()
    log.warning.assert_called_once()


async def test_secret_is_never_logged(log, cache):
    resolver, _ = _resolver(_OTHER)

    await resolver.resolve()
    await resolver.report_webhook_url()

    assert _SECRET not in _logged_text(log)


async def test_unknown_url_logs_nothing(log, cache):
    resolver, _ = _resolver(None)

    await resolver.resolve()
    await resolver.report_webhook_url()

    log.info.assert_not_called()
    log.warning.assert_not_called()


async def test_dev_placeholder_url_does_not_warn(log, cache, monkeypatch):
    monkeypatch.setattr(env.composio, "webhook_url", None)
    monkeypatch.setattr(env.agenta, "api_url", "http://localhost/api")
    resolver, _ = _resolver(_OTHER)

    await resolver.resolve()
    await resolver.report_webhook_url()

    log.info.assert_called_once()
    log.warning.assert_not_called()
