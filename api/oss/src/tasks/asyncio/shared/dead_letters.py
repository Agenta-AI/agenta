"""Inspect and replay a stream's dead letters (`<stream>:dead`, see `StreamConsumer.dead_letter`).

    python -m oss.src.tasks.asyncio.shared.dead_letters list streams:debits
    python -m oss.src.tasks.asyncio.shared.dead_letters replay streams:debits [ID ...]

`replay` moves each dead letter (all of them, or the given dead-letter ids) back onto the
source stream as a new entry, so the consumer processes it again. Only replay into a
consumer whose processing is idempotent per entry; the wallet streams are.
"""

import sys
import asyncio
from typing import Dict, List, Optional, Tuple

from redis.asyncio import Redis

from oss.src.tasks.asyncio.shared.consumer import (
    DEAD_LETTER_DESCRIPTION,
    DEAD_LETTER_REASON,
    DEAD_LETTER_SOURCE_ID,
    dead_letter_stream_of,
)

_DEAD_LETTER_FIELDS = {
    DEAD_LETTER_REASON,
    DEAD_LETTER_SOURCE_ID,
    DEAD_LETTER_DESCRIPTION,
}
_PAGE = 100


async def list_dead_letters(
    redis: Redis,
    *,
    stream: str,
    count: int = _PAGE,
) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
    return await redis.xrange(dead_letter_stream_of(stream), count=count)


async def replay_dead_letters(
    redis: Redis,
    *,
    stream: str,
    ids: Optional[List[str]] = None,
) -> int:
    """Move dead letters back onto `stream`; returns how many were moved."""
    dead_stream = dead_letter_stream_of(stream)

    if ids:
        entries = []
        for entry_id in ids:
            entries += await redis.xrange(dead_stream, min=entry_id, max=entry_id)
        return await _move_back(redis, stream=stream, entries=entries)

    # Stop at the newest dead letter seen now: an entry the consumer dead-letters again
    # while this runs must not be replayed in a loop.
    newest = await redis.xrevrange(dead_stream, count=1)
    if not newest:
        return 0
    last_id = newest[0][0]

    moved = 0
    while True:
        entries = await redis.xrange(dead_stream, max=last_id, count=_PAGE)
        if not entries:
            return moved
        moved += await _move_back(redis, stream=stream, entries=entries)


async def _move_back(
    redis: Redis,
    *,
    stream: str,
    entries: List[Tuple[bytes, Dict[bytes, bytes]]],
) -> int:
    dead_stream = dead_letter_stream_of(stream)
    for entry_id, fields in entries:
        original = {k: v for k, v in fields.items() if k not in _DEAD_LETTER_FIELDS}
        # Written before the dead letter is removed, never in one MULTI: Redis runs the
        # rest of a transaction even when a command in it fails. A crash in between leaves
        # the entry in both streams, and replaying it twice is harmless.
        await redis.xadd(stream, original)
        await redis.xdel(dead_stream, entry_id)
    return len(entries)


async def _main(argv: List[str]) -> int:
    from oss.src.utils.env import env

    if len(argv) < 2 or argv[0] not in {"list", "replay"}:
        print(__doc__)
        return 2
    command, stream, ids = argv[0], argv[1], argv[2:]

    redis = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    try:
        if command == "list":
            dead_stream = dead_letter_stream_of(stream)
            print(f"{dead_stream}: {await redis.xlen(dead_stream)} dead letters")
            for entry_id, fields in await list_dead_letters(redis, stream=stream):
                print(
                    entry_id.decode(),
                    fields.get(DEAD_LETTER_SOURCE_ID, b"").decode(),
                    fields.get(DEAD_LETTER_DESCRIPTION, b"").decode(),
                    fields.get(DEAD_LETTER_REASON, b"").decode(),
                    sep="  ",
                )
        else:
            moved = await replay_dead_letters(redis, stream=stream, ids=ids or None)
            print(f"replayed {moved} dead letters onto {stream}")
    finally:
        await redis.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main(sys.argv[1:])))
