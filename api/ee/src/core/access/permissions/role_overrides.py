"""EE-only role-override parsing (custom roles are an EE feature).

Parses and applies `AGENTA_ACCESS_ROLES` / `AGENTA_ACCESS_ROLES_OVERLAY` on top
of the OSS code-default role catalog. Invoked from
`oss.src.core.access.permissions.controls.build_role_controls()` via a
function-local `is_ee()`-guarded import.

The default-catalog builders and the minima contract live in OSS
(`oss.src.core.access.permissions.controls`); this module only adds the
override layer.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from oss.src.utils.env import env
from oss.src.core.access.permissions.types import (
    Permission,
    RequiredRole,
)
from oss.src.core.access.permissions.controls import (
    SCOPES,
    _default_roles,
    _minima_for,
)


# ---------------------------------------------------------------------------
# Override schemas
# ---------------------------------------------------------------------------


class _RoleOverride(BaseModel):
    role: str
    description: Optional[str] = None
    permissions: List[str]

    model_config = ConfigDict(extra="forbid")


class _RoleOverlayEntry(BaseModel):
    """Partial role update. ``permissions`` and ``description`` are both
    optional; whatever is set replaces the matching field on the existing
    role entry. To add a new role both fields must be supplied — that
    constraint is enforced in :func:`_apply_roles_overlay`.
    """

    description: Optional[str] = None
    permissions: Optional[List[str]] = None

    model_config = ConfigDict(extra="forbid")


def _validate_permission(slug: str) -> str:
    if slug == "*":
        return slug
    try:
        Permission(slug)
    except ValueError as e:
        raise ValueError(f"Unknown permission '{slug}'") from e
    return slug


def _parse_roles_override(decoded: Any) -> Dict[str, List[Dict[str, Any]]]:
    """Parse `AGENTA_ACCESS_ROLES` and merge with scope minima.

    Schema is `{scope: [role, ...]}` where scope is one of `organization`,
    `workspace`, `project`. Missing scopes fall back to the code-default
    minima for that scope. Within an overridden scope:

      - `owner`, `admin`, `viewer` are reserved slugs; if present, they're
        rejected with a clear error so application invariants stay intact. The
        minima for that scope are re-applied after parsing.
      - Other roles are validated (known permissions, no duplicates) and
        appended to the minima list.

    Empty `{}` or an empty per-scope list is rejected.
    """
    if not isinstance(decoded, dict) or not decoded:
        raise ValueError("AGENTA_ACCESS_ROLES must be a non-empty JSON object")

    # Start with code-default catalogs for every scope. Overrides only mutate
    # the scopes they specify; non-overridden scopes keep their full code
    # defaults (e.g. workspace's admin/developer/editor/annotator stay even
    # when only `project` is overridden).
    result: Dict[str, List[Dict[str, Any]]] = _default_roles()

    reserved = {
        RequiredRole.OWNER.value,
        RequiredRole.ADMIN.value,
        RequiredRole.VIEWER.value,
    }

    for scope, roles in decoded.items():
        if scope not in SCOPES:
            raise ValueError(
                f"Unknown role scope '{scope}' in AGENTA_ACCESS_ROLES "
                f"(allowed: {list(SCOPES)})"
            )

        if not isinstance(roles, list) or not roles:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES['{scope}'] must be a non-empty list of roles"
            )

        extras: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for entry in roles:
            try:
                role = _RoleOverride.model_validate(entry)
            except ValidationError as e:
                raise ValueError(
                    f"Invalid role override under scope '{scope}': {e}"
                ) from e

            slug = role.role
            if not slug:
                raise ValueError(f"Empty role slug under scope '{scope}'")
            if slug in reserved:
                raise ValueError(
                    f"AGENTA_ACCESS_ROLES['{scope}'] cannot redefine reserved "
                    f"role '{slug}'; minima are always synthesized by the platform"
                )
            if slug in seen:
                raise ValueError(f"Duplicate role slug '{slug}' under scope '{scope}'")
            seen.add(slug)

            permissions = [_validate_permission(p) for p in role.permissions]

            extras.append(
                {
                    "role": slug,
                    "description": role.description,
                    "permissions": permissions,
                }
            )

        # Minima first, then validated extras.
        result[scope] = _minima_for(scope) + extras

    # TEMP: workspace and project use the same role set at runtime (the only
    # caller of `workspace`-scope roles today is the Invite Members modal,
    # which is really inviting to the underlying project). Operators almost
    # always override only `project` via AGENTA_ACCESS_ROLES; without this
    # mirror, custom roles silently disappear from the workspace catalog.
    # Remove once the workspace/project scope split is reconciled.
    if "project" in decoded and "workspace" not in decoded:
        project_extras = [
            entry
            for entry in result["project"]
            if entry["role"]
            not in {
                RequiredRole.OWNER.value,
                RequiredRole.ADMIN.value,
                RequiredRole.VIEWER.value,
            }
        ]
        result["workspace"] = _minima_for("workspace") + project_extras

    return result


# ---------------------------------------------------------------------------
# Roles overlay
# ---------------------------------------------------------------------------
#
# `AGENTA_ACCESS_ROLES_OVERLAY` lets operators tweak individual fields on
# existing default roles (`admin`, `developer`, `editor`, `annotator`) — or
# add new roles — without restating the whole scope catalog the way
# `AGENTA_ACCESS_ROLES` requires. See the parser docstring for the two accepted
# payload shapes.


def _parse_roles_overlay(decoded: Any) -> Dict[str, _RoleOverlayEntry]:
    """Parse `AGENTA_ACCESS_ROLES_OVERLAY` and return per-slug entries.

    Two accepted payload shapes:

    1. Project-focused shortcut — ``{<role_slug>: <patch>}``. Used when none
       of the scope keys (``organization``, ``workspace``, ``project``) appear
       at the root; the payload is interpreted as project-level role patches.
       The scope names are therefore reserved and cannot be used as role slugs.

    2. Full (scoped) form — ``{"project": {<role_slug>: <patch>}}``. Triggered
       when any of ``organization``, ``workspace``, ``project`` appears at the
       root. Only ``project`` is supported today; ``organization`` and
       ``workspace`` are rejected.

    The result is the inner ``{<role_slug>: <patch>}`` dict; the caller decides
    which scopes the patch applies to.
    """
    if not isinstance(decoded, dict) or not decoded:
        raise ValueError("AGENTA_ACCESS_ROLES_OVERLAY must be a non-empty JSON object")

    scope_keys = {"organization", "workspace", "project"}

    if scope_keys & set(decoded.keys()):
        # Full parse: at least one scope key at root.
        unsupported = (set(decoded.keys()) & scope_keys) - {"project"}
        if unsupported:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES_OVERLAY only supports the 'project' scope "
                f"today (got: {sorted(unsupported)}). The patch is applied to "
                "both workspace and project."
            )
        unknown = set(decoded.keys()) - scope_keys
        if unknown:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES_OVERLAY mixes scope keys with non-scope "
                f"keys at the root ({sorted(unknown)}). Either use the "
                "project-focused shortcut (no scope keys, role slugs at the "
                "root) or the full form ({'project': {...}})."
            )
        project_payload = decoded.get("project")
        if not isinstance(project_payload, dict) or not project_payload:
            raise ValueError(
                "AGENTA_ACCESS_ROLES_OVERLAY['project'] must be a non-empty "
                "JSON object keyed by role slug"
            )
    else:
        # Project-focused shortcut: top-level dict is keyed by role slug.
        project_payload = decoded

    reserved = {
        RequiredRole.OWNER.value,
        RequiredRole.ADMIN.value,
        RequiredRole.VIEWER.value,
    }
    entries: Dict[str, _RoleOverlayEntry] = {}
    for slug, patch in project_payload.items():
        if not slug or not isinstance(slug, str):
            raise ValueError(
                f"Invalid role slug '{slug}' in AGENTA_ACCESS_ROLES_OVERLAY"
            )
        if slug in reserved:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES_OVERLAY cannot patch reserved role "
                f"'{slug}'; minima are platform-managed"
            )
        try:
            entry = _RoleOverlayEntry.model_validate(patch)
        except ValidationError as e:
            raise ValueError(
                f"Invalid AGENTA_ACCESS_ROLES_OVERLAY['project']['{slug}']: {e}"
            ) from e
        if entry.permissions is not None:
            for perm in entry.permissions:
                _validate_permission(perm)
        entries[slug] = entry

    return entries


def _apply_roles_overlay(
    roles: Dict[str, List[Dict[str, Any]]],
    overlay: Dict[str, _RoleOverlayEntry],
) -> Dict[str, List[Dict[str, Any]]]:
    """Apply the parsed overlay to the workspace and project scopes.

    Returns a new dict; the input is not mutated. New roles (where the
    slug doesn't already exist on the scope) require both ``description``
    and ``permissions``.
    """
    result = {scope: [dict(entry) for entry in roles[scope]] for scope in roles}

    for scope_name in ("workspace", "project"):
        scope_entries = result[scope_name]
        by_slug = {entry["role"]: idx for idx, entry in enumerate(scope_entries)}

        for slug, patch in overlay.items():
            if slug in by_slug:
                # Patch existing role: per-field replace.
                idx = by_slug[slug]
                if patch.description is not None:
                    scope_entries[idx]["description"] = patch.description
                if patch.permissions is not None:
                    scope_entries[idx]["permissions"] = list(patch.permissions)
            else:
                # New role: both fields must be present.
                if patch.permissions is None:
                    raise ValueError(
                        f"AGENTA_ACCESS_ROLES_OVERLAY['project']['{slug}']: "
                        f"new role requires 'permissions' (scope '{scope_name}' "
                        "has no existing role with this slug to patch)"
                    )
                scope_entries.append(
                    {
                        "role": slug,
                        "description": patch.description,
                        "permissions": list(patch.permissions),
                    }
                )

    return result


# ---------------------------------------------------------------------------
# Entry point (called from OSS build_role_controls under is_ee())
# ---------------------------------------------------------------------------


def apply_role_overrides(
    default_roles: Dict[str, List[Dict[str, Any]]],
) -> tuple[Dict[str, List[Dict[str, Any]]], str]:
    """Apply EE env overrides on top of the OSS code-default role catalog.

    Returns ``(roles, source_label)``. With no env overrides set, returns the
    passed-in defaults unchanged.
    """
    roles_payload = env.agenta.access.roles
    roles_overlay_payload = env.agenta.access.roles_overlay

    if roles_payload is not None:
        roles = _parse_roles_override(roles_payload)
        roles_source = "env"
    else:
        roles = default_roles
        roles_source = "defaults"

    roles_overlay_source = "none"
    if roles_overlay_payload is not None:
        roles_overlay = _parse_roles_overlay(roles_overlay_payload)
        roles = _apply_roles_overlay(roles, roles_overlay)
        roles_overlay_source = "env"

    source = f"roles={roles_source} roles_overlay={roles_overlay_source}"
    return roles, source
