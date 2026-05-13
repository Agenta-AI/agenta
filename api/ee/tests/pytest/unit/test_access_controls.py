"""Unit tests for the access-controls parsers in
``ee.src.core.entitlements.controls``.

These exercise the pure parser functions (`_parse_plans_override`,
`_parse_roles_override`) so we don't have to manipulate process env vars at
test time — the parsers take already-decoded payloads.

The module-level accessors (`get_plans`, `get_roles`, etc.) are also covered
in the no-env-override case, which exercises the code-default builders.
"""

import pytest

from ee.src.core.entitlements import controls
from ee.src.core.entitlements.types import DefaultPlan, DefaultRole, Tracker
from ee.src.models.shared_models import Permission, WorkspaceRole


# ---------------------------------------------------------------------------
# Defaults (no env override)
# ---------------------------------------------------------------------------


class TestDefaults:
    def test_get_plans_returns_all_default_plans(self):
        plans = controls.get_plans()
        assert set(plans.keys()) == {p.value for p in DefaultPlan}

    def test_get_plan_entitlements_returns_none_for_unknown_slug(self):
        assert controls.get_plan_entitlements("nope") is None

    def test_get_plan_entitlements_returns_none_for_empty_slug(self):
        assert controls.get_plan_entitlements(None) is None
        assert controls.get_plan_entitlements("") is None

    def test_get_roles_returns_workspace_role_set(self):
        ws = controls.get_roles("workspace")
        slugs = {r["role"] for r in ws}
        # Workspace exposes the legacy WorkspaceRole enum set on top of the
        # owner/viewer minima.
        assert slugs == {r.value for r in WorkspaceRole}

    def test_get_roles_returns_empty_for_unknown_scope(self):
        assert controls.get_roles("garbage") == []

    def test_minima_present_in_every_scope(self):
        # Every scope must always expose `owner` and `viewer`.
        for scope in ("organization", "workspace", "project"):
            slugs = {r["role"] for r in controls.get_roles(scope)}
            assert DefaultRole.OWNER.value in slugs
            assert DefaultRole.VIEWER.value in slugs

    def test_organization_and_project_default_to_minima_only(self):
        # Today only workspace exposes extra roles by default.
        assert {r["role"] for r in controls.get_roles("organization")} == {
            DefaultRole.OWNER.value,
            DefaultRole.VIEWER.value,
        }
        assert {r["role"] for r in controls.get_roles("project")} == {
            DefaultRole.OWNER.value,
            DefaultRole.VIEWER.value,
        }

    def test_owner_role_is_wildcard(self):
        assert controls.get_role_permissions("project", "owner") == ["*"]
        assert controls.get_role_permissions("organization", "owner") == ["*"]
        assert controls.get_role_permissions("workspace", "owner") == ["*"]

    def test_viewer_in_workspace_and_project_is_read_only(self):
        # Viewer permissions in workspace/project come from the legacy
        # `WorkspaceRole.VIEWER` set — every entry is a real Permission.
        valid = {p.value for p in Permission}
        for scope in ("workspace", "project"):
            perms = controls.get_role_permissions(scope, "viewer")
            assert perms, f"{scope} viewer must have non-empty permissions"
            assert "*" not in perms
            assert set(perms).issubset(valid)

    def test_viewer_in_organization_has_no_permissions(self):
        # Org-scope viewer is a membership marker — no permissions today.
        assert controls.get_role_permissions("organization", "viewer") == []

    def test_get_role_description_falls_back_to_none_for_unknown_role(self):
        assert controls.get_role_description("workspace", "ghost") is None

    def test_controls_hash_is_stable(self):
        assert controls.get_controls_hash() == controls.get_controls_hash()


# ---------------------------------------------------------------------------
# Plan override parser
# ---------------------------------------------------------------------------


