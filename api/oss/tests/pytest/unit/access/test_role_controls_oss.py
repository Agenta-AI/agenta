"""OSS role-controls unit tests.

RBAC enforcement is an OSS feature and always enforces the code-default role
catalog. Custom roles (`AGENTA_ACCESS_ROLES` / `AGENTA_ACCESS_ROLES_OVERLAY`) are
an EE feature: in OSS those env vars are IGNORED.

The role catalog is built once at import time, so the env-override scenarios run
in fresh `AGENTA_LICENSE=oss` subprocesses (mirrors the EE
`test_controls_env_override.py` harness).
"""

import json
import os
import subprocess
import sys

from oss.src.core.access import controls
from oss.src.core.access.permissions.types import DefaultRole, RequiredRole, Permission


def _run_oss(env_extra: dict, snippet: str) -> tuple[int, str, str]:
    env = dict(os.environ)
    env.update(env_extra)
    env["AGENTA_LICENSE"] = "oss"
    env.setdefault("AGENTA_LOG_CONSOLE_ENABLED", "false")
    proc = subprocess.run(
        [sys.executable, "-c", snippet],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _ok(snippet: str, env_extra: dict | None = None) -> str:
    ec, out, err = _run_oss(env_extra or {}, snippet)
    assert ec == 0, f"expected success, got {ec}\nstdout: {out}\nstderr: {err}"
    return out


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


# ---------------------------------------------------------------------------
# Custom roles are EE-only: OSS ignores the override env vars
# ---------------------------------------------------------------------------


class TestOssIgnoresCustomRoleEnv:
    def test_roles_override_is_ignored_in_oss(self):
        # A custom `reviewer` role set via AGENTA_ACCESS_ROLES must NOT appear
        # in OSS — OSS enforces the code-default catalog only.
        out = _ok(
            "from oss.src.core.access.controls import get_roles; "
            "print(','.join(r['role'] for r in get_roles('project')))",
            env_extra={
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "reviewer", "permissions": ["read_system"]}]}
                )
            },
        )
        slugs = out.strip().split(",")
        assert "reviewer" not in slugs
        assert set(slugs) == {r.value for r in DefaultRole}

    def test_roles_overlay_is_ignored_in_oss(self):
        # An overlay patching `editor` permissions must NOT take effect in OSS.
        out = _ok(
            "from oss.src.core.access.controls import get_role_permissions; "
            "print(get_role_permissions('project', 'editor'))",
            env_extra={
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {"project": {"editor": {"permissions": ["read_system"]}}}
                )
            },
        )
        # The default editor permission set is larger than the single patched
        # permission, proving the overlay was ignored.
        assert out.strip() != "['read_system']"

    def test_invalid_roles_override_does_not_break_oss_startup(self):
        # In EE an invalid AGENTA_ACCESS_ROLES fails startup; in OSS the var is
        # never parsed, so even a malformed value is harmless.
        out = _ok(
            "from oss.src.core.access.controls import get_roles; "
            "print(len(get_roles('project')))",
            env_extra={
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "owner", "permissions": ["*"]}]}
                )
            },
        )
        assert int(out.strip()) == len(list(DefaultRole))
