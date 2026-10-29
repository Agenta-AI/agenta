"""JSONB (de)serialization for the reference lists sessions store.

Shared by `session_turns.references` and `session_streams.references` so the two
columns can never drift into different element shapes.
"""

from typing import Any, Dict, List, Optional

from oss.src.core.sessions.types import SessionReference


def references_to_json(
    references: Optional[List[SessionReference]],
) -> Optional[List[dict]]:
    if not references:
        return None
    return [
        reference.model_dump(mode="json", exclude_none=True) for reference in references
    ]


def references_from_json(
    references: Optional[List[dict]],
) -> Optional[List[SessionReference]]:
    if not references:
        return None
    return [
        SessionReference.model_validate(reference)
        for reference in references
        if isinstance(reference, dict)
    ]


def references_containment_json(
    references: Optional[List[SessionReference]],
) -> Optional[List[Any]]:
    """The `@>` operand for a reference filter, deduplicated by id/slug.

    `key` is excluded, exactly as eval_runs excludes its own: containment is a subset
    match, so an operand carrying the discriminator would stop matching every row written
    before elements were tagged.

    One definition for both reference columns — `session_turns` and `session_streams` are
    unioned into a single filter result, so a semantic difference between them would make
    the same query return different sessions depending on which column happened to be
    populated.
    """
    if not references:
        return None

    deduplicated: Dict[Any, Any] = {}
    for reference in references:
        deduplicated[reference.id or reference.slug] = reference.model_dump(
            mode="json",
            exclude_none=True,
            exclude={"key"},
        )

    return list(deduplicated.values()) or None
