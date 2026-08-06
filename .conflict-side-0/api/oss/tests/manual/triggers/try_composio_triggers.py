#!/usr/bin/env python3
"""Smoke-test Composio Slack triggers via the official Python SDK.

Covers the two flows from the docs:
  - Creating triggers:    https://docs.composio.dev/docs/setting-up-triggers/creating-triggers
  - Subscribing to events: https://docs.composio.dev/docs/setting-up-triggers/subscribing-to-events

The app talks to Composio over raw httpx, but the SDK is the fastest way to
both create trigger instances and *watch live events* (WebSocket) so we can see
whether triggers actually fire — which is the usual reason they "don't work".

Usage:
    set -a; source hosting/docker-compose/ee/.env.ee.dev; set +a

    # 1. List Slack trigger types + their config schemas
    python api/oss/tests/manual/triggers/try_composio_triggers.py list

    # 2. List currently-active trigger instances
    python api/oss/tests/manual/triggers/try_composio_triggers.py active

    # 3. Create the three triggers on channel C0BBC650QNT
    python api/oss/tests/manual/triggers/try_composio_triggers.py create

    # 4. Watch live events (send a message / add a reaction in Slack to test)
    python api/oss/tests/manual/triggers/try_composio_triggers.py watch

    # 5. Inspect / register Agenta's webhook delivery URL (the missing link)
    python api/oss/tests/manual/triggers/try_composio_triggers.py webhooks
    AGENTA_WEBHOOK_URL=https://<host>/api/triggers/composio/events/ \
        python api/oss/tests/manual/triggers/try_composio_triggers.py register

Optional env:
    COMPOSIO_API_KEY        required
    SLACK_CHANNEL_ID        default C0BBC650QNT
    SLACK_CONNECTED_ACCOUNT optional; auto-detected (first ACTIVE Slack account)
    AGENTA_WEBHOOK_URL      for `register`; your reachable ingress (trailing slash)
"""

import json
import os
import sys
from typing import Any, Dict, List, Optional

from composio import Composio

CHANNEL_ID = os.getenv("SLACK_CHANNEL_ID", "C0BBC650QNT")
TOOLKIT = "slack"

# Intent → Composio trigger-type slug. Slack has TWO families:
#   SLACK_RECEIVE_MESSAGE / SLACK_REACTION_*  → no config, fire workspace-wide
#   SLACK_CHANNEL_MESSAGE_RECEIVED / SLACK_MESSAGE_REACTION_*  → accept channel_id
# We want channel-scoped, so use the latter. "message_sent" intentionally has no
# Slack equivalent — Slack/Composio only expose messages *received*.
TRIGGERS = {
    "message_received": "SLACK_CHANNEL_MESSAGE_RECEIVED",
    "reaction_added": "SLACK_MESSAGE_REACTION_ADDED",
    "reaction_removed": "SLACK_MESSAGE_REACTION_REMOVED",
}


def _client() -> Composio:
    key = os.getenv("COMPOSIO_API_KEY")
    if not key:
        sys.exit(
            "COMPOSIO_API_KEY not set.\n"
            "  set -a; source hosting/docker-compose/ee/.env.ee.dev; set +a"
        )
    return Composio(api_key=key)


