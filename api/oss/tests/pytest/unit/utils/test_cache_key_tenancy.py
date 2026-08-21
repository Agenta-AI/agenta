"""Security-sensitive cache keys must carry the FULL tenant id.

The default key packing truncates project ids to their last 12 characters — fine for
display-length economy, but two projects sharing a UUID suffix would share a cache entry.
`full_project_id=True` is the opt-in the vault namespaces use; these pin both the key
shape and the end-to-end isolation through the real (de)serialization path.

The truncated default is a TRACKED EXCEPTION, not the intended end state: every other
namespace — `check_permissions` and `check_action_access` included — still keys on the
short id. Flipping the default needs `invalidate_cache` to carry the flag too, and a
deploy plan for the evaluation lock keys (a key-shape change mid rolling deploy loses
mutual exclusion). Tracked in issue #6166; the test below pins the hazard so the
exception stays visible instead of reading as an invariant.
"""

import pytest
from pydantic import BaseModel

from oss.src.utils import caching
from oss.src.utils.caching import get_cache, pack, set_cache


# Same 12-character suffix, different projects.
PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-123456789012"
PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-123456789012"


def test_the_truncated_default_is_a_known_collision_hazard_full_packing_removes():
    # Not a property worth keeping: a live record of what issue #6166 has to fix. When the
    # default flips, this assertion inverts and the namespaces below stop needing the flag.
    truncated_a = pack(namespace="list_secrets", key={}, project_id=PROJECT_A)
    truncated_b = pack(namespace="list_secrets", key={}, project_id=PROJECT_B)
    assert truncated_a == truncated_b

    full_a = pack(
        namespace="list_secrets", key={}, project_id=PROJECT_A, full_project_id=True
    )
    full_b = pack(
        namespace="list_secrets", key={}, project_id=PROJECT_B, full_project_id=True
    )
    assert full_a != full_b
    assert PROJECT_A in full_a
    assert PROJECT_B in full_b


class _FakeRedis:
    """Just enough of the engine surface for set/get, storing by exact key."""

    def __init__(self):
        self.store = {}

    async def set(self, name, value, px=None, nx=False, ex=None):
        if nx and name in self.store:
            return False
        self.store[name] = value
        return True

    async def get(self, name):
        return self.store.get(name)

    async def expire(self, name, ttl):
        return True

    async def delete(self, name):
        return self.store.pop(name, None) is not None


class _Entry(BaseModel):
    owner: str


@pytest.mark.asyncio
async def test_full_id_keys_isolate_same_suffix_projects_through_real_serialization(
    monkeypatch,
):
    # The unit conftest flips caching off (no live Redis); the fake engine stands in.
    monkeypatch.setattr(caching.env.agenta.api.caching, "enabled", True)
    monkeypatch.setattr(caching, "_cache_engine", _FakeRedis())

    await set_cache(
        namespace="list_secrets",
        project_id=PROJECT_A,
        key={},
        value=_Entry(owner="a"),
        full_project_id=True,
    )
    await set_cache(
        namespace="list_secrets",
        project_id=PROJECT_B,
        key={},
        value=_Entry(owner="b"),
        full_project_id=True,
    )

    read_a = await get_cache(
        namespace="list_secrets",
        project_id=PROJECT_A,
        key={},
        model=_Entry,
        retry=False,
        full_project_id=True,
    )
    read_b = await get_cache(
        namespace="list_secrets",
        project_id=PROJECT_B,
        key={},
        model=_Entry,
        retry=False,
        full_project_id=True,
    )

    assert read_a.owner == "a"
    assert read_b.owner == "b"


@pytest.mark.asyncio
async def test_truncated_keys_do_cross_projects_which_is_why_the_vault_opts_out(
    monkeypatch,
):
    monkeypatch.setattr(caching.env.agenta.api.caching, "enabled", True)
    monkeypatch.setattr(caching, "_cache_engine", _FakeRedis())

    await set_cache(
        namespace="list_secrets",
        project_id=PROJECT_A,
        key={},
        value=_Entry(owner="a"),
    )

    crossed = await get_cache(
        namespace="list_secrets",
        project_id=PROJECT_B,
        key={},
        model=_Entry,
        retry=False,
    )

    assert crossed is not None and crossed.owner == "a"