class TestParsePlansOverride:
    def test_minimal_valid_override_with_flags(self):
        plans, descriptions = controls._parse_plans_override(
            {
                "plan_a": {
                    "description": "Test plan",
                    "flags": {
                        "hooks": True,
                        "rbac": False,
                        "access": False,
                        "domains": False,
                        "sso": False,
                    },
                }
            }
        )
        assert list(plans.keys()) == ["plan_a"]
        assert plans["plan_a"][Tracker.FLAGS]["hooks"] is True
        assert descriptions["plan_a"] == "Test plan"

    def test_counters_and_gauges_validated(self):
        plans, _ = controls._parse_plans_override(
            {
                "p": {
                    "counters": {"traces": {"limit": 100, "monthly": True}},
                    "gauges": {"users": {"limit": 5, "strict": True}},
                }
            }
        )
        assert plans["p"][Tracker.COUNTERS]["traces"].limit == 100
        assert plans["p"][Tracker.GAUGES]["users"].strict is True

    def test_empty_dict_rejected(self):
        with pytest.raises(ValueError, match="non-empty"):
            controls._parse_plans_override({})

    def test_non_dict_rejected(self):
        with pytest.raises(ValueError, match="non-empty JSON object"):
            controls._parse_plans_override([])

    def test_plan_with_no_entitlements_rejected(self):
        with pytest.raises(ValueError, match="at least one of"):
            controls._parse_plans_override({"empty_plan": {}})

    def test_plan_with_only_description_rejected(self):
        with pytest.raises(ValueError, match="at least one of"):
            controls._parse_plans_override({"p": {"description": "x"}})

    def test_unknown_flag_key_rejected(self):
        with pytest.raises(ValueError, match="Unknown flag"):
            controls._parse_plans_override({"p": {"flags": {"bogus": True}}})

    def test_unknown_counter_key_rejected(self):
        with pytest.raises(ValueError, match="Unknown counter"):
            controls._parse_plans_override({"p": {"counters": {"bogus": {"limit": 1}}}})

    def test_unknown_gauge_key_rejected(self):
        with pytest.raises(ValueError, match="Unknown gauge"):
            controls._parse_plans_override({"p": {"gauges": {"bogus": {"limit": 1}}}})

    def test_extra_field_in_plan_rejected(self):
        with pytest.raises(ValueError, match="Invalid plan override"):
            controls._parse_plans_override({"p": {"surprise": "yes"}})


# ---------------------------------------------------------------------------
# Role override parser
# ---------------------------------------------------------------------------


def _custom_role(role: str, permissions: list[str]) -> dict:
    return {"role": role, "permissions": permissions}


class TestParseRolesOverride:
    """Override semantics: minima (`owner`, `viewer`) are platform-controlled
    and synthesized for every scope. Env can only add roles to a scope, never
    redefine or remove the minima.
    """

    def test_override_only_specified_scope_keeps_other_defaults(self):
        # Overriding `project` only; workspace stays at the full code default.
        result = controls._parse_roles_override(
            {"project": [_custom_role("reviewer", ["read_system"])]}
        )
        proj_slugs = [r["role"] for r in result["project"]]
        ws_slugs = [r["role"] for r in result["workspace"]]
        org_slugs = [r["role"] for r in result["organization"]]

        # Project: minima + override.
        assert proj_slugs == ["owner", "viewer", "reviewer"]
        # Workspace: untouched code default (minima + legacy WorkspaceRole extras).
        assert ws_slugs[:2] == ["owner", "viewer"]
        assert "admin" in ws_slugs
        # Organization: untouched (minima-only by default).
        assert org_slugs == ["owner", "viewer"]

    def test_empty_dict_rejected(self):
        with pytest.raises(ValueError, match="non-empty"):
            controls._parse_roles_override({})

    def test_unknown_scope_rejected(self):
        with pytest.raises(ValueError, match="Unknown role scope"):
            controls._parse_roles_override(
                {"galaxy": [_custom_role("ranger", ["read_system"])]}
            )

    def test_empty_scope_list_rejected(self):
        with pytest.raises(ValueError, match="non-empty list of roles"):
            controls._parse_roles_override({"project": []})

    def test_owner_reserved_cannot_be_redefined(self):
        with pytest.raises(ValueError, match="cannot redefine reserved role 'owner'"):
            controls._parse_roles_override({"project": [_custom_role("owner", ["*"])]})

    def test_viewer_reserved_cannot_be_redefined(self):
        with pytest.raises(ValueError, match="cannot redefine reserved role 'viewer'"):
            controls._parse_roles_override(
                {"project": [_custom_role("viewer", ["read_system"])]}
            )

    def test_duplicate_custom_role_slug_rejected(self):
        with pytest.raises(ValueError, match="Duplicate role slug"):
            controls._parse_roles_override(
                {
                    "project": [
                        _custom_role("reviewer", ["read_system"]),
                        _custom_role("reviewer", ["read_system"]),
                    ]
                }
            )

    def test_empty_role_slug_rejected(self):
        with pytest.raises(ValueError, match="Empty role slug|Invalid role override"):
            controls._parse_roles_override(
                {"project": [{"role": "", "permissions": []}]}
            )

    def test_unknown_permission_rejected(self):
        with pytest.raises(ValueError, match="Unknown permission"):
            controls._parse_roles_override(
                {"project": [_custom_role("custom", ["totally_made_up_perm"])]}
            )

    def test_known_permission_accepted(self):
        valid_perm = next(iter(Permission)).value
        result = controls._parse_roles_override(
            {"project": [_custom_role("custom", [valid_perm])]}
        )
        # Last entry is the custom role; first two are the minima.
        assert result["project"][-1]["role"] == "custom"
        assert result["project"][-1]["permissions"] == [valid_perm]

    def test_minima_always_present_after_override(self):
        result = controls._parse_roles_override(
            {"organization": [_custom_role("auditor", ["read_system"])]}
        )
        slugs = [r["role"] for r in result["organization"]]
        # Minima are always re-applied at the front of each scope.
        assert slugs[0] == "owner"
        assert slugs[1] == "viewer"
        assert "auditor" in slugs
