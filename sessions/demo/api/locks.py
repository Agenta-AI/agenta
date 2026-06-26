"""FastAPI-owned `attached` lock — "is a BROWSER currently watching this session's run?".

This lives in FastAPI (not the sidecar) because the browser talks to FastAPI: only FastAPI
sits at the browser boundary and can observe a client connecting / disconnecting. It is the
counterpart to the sidecar's `live` lock ("is a run executing?"). The two are independent:

    alive=yes, attached=yes -> running, someone is watching       -> 409 (force to take over)
    alive=yes, attached=no  -> running but DETACHED (driver left)  -> reattachable
    alive=no                -> idle

Critically, dropping `attached` on browser disconnect must NOT cancel the run or stop
persistence — those are wholly the sidecar's job now (it persists every event to /events as it
is produced). `attached` is purely "who is watching the live view", and the live view is
disposable. The short TTL is a backstop for a hard client crash; the explicit drop on
disconnect is the fast path.
"""

import os

import redis.asyncio as aioredis

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")
# short TTL: this tracks a live browser connection, so it must expire quickly if the holder
# dies without a clean disconnect. Refreshed well under the TTL while connected.
ATTACHED_TTL_MS = int(os.environ.get("ATTACHED_TTL_MS", 20_000))
ATTACHED_REFRESH_S = max(1, (ATTACHED_TTL_MS // 1000) // 3)

_redis: aioredis.Redis | None = None


def _client() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


def _key(sid: str) -> str:
    return f"attached:session:{sid}"


def _displaced_channel(sid: str) -> str:
    # a steal of `attached` publishes here so the displaced watcher tears down IMMEDIATELY
    # (no tick wait). The token TTL probe remains a backstop if the message is missed.
    return f"displaced:session:{sid}"


# release only if we still hold the token (never drop someone else's attach)
_RELEASE_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) "
    "else return 0 end"
)


async def acquire_attached(sid: str, token: str) -> None:
    # The `live` lock is the real gate (a run owns it); `attached` is just "who is watching",
    # so take it unconditionally (a stale watcher loses the view, nothing else). Read the PRIOR
    # holder first; if there was a DIFFERENT one, kick it (publish its token) so its watch unwinds
    # at once — no tick wait. We publish the displaced token, not ours, so we never kick ourselves
    # and an unrelated watcher ignores it (it only reacts to its own token being kicked).
    r = _client()
    prior = await r.get(_key(sid))
    await r.set(_key(sid), token, px=ATTACHED_TTL_MS)
    print(
        f"[acquire {sid[:8]}] tok={token[:8]} prior={(prior or '-')[:8]} "
        f"{'KICK' if (prior and prior != token) else 'no-kick'}",
        flush=True,
    )
    if prior and prior != token:
        await r.publish(_displaced_channel(sid), prior)


async def wait_displaced(sid: str, token: str) -> None:
    """Block until OUR `token` is kicked off `attached` — i.e. a newer watcher acquired the lock and
    published our (now-prior) token on the displacement channel. Lets a displaced watcher close with
    no tick lag. The per-tick TTL probe is the backstop if the kick is missed (e.g. published before
    we subscribed)."""
    pubsub = _client().pubsub()
    try:
        await pubsub.subscribe(_displaced_channel(sid))
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            if msg.get("data") == token:  # OUR token was kicked -> we've been displaced
                print(
                    f"[displaced {sid[:8]}] OUR tok={token[:8]} was kicked", flush=True
                )
                return
    finally:
        try:
            await pubsub.unsubscribe(_displaced_channel(sid))
            await pubsub.aclose()
        except Exception:
            pass


async def refresh_attached(sid: str, token: str, ttl: bool = True) -> bool:
    # Returns whether we STILL OWN the lock (a cheap ownership probe). False means another watcher
    # STOLE it (attach is an unconditional SET), so the caller's watch must unwind — the displaced
    # browser stops being the watcher. `ttl=True` also re-arms the TTL; pass ttl=False to probe
    # ownership without resetting the expiry (so the steal check can run every tick, cheaply).
    r = _client()
    if await r.get(_key(sid)) != token:
        return False
    if ttl:
        await r.pexpire(_key(sid), ATTACHED_TTL_MS)
    return True


async def release_attached(sid: str, token: str) -> None:
    try:
        await _client().eval(_RELEASE_LUA, 1, _key(sid), token)
    except Exception:
        pass


async def status_many(sids: list[str]) -> dict[str, dict]:
    """Read alive + attached for many sessions in one round-trip each. Returns
    {sid: {"alive": bool, "attached": bool, "reattachable": bool}}."""
    if not sids:
        return {}
    r = _client()
    keys = [f"alive:session:{s}" for s in sids] + [_key(s) for s in sids]
    vals = await r.mget(keys)
    n = len(sids)
    out = {}
    for i, s in enumerate(sids):
        alive = vals[i] is not None
        attached = vals[n + i] is not None
        out[s] = {
            "alive": alive,
            "attached": attached,
            "reattachable": alive and not attached,
        }
    return out