def _hr(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def _items(resp: Any) -> List[Any]:
    items = getattr(resp, "items", None)
    return (
        list(items) if items is not None else (resp if isinstance(resp, list) else [])
    )


def _active_slack_account(composio: Composio) -> Optional[str]:
    override = os.getenv("SLACK_CONNECTED_ACCOUNT")
    if override:
        return override
    resp = composio.connected_accounts.list(toolkit_slugs=[TOOLKIT])
    for acc in _items(resp):
        status = getattr(acc, "status", None)
        acc_id = getattr(acc, "id", None)
        if status == "ACTIVE":
            return acc_id
    return None


def cmd_list(composio: Composio) -> None:
    _hr(f"Slack trigger types (toolkit={TOOLKIT})")
    resp = composio.triggers.list(toolkit_slugs=[TOOLKIT], limit=100)
    for it in _items(resp):
        slug = getattr(it, "slug", "?")
        name = getattr(it, "name", "")
        print(f"  - {slug:40} {name}")

    _hr("Config schemas for the triggers we care about")
    for intent, slug in TRIGGERS.items():
        try:
            detail = composio.triggers.get_type(slug=slug)
        except Exception as e:  # noqa: BLE001
            print(f"\n  {intent} → {slug}: get_type FAILED: {e}")
            continue
        config = getattr(detail, "config", None)
        print(f"\n  {intent} → {slug}")
        print(f"    config: {json.dumps(config, indent=2, default=str)}")


def cmd_active(composio: Composio) -> None:
    _hr("Active trigger instances")
    resp = composio.triggers.list_active(limit=100)
    items = _items(resp)
    if not items:
        print("  (none)")
        return
    for it in items:
        print(
            f"  - id={getattr(it, 'id', '?')} "
            f"trigger={getattr(it, 'trigger_name', getattr(it, 'trigger_slug', '?'))} "
            f"state={getattr(it, 'state', getattr(it, 'status', '?'))}"
        )


def cmd_create(composio: Composio) -> None:
    account_id = _active_slack_account(composio)
    if not account_id:
        sys.exit("No ACTIVE Slack connected account found. Connect Slack first.")
    print(f"Using connected_account_id={account_id}, channel_id={CHANNEL_ID}")

    _hr("Creating trigger instances")
    for intent, slug in TRIGGERS.items():
        # Only channel_id — channel_type is mutually exclusive with it on Slack.
        trigger_config: Dict[str, Any] = {"channel_id": CHANNEL_ID}
        try:
            result = composio.triggers.create(
                slug=slug,
                connected_account_id=account_id,
                trigger_config=trigger_config,
            )
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ {intent} ({slug}): {e}")
            continue
        trigger_id = getattr(result, "trigger_id", None) or getattr(result, "id", None)
        print(f"  ✅ {intent} ({slug}) → {trigger_id}")


def cmd_watch(composio: Composio) -> None:
    _hr("Subscribing to live trigger events (WebSocket)")
    print(
        "Go to Slack and send a message / add a reaction in the watched channel.\n"
        "Events should print below. Ctrl-C to stop.\n"
    )
    subscription = composio.triggers.subscribe()

    @subscription.handle(toolkit=TOOLKIT)
    def _on_event(data: Any) -> None:  # noqa: ANN401
        print(f"\n🔔 EVENT:\n{json.dumps(data, indent=2, default=str)}")

    subscription.wait_forever()


# Composio's webhook subscription API isn't on the SDK resource we use, so the
# webhook commands hit the REST API directly (same as the app's httpx adapters).
_WEBHOOK_EVENT = "composio.trigger.message"


def _rest(composio: Composio) -> Any:
    import httpx  # local: only the webhook commands need raw REST

    return httpx.Client(
        base_url=os.getenv("COMPOSIO_API_URL", "https://backend.composio.dev/api/v3"),
        headers={
            "x-api-key": os.environ["COMPOSIO_API_KEY"],
            "Content-Type": "application/json",
        },
        timeout=20.0,
    )


def cmd_webhooks(composio: Composio) -> None:
    _hr("Registered webhook subscriptions")
    with _rest(composio) as c:
        r = c.get("/webhook_subscriptions")
        r.raise_for_status()
        items = r.json().get("items", [])
    if not items:
        print(
            "  (none) — Composio has nowhere to deliver events. Agenta will NOT\n"
            "  receive triggers until a webhook is registered (see `register`)."
        )
        return
    for it in items:
        print(
            f"  - id={it.get('id')} url={it.get('webhook_url')} "
            f"events={it.get('enabled_events')}"
        )


def cmd_register(composio: Composio) -> None:
    """Register Agenta's ingress URL so Composio actually delivers events.

    Set AGENTA_WEBHOOK_URL to your reachable ingress, e.g.
      https://<host>/api/triggers/composio/events/   (note the trailing slash)
    """
    url = os.getenv("AGENTA_WEBHOOK_URL")
    if not url:
        sys.exit(
            "Set AGENTA_WEBHOOK_URL to your reachable ingress, e.g.\n"
            "  https://<host>/api/triggers/composio/events/"
        )
    _hr(f"Registering webhook → {url}")
    with _rest(composio) as c:
        r = c.post(
            "/webhook_subscriptions",
            json={"webhook_url": url, "enabled_events": [_WEBHOOK_EVENT]},
        )
        if not r.is_success:
            sys.exit(f"❌ register failed ({r.status_code}): {r.text}")
        body = r.json()
    print(f"  ✅ id={body.get('id')}")
    print("\n  Set this in your env so signature verification passes:")
    print(f"    COMPOSIO_WEBHOOK_SECRET={body.get('secret')}")


def _ensure_subscription(client: Any, url: str) -> str:
    """Idempotent GET-or-create-then-GET — the per-container startup operation.

    Composio caps webhook_subscriptions at 1 per project, so this is the lockless
    convergence primitive: whoever creates first wins; everyone else gets 409 and
    re-reads the winner's secret. The secret is always readable on GET.
    """
    r = client.get("/webhook_subscriptions")
    r.raise_for_status()
    items = r.json().get("items", [])
    if items:
        return items[0]["secret"]

    r = client.post(
        "/webhook_subscriptions",
        json={"webhook_url": url, "enabled_events": [_WEBHOOK_EVENT]},
    )
    if r.status_code == 201:
        return r.json()["secret"]
    if r.status_code == 409:  # lost the race — re-read the winner's secret
        g = client.get("/webhook_subscriptions")
        g.raise_for_status()
        return g.json()["items"][0]["secret"]
    raise RuntimeError(f"ensure_subscription failed ({r.status_code}): {r.text}")


_CACHE_KEY = "composio:triggers:webhook_secret"


# Faithful copy of oss.src.utils.crypting (AGENTA_CRYPT_KEY → sha256 → b64 → Fernet)
# so the script runs standalone on the host, outside the app's pythonpath.
def _fernet() -> Any:
    import base64
    import hashlib

    from cryptography.fernet import Fernet

    crypt_key = os.getenv("AGENTA_CRYPT_KEY") or "replace-me"
    key_material = hashlib.sha256(crypt_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_material))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


