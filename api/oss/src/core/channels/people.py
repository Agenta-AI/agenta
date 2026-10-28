"""The people picker behind "Who can message it": settings time only, never on
the message path.

Three sources, in this order:

1. People who wrote to the bot, from the stored inbox events of the connection.
   Always current, one read, no platform call. The only source for Telegram.
2. The workspace directory (Slack `users.list`), kept 24 hours in the shared
   cache. Loaded in the background the first time it is needed and on Refresh.
3. A live lookup of a full email (Slack `users.lookupByEmail`).
"""

import asyncio
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelPeopleDirectory,
    ChannelPerson,
)
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.utils.caching import get_cache, invalidate_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

DIRECTORY_NAMESPACE = "channels:people:directory"
LOADING_NAMESPACE = "channels:people:loading"
FAILED_NAMESPACE = "channels:people:failed"
DIRECTORY_TTL_SECONDS = 24 * 60 * 60
# a load that died without clearing its marker is tried again after this
LOADING_TTL_SECONDS = 10 * 60
# a load Slack refused (a missing scope) is not tried again by itself for this
# long; Refresh tries at once
FAILED_TTL_SECONDS = 60 * 60
# stored messages read for "wrote to the bot"
RECENT_EVENTS = 500
MAX_RESULTS = 50

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# loads running in this process, kept so the event loop does not drop them
_LOADS: Set[asyncio.Task] = set()


class CachedDirectory(BaseModel):
    updated_at: datetime
    people: List[ChannelPerson] = Field(default_factory=list)


def _key(connection_id: UUID) -> Dict[str, str]:
    return {"c": str(connection_id)}


def _matches(person: ChannelPerson, text: str) -> bool:
    if not text:
        return True
    return any(
        text in (value or "").lower()
        for value in (person.name, person.username, person.email, person.id)
    )


def people_who_wrote(senders: List[Dict[str, Any]]) -> List[ChannelPerson]:
    """One entry per sender id, in the order given (newest first)."""

    seen: Set[str] = set()
    people: List[ChannelPerson] = []
    for sender in senders:
        sender_id = sender.get("id")
        if sender_id in (None, ""):
            continue
        sender_id = str(sender_id)
        if sender_id in seen:
            continue
        seen.add(sender_id)
        people.append(
            ChannelPerson(
                id=sender_id,
                name=sender.get("name") or None,
                username=sender.get("username") or None,
                source="messaged",
            )
        )
    return people


async def _load_directory(
    *, adapter, connection: ChannelConnection, project_id: UUID
) -> None:
    try:
        people = await adapter.list_people(connection=connection)
        await set_cache(
            namespace=DIRECTORY_NAMESPACE,
            project_id=str(project_id),
            key=_key(connection.id),
            value=CachedDirectory(updated_at=datetime.now(timezone.utc), people=people),
            ttl=DIRECTORY_TTL_SECONDS,
        )
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warning(
            "[channels] people directory not loaded connection=%s: %s",
            connection.id,
            str(e)[:200],
        )
        await set_cache(
            namespace=FAILED_NAMESPACE,
            project_id=str(project_id),
            key=_key(connection.id),
            value=True,
            ttl=FAILED_TTL_SECONDS,
            release_lock=False,
        )
    finally:
        await invalidate_cache(
            namespace=LOADING_NAMESPACE,
            project_id=str(project_id),
            key=_key(connection.id),
        )


async def _start_directory_load(
    *, adapter, connection: ChannelConnection, project_id: UUID
) -> bool:
    """Start one background load for this connection, unless one already runs
    in any process. True when a load runs now."""

    claimed = await set_cache(
        namespace=LOADING_NAMESPACE,
        project_id=str(project_id),
        key=_key(connection.id),
        value=True,
        ttl=LOADING_TTL_SECONDS,
        nx=True,
        release_lock=False,
    )
    if claimed is None:
        return False  # the shared cache is off or down: nowhere to keep the list
    if claimed:
        task = asyncio.create_task(
            _load_directory(
                adapter=adapter, connection=connection, project_id=project_id
            )
        )
        _LOADS.add(task)
        task.add_done_callback(_LOADS.discard)
    return True


async def forget_directory(*, project_id: UUID, connection_id: UUID) -> None:
    """Drop the cached list, with its installation or on Refresh."""

    await invalidate_cache(
        namespace=DIRECTORY_NAMESPACE,
        project_id=str(project_id),
        key=_key(connection_id),
    )


async def query_people(
    *,
    adapter,
    connection: ChannelConnection,
    project_id: UUID,
    senders: List[Dict[str, Any]],
    text: Optional[str],
) -> Tuple[List[ChannelPerson], ChannelPeopleDirectory]:
    """The picker's matches, and the state of the workspace list. `senders`
    are the stored senders, newest first."""

    needle = (text or "").strip().lower()
    found: Dict[str, ChannelPerson] = {}

    for person in people_who_wrote(senders):
        if _matches(person, needle):
            found[person.id] = person

    directory = ChannelPeopleDirectory(state="unavailable")
    if adapter.lists_people and env.agenta.api.caching.enabled:
        cached = await get_cache(
            namespace=DIRECTORY_NAMESPACE,
            project_id=str(project_id),
            key=_key(connection.id),
            model=CachedDirectory,
            retry=False,
        )
        if cached is not None:
            directory = ChannelPeopleDirectory(
                state="ready", updated_at=cached.updated_at
            )
            by_id = {person.id: person for person in cached.people}
            # people who wrote get their workspace name and email
            for person_id in list(found):
                known = by_id.get(person_id)
                if known is not None:
                    found[person_id] = known.model_copy(update={"source": "messaged"})
            if needle:
                for person in cached.people:
                    if person.is_bot or person.is_deleted or person.id in found:
                        continue
                    if _matches(person, needle):
                        found[person.id] = person
        elif await get_cache(
            namespace=FAILED_NAMESPACE,
            project_id=str(project_id),
            key=_key(connection.id),
            retry=False,
        ):
            directory = ChannelPeopleDirectory(state="failed")
        elif await _start_directory_load(
            adapter=adapter, connection=connection, project_id=project_id
        ):
            directory = ChannelPeopleDirectory(state="loading")

    if _EMAIL.match(needle) and not any(
        (person.email or "").lower() == needle for person in found.values()
    ):
        person = None
        try:
            person = await adapter.find_person_by_email(
                connection=connection, email=needle
            )
        except ChannelNotSupported:
            pass
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.warning(
                "[channels] email lookup failed connection=%s: %s",
                connection.id,
                str(e)[:200],
            )
        if person is not None and not person.is_bot:
            found.setdefault(person.id, person)

    return list(found.values())[:MAX_RESULTS], directory


async def refresh_people(
    *, adapter, connection: ChannelConnection, project_id: UUID
) -> ChannelPeopleDirectory:
    """Drop the cached list and load it again in the background."""

    if not (adapter.lists_people and env.agenta.api.caching.enabled):
        return ChannelPeopleDirectory(state="unavailable")
    await forget_directory(project_id=project_id, connection_id=connection.id)
    await invalidate_cache(
        namespace=FAILED_NAMESPACE,
        project_id=str(project_id),
        key=_key(connection.id),
    )
    started = await _start_directory_load(
        adapter=adapter, connection=connection, project_id=project_id
    )
    return ChannelPeopleDirectory(state="loading" if started else "unavailable")
