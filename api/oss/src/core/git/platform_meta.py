"""The backend-owned `meta._ag` namespace (skills plan-meta-provenance.md, decision 2).

`meta` is a client-owned free-form blob EXCEPT for the `_ag` key, which the
platform owns (import provenance today; anything the backend must trust
tomorrow). The git DAO guards every meta write with `guard_platform_meta`, so
the rule holds for every git entity and every route — including legacy paths,
which construct the same DAO:

- EDITS preserve the stored `_ag` regardless of what the client sent — it can
  be neither replaced nor removed.
- CREATES and COMMITS strip an incoming `_ag` — a client cannot forge
  provenance, and a local-edit commit does not inherit it (derived detachment
  depends on that absence).
- A TRUSTED write (`platform_meta=True`, threaded only from platform code such
  as the skills import/update services) passes through unguarded.
"""

from typing import Any, Dict, Optional

PLATFORM_META_KEY = "_ag"


def guard_platform_meta(
    incoming: Optional[Dict[str, Any]],
    existing: Optional[Dict[str, Any]],
    *,
    trusted: bool,
    preserve: bool,
) -> Optional[Dict[str, Any]]:
    """The meta value to store, with the `_ag` rule applied.

    `preserve=True` is the EDIT rule (existing `_ag` survives), `preserve=False`
    the CREATE/COMMIT rule (incoming `_ag` is dropped)."""
    if trusted:
        return incoming

    stored_ag = (existing or {}).get(PLATFORM_META_KEY) if preserve else None

    cleaned: Optional[Dict[str, Any]] = None
    if incoming is not None:
        cleaned = {k: v for k, v in incoming.items() if k != PLATFORM_META_KEY}

    if stored_ag is None:
        return cleaned

    return {**(cleaned or {}), PLATFORM_META_KEY: stored_ag}