class _SharedCache:
    """Stand-in for the volatile Redis cache (transport we already trust).

    Stores Fernet-ENCRYPTED ciphertext, exactly as the app would put a secret in
    Redis. Thread-safe dict so concurrent 'containers' share one store.
    """

    def __init__(self) -> None:
        import threading

        self._d: Dict[str, str] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            return self._d.get(key)

    def setex(self, key: str, _ttl: int, ciphertext: str) -> None:
        with self._lock:
            self._d[key] = ciphertext


def _resolve_secret(client: Any, cache: _SharedCache, url: str, *, force: bool) -> str:
    """The real app primitive: cache(decrypt) → else Composio → cache(encrypt).

    Mirrors get_webhook_secret(): Composio is the source of truth, the cache
    holds Fernet ciphertext, and a miss re-derives idempotently.
    """
    if not force:
        cached = cache.get(_CACHE_KEY)
        if cached:
            return decrypt(cached)  # ciphertext → plaintext
    secret = _ensure_subscription(client, url)
    cache.setex(_CACHE_KEY, 3600, encrypt(secret))  # plaintext → ciphertext
    return secret


def cmd_converge(composio: Composio) -> None:
    """N containers race to register at startup; assert convergence + crypt round-trip.

    Each 'container' runs the real resolver (cache→Composio→cache) concurrently
    with its OWN http client. They must all land the SAME secret, the cache must
    hold Fernet CIPHERTEXT (not plaintext), and decrypt must round-trip it.
    """
    import concurrent.futures as cf

    import httpx

    url = os.getenv("AGENTA_WEBHOOK_URL")
    if not url:
        sys.exit(
            "Set AGENTA_WEBHOOK_URL to a registration target for the convergence run"
        )
    n = int(os.getenv("CONTAINERS", "6"))
    base = os.getenv("COMPOSIO_API_URL", "https://backend.composio.dev/api/v3")
    key = os.environ["COMPOSIO_API_KEY"]
    headers = {"x-api-key": key, "Content-Type": "application/json"}
    cache = _SharedCache()

    # Clean slate so we exercise the create-race, not a pre-existing sub.
    with httpx.Client(timeout=20, base_url=base, headers=headers) as c:
        for it in c.get("/webhook_subscriptions").json().get("items", []):
            c.delete(f"/webhook_subscriptions/{it['id']}")

    _hr(f"Convergence + crypt: {n} containers racing to register {url}")

    def one(i: int) -> str:
        with httpx.Client(timeout=20, base_url=base, headers=headers) as c:
            secret = _resolve_secret(c, cache, url, force=False)
            print(f"  container#{i}: secret={secret[:12]}…")
            return secret

    with cf.ThreadPoolExecutor(max_workers=n) as ex:
        secrets_seen = list(ex.map(one, range(1, n + 1)))

    uniq = set(secrets_seen)
    cached_ciphertext = cache.get(_CACHE_KEY) or ""

    print("\n================ VERDICT ================")
    print(f"  containers: {n}  |  distinct secrets resolved: {len(uniq)}")
    print(f"  ALL CONVERGED to one secret?       -> {len(uniq) == 1}")
    print(
        f"  cache holds CIPHERTEXT (not plain)? -> {cached_ciphertext != secrets_seen[0]}"
    )
    print(
        f"  decrypt(cache) == resolved secret?  -> {decrypt(cached_ciphertext) == secrets_seen[0]}"
    )

    # force-refresh path: bypass cache, re-derive from Composio, must match.
    with httpx.Client(timeout=20, base_url=base, headers=headers) as c:
        refreshed = _resolve_secret(c, cache, url, force=True)
    print(f"  force-refresh re-reads same secret? -> {refreshed == secrets_seen[0]}")

    with httpx.Client(timeout=20, base_url=base, headers=headers) as c:
        for it in c.get("/webhook_subscriptions").json().get("items", []):
            c.delete(f"/webhook_subscriptions/{it['id']}")
    print("  cleaned up.")


COMMANDS = {
    "list": cmd_list,
    "active": cmd_active,
    "create": cmd_create,
    "converge": cmd_converge,
    "watch": cmd_watch,
    "webhooks": cmd_webhooks,
    "register": cmd_register,
}


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd not in COMMANDS:
        sys.exit(f"Unknown command {cmd!r}. One of: {', '.join(COMMANDS)}")
    composio = _client()
    COMMANDS[cmd](composio)
    return 0


if __name__ == "__main__":
    sys.exit(main())
