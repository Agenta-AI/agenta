"""Skill import provenance on workflow metadata (`meta._ag`) — Package 2.

The artifact carries the CURRENT origin (identity + the last successful import
checkpoint); each imported/applied revision carries flat, immutable provenance.
Detachment is never stored: it derives from comparing the head's content hash
with `origin.last_imported.content_hash` (plan-meta-provenance.md, decision 4).

Every skills-side meta write goes through `merge_ag_meta` — merge, never
replace — so skills code cannot clobber foreign meta keys. Generic workflow
writes are NOT protected in v1 (decision 2): a direct `/workflows` edit can
drop the origin; detachment still fails safe and a re-import restores it.
"""

from typing import Any, Dict, Optional

AG_META_KEY = "_ag"

ORIGIN_KIND_CATALOG = "catalog"


def build_origin(
    *,
    provider: str,
    repository: str,
    ref: Optional[str],
    path: str,
    resolved_version: Optional[str],
    content_hash: str,
    url: Optional[str] = None,
) -> Dict[str, Any]:
    """The artifact-side origin: nested, identity above the mutable checkpoint.
    `url` is provider-supplied (CatalogProvider.item_url) — no provider shapes here."""
    return {
        "kind": ORIGIN_KIND_CATALOG,
        "provider": provider,
        "identifier": f"{repository}/{path}",
        "locator": {"repository": repository, "ref": ref, "path": path},
        "last_imported": {
            "resolved_version": resolved_version,
            "content_hash": content_hash,
            "url": url,
        },
    }


def build_provenance(
    *,
    operation: str,  # "import" | "update"
    provider: str,
    repository: str,
    path: str,
    resolved_version: Optional[str],
    content_hash: str,
    url: Optional[str] = None,
) -> Dict[str, Any]:
    """The revision-side provenance: flat, one immutable event."""
    return {
        "operation": operation,
        "provider": provider,
        "identifier": f"{repository}/{path}",
        "resolved_version": resolved_version,
        "content_hash": content_hash,
        "url": url,
    }


def merge_ag_meta(
    existing: Optional[Dict[str, Any]],
    updates: Dict[str, Any],
) -> Dict[str, Any]:
    """Return `existing` with `updates` merged under `_ag` — the only way skills
    code writes meta. Foreign top-level keys and untouched `_ag` keys survive."""
    merged = dict(existing or {})
    ag = dict(merged.get(AG_META_KEY) or {})
    for key, value in updates.items():
        ag[key] = value
    merged[AG_META_KEY] = ag
    return merged


def read_origin(meta: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(meta, dict):
        return None
    ag = meta.get(AG_META_KEY)
    origin = ag.get("origin") if isinstance(ag, dict) else None
    return origin if isinstance(origin, dict) else None


def origin_locator(origin: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    locator = (origin or {}).get("locator")
    return locator if isinstance(locator, dict) else {}


def read_provenance(meta: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The immutable provenance stamped on one revision by import/update."""
    if not isinstance(meta, dict):
        return None
    ag = meta.get(AG_META_KEY)
    provenance = ag.get("provenance") if isinstance(ag, dict) else None
    return provenance if isinstance(provenance, dict) else None


def effective_anchor_hash(
    origin: Optional[Dict[str, Any]],
    *,
    head_content_hash: Optional[str],
    head_meta: Optional[Dict[str, Any]],
) -> Optional[str]:
    """The hash the head must match to still count as sync-owned.

    Normally the artifact's checkpoint. Applying an update writes the revision
    and the checkpoint separately, so a crash between them would otherwise
    strand the skill as `detached` forever. The head revision's provenance is
    immutable and says what sync wrote, so a head whose OWN provenance matches
    its content reconciles the checkpoint instead of reading as a local edit.
    """
    anchor = last_imported_hash(origin)
    if head_content_hash is not None and head_content_hash == anchor:
        return anchor

    provenance = read_provenance(head_meta)
    if (
        provenance is not None
        and provenance.get("operation") in ("import", "update")
        and provenance.get("content_hash") == head_content_hash
    ):
        return head_content_hash

    return anchor


def last_imported_hash(origin: Optional[Dict[str, Any]]) -> Optional[str]:
    checkpoint = (origin or {}).get("last_imported")
    if not isinstance(checkpoint, dict):
        return None
    value = checkpoint.get("content_hash")
    return value if isinstance(value, str) else None
