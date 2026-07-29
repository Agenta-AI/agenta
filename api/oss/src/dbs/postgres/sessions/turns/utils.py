from typing import Any, Dict, List, Optional

from oss.src.core.sessions.turns.dtos import SessionTurnQuery


def query_turn_references(
    turn: Optional[SessionTurnQuery] = None,
) -> Optional[List[Any]]:
    """eval_runs pattern: flatten to bare {id, slug, version} dicts for .contains()."""
    if not turn or not turn.references:
        return None

    _references: Dict[Any, Any] = dict()

    for reference in turn.references:
        _key = reference.id or reference.slug
        _references[_key] = reference.model_dump(
            mode="json",
            exclude_none=True,
        )

    return list(_references.values()) or None
