"""Role/permission controls: pure builders for the code-default catalog.

Builds the per-scope role catalogs (organization, workspace, project) and their
role->permission mappings from code defaults.

This module holds no module-level state and no public accessors. The shared
singleton + `get_role*` accessors live in `oss.src.core.access.controls`, which
calls `build_role_controls()` once at import time.

Custom roles are an EE feature: `AGENTA_ACCESS_ROLES` /
`AGENTA_ACCESS_ROLES_OVERLAY` env overrides are parsed and applied in
`ee.src.core.access.permissions.role_overrides`, invoked from
`build_role_controls()` via a function-local `is_ee()`-guarded import. OSS always
enforces the code-default catalog.

Minima contract: every scope MUST expose `owner`, `admin`, and `viewer` with
code-defined permissions. EE env overrides may add roles or customize permissions
of non-minima roles, but the minima are always present and their slugs cannot be
re-bound to a different permission set.
"""

from typing import Any, Dict, List

from oss.src.utils.common import is_ee

from oss.src.core.access.permissions.types import (
    Permission,
    DefaultRole,
    RequiredRole,
)


# Access-control scope constants. Shared with the EE entitlements catalog, which
# keeps its own identical copy; defining them here keeps OSS free of `ee.*` deps.
OWNER_PERMISSIONS: list[str] = ["*"]
SCOPES: tuple[str, ...] = ("organization", "workspace", "project")


# ---------------------------------------------------------------------------
# Role catalogs (scoped)
# ---------------------------------------------------------------------------


def _read_only_permissions() -> List[str]:
    """Read-only permission set sourced from the code-default `DefaultRole.VIEWER`.

    Used as the `viewer` minima permissions for the `workspace` and `project`
    scopes where permissions are actually enforced. Organization-scope `viewer`
    has no permissions (it's just a membership marker today).
    """
    return [p.value for p in Permission.default_permissions(DefaultRole.VIEWER)]


def _viewer_permissions_for_scope(scope: str) -> List[str]:
    """Per-scope code-default permissions for the `viewer` minima role.

    - `organization`: empty — orgs have no permission concept today.
    - `workspace` and `project`: the code-default `DefaultRole.VIEWER` read-only set.
    """
    if scope == "organization":
        return []
    return _read_only_permissions()


def _admin_permissions_for_scope(scope: str) -> List[str]:
    """Per-scope code-default permissions for the `admin` minima role.

    - `organization`: empty — orgs have no permission concept today.
    - `workspace` and `project`: the code-default `DefaultRole.ADMIN` set.
    """
    if scope == "organization":
        return []
    return [p.value for p in Permission.default_permissions(DefaultRole.ADMIN)]


def _minima_for(scope: str) -> List[Dict[str, Any]]:
    """Return the required role entries for a scope (owner + admin + viewer).

    Application code relies on these slugs being present in every scope; the
    builder synthesizes them up front and re-applies them after any env
    overrides so they can never be dropped or relabeled.

    `owner` is always wildcard. The permission sets for `admin` and `viewer`
    vary per scope (see `_admin_permissions_for_scope` /
    `_viewer_permissions_for_scope`): both are empty at organization scope
    (orgs have no permission concept today) and code-default elsewhere.
    """
    return [
        {
            "role": RequiredRole.OWNER.value,
            "description": "Full access (wildcard permissions).",
            "permissions": list(OWNER_PERMISSIONS),
        },
        {
            "role": RequiredRole.ADMIN.value,
            "description": (
                "Membership marker (no permissions)."
                if scope == "organization"
                else DefaultRole.get_description(DefaultRole.ADMIN)
            ),
            "permissions": _admin_permissions_for_scope(scope),
        },
        {
            "role": RequiredRole.VIEWER.value,
            "description": (
                "Membership marker (no permissions)."
                if scope == "organization"
                else DefaultRole.get_description(DefaultRole.VIEWER)
            ),
            "permissions": _viewer_permissions_for_scope(scope),
        },
    ]


def _default_roles() -> Dict[str, List[Dict[str, Any]]]:
    """Return the code-default role catalog for each scope.

    Workspace and project scopes expose the code-default `DefaultRole`
    entries on top of the minima — project membership stores the same role
    slugs (`admin`/`developer`/`editor`/`annotator`), and the runtime
    permission check resolves them through this map. Organization scope
    only gets the minima today; new roles can be added per-scope via
    `AGENTA_ACCESS_ROLES` in EE.
    """
    default_extras: List[Dict[str, Any]] = []
    minima_slugs = {
        RequiredRole.OWNER.value,
        RequiredRole.ADMIN.value,
        RequiredRole.VIEWER.value,
    }
    for role in DefaultRole:
        if role.value in minima_slugs:
            continue
        default_extras.append(
            {
                "role": role.value,
                "description": DefaultRole.get_description(role),
                "permissions": [p.value for p in Permission.default_permissions(role)],
            }
        )

    return {
        "organization": _minima_for("organization"),
        "workspace": _minima_for("workspace") + default_extras,
        "project": _minima_for("project") + default_extras,
    }


# ---------------------------------------------------------------------------
# Build (called once by oss.src.core.access.controls)
# ---------------------------------------------------------------------------


def build_role_controls() -> tuple[Dict[str, List[Dict[str, Any]]], str]:
    """Build the per-scope role catalogs.

    OSS enforces the code-default catalog. In EE, `AGENTA_ACCESS_ROLES` /
    `AGENTA_ACCESS_ROLES_OVERLAY` overrides are applied on top via a
    function-local import of the EE override module (the sanctioned OSS→EE
    optional-coupling pattern; a module-top `from ee...` would break OSS-only
    deployments where the `ee` package is absent).

    Returns ``(roles, source_label)`` where ``source_label`` is a short string
    for startup logging (e.g. ``"roles=defaults roles_overlay=none"``).
    """
    roles = _default_roles()

    if is_ee():
        from ee.src.core.access.permissions.role_overrides import (  # noqa: PLC0415
            apply_role_overrides,
        )

        return apply_role_overrides(roles)

    return roles, "roles=defaults roles_overlay=none"
