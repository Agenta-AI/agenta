from typing import Any, List, Optional

from oss.src.core.sessions.turns.dtos import SessionTurnQuery
from oss.src.dbs.postgres.sessions.references import references_containment_json


def query_turn_references(
    turn: Optional[SessionTurnQuery] = None,
) -> Optional[List[Any]]:
    """eval_runs pattern: flatten to bare {id, slug, version} dicts for .contains()."""
    if not turn:
        return None

    return references_containment_json(turn.references)
