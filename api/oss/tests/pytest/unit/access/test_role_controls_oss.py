"""Role-controls unit tests for the code-default role catalog.

Custom roles (`AGENTA_ACCESS_ROLES` / `AGENTA_ACCESS_ROLES_OVERLAY`) are covered by the EE
`test_controls_env_override.py`: every image runs the EE code path.
"""

from oss.src.core.access import controls
from oss.src.core.access.permissions.types import DefaultRole, RequiredRole, Permission


# ---------------------------------------------------------------------------
# Default catalog (the catalog OSS enforces)
# ---------------------------------------------------------------------------


class TestOssDefaults:
    def test_minima_present_in_every_scope(self):
        for scope in ("organization", "workspace", "project"):
            slugs = {r["role"] for r in controls.get_roles(scope)}
            assert RequiredRole.OWNER.value in slugs
            assert RequiredRole.ADMIN.value in slugs
            assert RequiredRole.VIEWER.value in slugs

    def test_project_exposes_full_default_role_set(self):
        assert {r["role"] for r in controls.get_roles("project")} == {
            r.value for r in DefaultRole
        }

    def test_owner_role_is_wildcard(self):
        assert controls.get_role_permissions("project", "owner") == ["*"]

    def test_viewer_is_read_only_in_project(self):
        valid = {p.value for p in Permission}
        perms = controls.get_role_permissions("project", "viewer")
        assert perms
        assert "*" not in perms
        assert set(perms).issubset(valid)

    def test_unknown_scope_returns_empty(self):
        assert controls.get_roles("garbage") == []
