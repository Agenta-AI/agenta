"""Cache entries a request reads in the access decision's one `MGET`.

A decision reads the principal record and the likely membership in one Redis round trip
(`AccessService._principal_record`). A caller that will read more cache entries in the same
request registers them here first (the resource's sharing entry, a list's grants, an
admission's session and agent), and the decision's `MGET` reads them too. The value of each
entry, a hit or a miss, is then kept in the request memo, so the later read makes no round
trip. An entry registered after the decision's `MGET` is read by the first reader that needs
it, together with every other entry still pending (one `MGET`).

Outside a request there is no memo and nothing is registered: every reader reads Redis
itself, as before. `request_memo_scope` gives a unit of work outside a request (a queued
dispatch, a trigger) its own memo for its duration.
"""

import json
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Tuple

from oss.src.core.access.context import _request_memo, get_request_memo


_PENDING = "prefetch_pending"
_VALUES = "prefetch_values"


def memo_key(entry: Dict[str, Any]) -> Tuple[str, str, str, str]:
    """The memo key of one `get_cache_many` entry: its naming arguments."""

    key = entry.get("key")
    return (
        str(entry.get("namespace")),
        str(entry.get("project_id")),
        str(entry.get("user_id")),
        key if isinstance(key, str) else json.dumps(key, sort_keys=True),
    )


def register(entry: Dict[str, Any]) -> None:
    """Ask the request's next `MGET` to read `entry`. No I/O. A no-op outside a
    request, or when the entry was already read in this request."""

    memo = get_request_memo()
    if memo is None:
        return
    name = memo_key(entry)
    if name in memo.get(_VALUES, {}):
        return
    memo.setdefault(_PENDING, {})[name] = entry


def pending() -> List[Dict[str, Any]]:
    """The registered entries no `MGET` has read yet."""

    memo = get_request_memo()
    if memo is None:
        return []
    return list(memo.get(_PENDING, {}).values())


def store(entries: List[Dict[str, Any]], values: List[Any]) -> None:
    """Keep what one `MGET` read for these entries (None = a miss)."""

    memo = get_request_memo()
    if memo is None:
        return
    read = memo.setdefault(_VALUES, {})
    waiting = memo.get(_PENDING, {})
    for entry, value in zip(entries, values):
        name = memo_key(entry)
        read[name] = value
        waiting.pop(name, None)


def remember(entry: Dict[str, Any], value: Any) -> None:
    """Keep a value this request read or wrote itself."""

    store([entry], [value])


def lookup(entry: Dict[str, Any]) -> Tuple[bool, Optional[Any]]:
    """(found, value): whether this request already read the entry, and its value."""

    memo = get_request_memo()
    if memo is None:
        return False, None
    read = memo.get(_VALUES, {})
    name = memo_key(entry)
    if name in read:
        return True, read[name]
    return False, None


async def read(entry: Dict[str, Any]) -> Tuple[bool, Optional[Any]]:
    """The entry from the memo; when it is still pending, every pending entry is read in
    one `MGET` first. (False, None) when the entry was never registered in this request
    (the caller then reads Redis itself)."""

    found, value = lookup(entry)
    if found:
        return True, value
    memo = get_request_memo()
    if memo is None or memo_key(entry) not in memo.get(_PENDING, {}):
        return False, None
    await flush()
    return lookup(entry)


async def flush() -> None:
    """Read every pending entry in one `MGET`."""

    from oss.src.utils.caching import get_cache_many  # noqa: PLC0415

    entries = pending()
    if not entries:
        return
    store(entries, await get_cache_many(entries))


@contextmanager
def request_memo_scope() -> Iterator[None]:
    """A memo for a unit of work outside a request; inside one, the request's memo."""

    if get_request_memo() is not None:
        yield
        return
    token = _request_memo.set({})
    try:
        yield
    finally:
        _request_memo.reset(token)
