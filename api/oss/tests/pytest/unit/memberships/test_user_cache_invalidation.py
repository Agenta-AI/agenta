"""`invalidate_user_cache` clears with one scan the keys that the per-pair
`invalidate_cache` calls clear."""

from fnmatch import fnmatchcase
from uuid import uuid4

import oss.src.utils.caching as caching
from oss.src.utils.caching import _pack, invalidate_user_cache
from oss.src.utils.env import env


class _Redis:
    def __init__(self, keys):
        self.keys = set(keys)
        self.scans = 0

    async def scan(self, *, cursor, match, count):
        self.scans += 1
        return 0, [k for k in self.keys if fnmatchcase(k, match)]

    async def delete(self, *keys):
        for key in keys:
            self.keys.discard(key)
        return len(keys)


async def test_one_scan_clears_exactly_the_per_pair_keys(monkeypatch):
    user, other = str(uuid4()), str(uuid4())
    projects = [str(uuid4()) for _ in range(72)]
    outside = str(uuid4())
    namespaces = ("check_action_access", "verify_bearer_token", "resolve_membership")

    cleared = [
        _pack(namespace=n, key={"k": 1}, project_id=p, user_id=user)
        for p in projects
        for n in namespaces
    ] + [_pack(namespace="verify_bearer_token", key="state", user_id=user)]
    kept = [
        _pack(
            namespace="check_action_access", key="k", project_id=outside, user_id=user
        ),
        _pack(namespace="other", key="k", project_id=projects[0], user_id=user),
        _pack(
            namespace="check_action_access",
            key="k",
            project_id=projects[0],
            user_id=other,
        ),
        _pack(namespace="check_action_access", key="k", user_id=user),
    ]
    redis = _Redis(cleared + kept)
    monkeypatch.setattr(caching, "_cache_engine", redis)
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)

    assert (
        await invalidate_user_cache(
            user_id=user,
            project_ids=projects,
            namespaces=namespaces,
            projectless_namespaces=("verify_bearer_token",),
        )
        is True
    )

    assert redis.scans == 1
    assert redis.keys == set(kept)


async def test_a_redis_failure_returns_none(monkeypatch):
    class _Broken:
        async def scan(self, **_):
            raise ConnectionError("down")

    monkeypatch.setattr(caching, "_cache_engine", _Broken())
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)

    assert (
        await invalidate_user_cache(
            user_id=str(uuid4()), project_ids=[str(uuid4())], namespaces=("x",)
        )
        is None
    )
