"""The one rule that decides whether a header edit may replace a session's name.

A pure function over the row's current state and the edit, deliberately separate from both
the service that orchestrates the write and the mapper that stores the answer. It is called
from inside the DAO's write transaction, against the row that transaction has locked, so
the decision is made on the state being written rather than on an earlier read.

The rule exists because an agent decides a `rename_session` call's arguments at one moment
and can run them at a later one. Nothing in the agent's own view separates a stale intent
from a fresh one, so the row answers instead: it remembers whether a person controls the
name, and an automatic caller that wants to replace such a name has to say which name it
believes it is replacing.
"""

from typing import Optional

from oss.src.core.sessions.streams.dtos import (
    SessionNameSource,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.types import SessionNameProtected


def refuse_name_change(
    *,
    session_id: str,
    current_name: Optional[str],
    current_source: Optional[SessionNameSource],
    current_revision: int,
    header: SessionStreamHeaderEdit,
    name_source: SessionNameSource,
) -> None:
    """Raise :class:`SessionNameProtected` when this edit must not change the stored name.

    Four things pass, and each one is a case the guard would break if it refused:

    - A manual edit. A person always wins; that is the point.
    - An edit that sets no name. It changes only the description, which no person authored.
    - A row with no name, or a name no person chose. There is nothing to protect.
    - An edit whose name already equals the stored one. It changes nothing, so refusing it
      would teach the agent that a correct call failed.

    And one more, the narrow authorized case: an edit naming the exact name AND revision it
    replaces. The person asked for this rename, and the session has not moved since, which is
    the only state in which that request is still the one the person made. Both halves are
    load-bearing. Without the name, a guessable counter would be enough to get through.
    Without the revision, restoring an earlier name would revive a request that already ran
    against it, and the person would watch their name change back a second time.
    """
    if name_source is SessionNameSource.manual:
        return
    if header.name is None:
        return
    if not current_name:
        return
    if current_source is not SessionNameSource.manual:
        return
    if header.name == current_name:
        return
    if not header.name:
        # An automatic caller has no legitimate reason to remove a name, and the `name`
        # schema the agent sees forbids it. Letting one through would leave the row with an
        # empty name, which every later automatic rename walks straight past.
        raise SessionNameProtected(
            session_id,
            current_name,
            name_revision=current_revision,
            clearing=True,
        )
    if header.replacing_name is not None or header.replacing_revision is not None:
        if (
            header.replacing_name == current_name
            and header.replacing_revision == current_revision
        ):
            return
        # The caller named a state this session has left. Its authorization was for that
        # state, so it does not carry over to wherever the session is now.
        raise SessionNameProtected(
            session_id,
            current_name,
            name_revision=current_revision,
            stale_precondition=True,
        )
    raise SessionNameProtected(
        session_id,
        current_name,
        name_revision=current_revision,
    )
