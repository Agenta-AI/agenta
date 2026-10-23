"""`FakeCache`: an in-memory stand-in for the Redis cache helpers of
`oss.src.utils.caching`.

It stores the bytes made by the real `_serialize` and reads them back with the real
`_deserialize`, so the `exclude_none` behavior of the real cache is exercised: a model
whose required `Optional` field is dropped fails validation on read and is a miss, as in
production. A stored `None` reads as a miss, as in Redis. Names come from the real
`_pack`; pattern invalidation matches Redis glob patterns with `fnmatch`.

Use `fake.install(monkeypatch, module, ...)` to patch `get_cache`, `set_cache`,
`invalidate_cache` and `invalidate_user_cache` in each module under test (the modules import the names directly).
"""

from fnmatch import fnmatchcase
from typing import Any, Dict, List, Optional, Sequence, Type, Union

from pydantic import BaseModel

from oss.src.utils import caching


class FakeCache:
    def __init__(self, *, fail: bool = False) -> None:
        self.store: Dict[str, bytes] = {}
        self.gets: List[str] = []
        self.sets: List[str] = []
        self.deletes: List[str] = []
        self.scans: List[str] = []
        # When true every call behaves like a Redis error: get misses, set and
        # invalidate return None.
        self.fail = fail

    # -- the three helpers, same signatures as oss.src.utils.caching -----------------

    async def get_cache(
        self,
        namespace: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        key: Optional[Union[str, dict]] = None,
        model: Optional[Type[BaseModel]] = None,
        is_list: Optional[bool] = False,
        retry: Optional[bool] = True,
        **_: Any,
    ) -> Optional[Any]:
        name = caching._pack(
            namespace=namespace, key=key, project_id=project_id, user_id=user_id
        )
        self.gets.append(name)
        if self.fail:
            return None
        raw = self.store.get(name)
        if raw is None:
            return None
        try:
            return caching._deserialize(raw, model=model, is_list=bool(is_list))
        except Exception:  # pylint: disable=broad-exception-caught
            # The real get_cache logs and returns a miss.
            return None

    async def set_cache(
        self,
        namespace: str,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        key: Optional[Union[str, dict]] = None,
        value: Optional[Any] = None,
        ttl: Optional[int] = caching.AGENTA_CACHE_TTL,
    ) -> Optional[bool]:
        name = caching._pack(
            namespace=namespace, key=key, project_id=project_id, user_id=user_id
        )
        self.sets.append(name)
        if self.fail:
            return None
        self.store[name] = caching._serialize(value)
        return True

    async def invalidate_cache(
        self,
        namespace: Optional[str] = None,
        key: Optional[Union[str, dict]] = None,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Optional[bool]:
        if key is not None and namespace is not None:
            name = caching._pack(
                namespace=namespace, key=key, project_id=project_id, user_id=user_id
            )
            self.deletes.append(name)
            if self.fail:
                return None
            self.store.pop(name, None)
            return True

        pattern = caching._pack(
            namespace=namespace, project_id=project_id, user_id=user_id, pattern=True
        )
        self.scans.append(pattern)
        if self.fail:
            return None
        for name in [n for n in self.store if fnmatchcase(n, pattern)]:
            del self.store[name]
        return True

    async def invalidate_user_cache(
        self,
        *,
        user_id: str,
        project_ids: Sequence[str],
        namespaces: Sequence[str],
        projectless_namespaces: Sequence[str] = (),
    ) -> Optional[bool]:
        """One scan of the user's keys, then the keys the real helper selects."""

        user_part = caching._pack(user_id=user_id).split(":")[4]
        pattern = f"cache:p:*:u:{user_part}:*"
        self.scans.append(pattern)
        if self.fail:
            return None
        keys = [n for n in self.store if fnmatchcase(n, pattern)]
        for name in caching.user_keys_to_clear(
            keys,
            project_ids=project_ids,
            namespaces=namespaces,
            projectless_namespaces=projectless_namespaces,
        ):
            self.store.pop(name, None)
        return True

    # -- helpers ----------------------------------------------------------------------

    def install(self, monkeypatch, *modules) -> "FakeCache":
        for module in modules:
            for attr in (
                "get_cache",
                "set_cache",
                "invalidate_cache",
                "invalidate_user_cache",
            ):
                if hasattr(module, attr):
                    monkeypatch.setattr(module, attr, getattr(self, attr))
        return self

    def names(self, namespace: str) -> List[str]:
        return [n for n in self.store if f":{namespace}:" in n]

    def reset_calls(self) -> None:
        self.gets.clear()
        self.sets.clear()
        self.deletes.clear()
        self.scans.clear()
