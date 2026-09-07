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
PROVIDER_GITHUB = "github"


def build_origin(
    *,
    repository: str,
    ref: Optional[str],
    path: str,
    resolved_version: Optional[str],
    content_hash: str,
    provider: str = PROVIDER_GITHUB,
) -> Dict[str, Any]:
    """The artifact-side origin: nested, identity above the mutable checkpoint."""
    return {
        "kind": ORIGIN_KIND_CATALOG,
        "provider": provider,
        "identifier": f"{repository}/{path}",
        "locator": {"repository": repository, "ref": ref, "path": path},
        "last_imported": {
            "resolved_version": resolved_version,
            "content_hash": content_hash,
            "url": _github_url(repository, resolved_version, path),
        },
    }


def build_provenance(
    *,
    operation: str,  # "import" | "update"
    repository: str,
    path: str,
    resolved_version: Optional[str],
    content_hash: str,
    provider: str = PROVIDER_GITHUB,
) -> Dict[str, Any]:
    """The revision-side provenance: flat, one immutable event."""
    return {
        "operation": operation,
        "provider": provider,
        "identifier": f"{repository}/{path}",
        "resolved_version": resolved_version,
        "content_hash": content_hash,
        "url": _github_url(repository, resolved_version, path),
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


def last_imported_hash(origin: Optional[Dict[str, Any]]) -> Optional[str]:
    checkpoint = (origin or {}).get("last_imported")
    if not isinstance(checkpoint, dict):
        return None
    value = checkpoint.get("content_hash")
    return value if isinstance(value, str) else None


def _github_url(
    repository: str, resolved_version: Optional[str], path: str
) -> Optional[str]:
    if not resolved_version:
        return None
    return f"https://github.com/{repository}/tree/{resolved_version}/{path}"
