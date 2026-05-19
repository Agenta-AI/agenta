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
        # Workspace exposes the code-default WorkspaceRole enum set on top of the
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

    def test_organization_defaults_to_minima_only(self):
        # Organization scope has no permission concept today; it stays at the
        # minima while workspace and project expose the code-default WorkspaceRole set.
        assert {r["role"] for r in controls.get_roles("organization")} == {
            DefaultRole.OWNER.value,
            DefaultRole.VIEWER.value,
        }

    def test_project_default_mirrors_workspace_role_set(self):
        # project_members.role historically stores workspace-role slugs
        # (admin/developer/editor/annotator), so the project scope must
        # surface the same permission map for non-overridden deployments.
        assert {r["role"] for r in controls.get_roles("project")} == {
            r.value for r in WorkspaceRole
        }

    def test_owner_role_is_wildcard(self):
        assert controls.get_role_permissions("project", "owner") == ["*"]
        assert controls.get_role_permissions("organization", "owner") == ["*"]
        assert controls.get_role_permissions("workspace", "owner") == ["*"]

    def test_viewer_in_workspace_and_project_is_read_only(self):
        # Viewer permissions in workspace/project come from the code-default
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
                        "rbac": True,
                        "access": False,
                        "domains": False,
                        "sso": False,
                    },
                }
            }
        )
        assert list(plans.keys()) == ["plan_a"]
        assert plans["plan_a"][Tracker.FLAGS]["rbac"] is True
        assert descriptions["plan_a"] == "Test plan"

    def test_counters_and_gauges_validated(self):
        plans, _ = controls._parse_plans_override(
            {
                "p": {
                    "counters": {
                        "traces_ingested": {"limit": 100, "period": "monthly"}
                    },
                    "gauges": {"users": {"limit": 5, "strict": True}},
                }
            }
        )
        assert plans["p"][Tracker.COUNTERS]["traces_ingested"].limit == 100
        assert plans["p"][Tracker.GAUGES]["users"].strict is True

    def test_empty_dict_rejected(self):
        with pytest.raises(ValueError, match="non-empty"):
            controls._parse_plans_override({})

    def test_non_dict_rejected(self):
        with pytest.raises(ValueError, match="non-empty JSON object"):
            controls._parse_plans_override([])

    def test_plan_with_no_entitlements_allowed(self):
        # Display-only plans (e.g. custom/self-hosted) may carry no
        # entitlement trackers. The runtime returns an empty entitlement
        # map for those plans rather than treating them as unknown.
        plans, _ = controls._parse_plans_override({"empty_plan": {}})
        assert plans == {"empty_plan": {}}

    def test_plan_with_only_description_allowed(self):
        plans, descriptions = controls._parse_plans_override(
            {"p": {"description": "display only"}}
        )
        assert plans == {"p": {}}
        assert descriptions == {"p": "display only"}

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

    def test_project_override_is_mirrored_to_workspace_today(self):
        # TODAY: workspace and project roles must match at runtime because the
        # workspace role catalog is used by the Invite Members flow for project
        # membership. A project-only override therefore intentionally replaces
        # workspace extras too, instead of leaving workspace defaults intact.
        result = controls._parse_roles_override(
            {"project": [_custom_role("reviewer", ["read_system"])]}
        )
        proj_slugs = [r["role"] for r in result["project"]]
        ws_slugs = [r["role"] for r in result["workspace"]]
        org_slugs = [r["role"] for r in result["organization"]]

        # Project: minima + override (env overrides REPLACE default extras in
        # the overridden scope).
        assert proj_slugs == ["owner", "viewer", "reviewer"]
        assert ws_slugs == ["owner", "viewer", "reviewer"]
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


# ---------------------------------------------------------------------------
# Default-plan overlay parser + apply
# ---------------------------------------------------------------------------


from ee.src.core.entitlements.types import (  # noqa: E402
    Category,
    Counter,
    Flag,
    Gauge,
    Period,
    Quota,
    Retention,
    Throttle,
)


class TestDefaultPlanOverlayParse:
    def test_empty_payload_rejected(self):
        with pytest.raises(ValueError, match="non-empty"):
            controls._parse_default_plan_overlay({})

    def test_non_dict_rejected(self):
        with pytest.raises(ValueError, match="non-empty JSON object"):
            controls._parse_default_plan_overlay([])

    def test_unknown_flag_rejected(self):
        with pytest.raises(ValueError, match="Unknown flag"):
            controls._parse_default_plan_overlay({"flags": {"bogus": True}})

    def test_unknown_counter_rejected(self):
        with pytest.raises(ValueError, match="Unknown counter"):
            controls._parse_default_plan_overlay({"counters": {"bogus": {"limit": 1}}})

    def test_unknown_throttle_category_rejected(self):
        with pytest.raises(ValueError, match="not a valid throttle category"):
            controls._parse_default_plan_overlay(
                {"throttles": {"galaxy": {"bucket": {"rate": 1}}}}
            )

    def test_extra_field_rejected(self):
        with pytest.raises(
            ValueError, match="Invalid AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY"
        ):
            controls._parse_default_plan_overlay({"surprise": "x"})


class TestDefaultPlanOverlayApply:
    def _base_plan(self) -> dict:
        return {
            Tracker.FLAGS: {Flag.ACCESS: False},
            Tracker.COUNTERS: {
                Counter.TRACES_INGESTED: Quota(
                    free=5000, period=Period.MONTHLY, retention=Retention.MONTHLY
                )
            },
            Tracker.GAUGES: {Gauge.USERS: Quota(limit=2, free=2, strict=True)},
            Tracker.THROTTLES: [
                Throttle(
                    categories=[Category.STANDARD],
                    mode="include",
                    bucket={"capacity": 480, "rate": 480},
                ),
                Throttle(
                    categories=[Category.CORE_FAST, Category.TRACING_FAST],
                    mode="include",
                    bucket={"capacity": 1200, "rate": 1200},
                ),
            ],
        }

    def test_quota_field_merge_preserves_other_fields(self):
        plans = {"the_plan": self._base_plan()}
        descriptions: dict = {}
        overlay = controls._parse_default_plan_overlay(
            {"counters": {"traces_ingested": {"retention": 525600}}}
        )
        plans, _ = controls._apply_default_plan_overlay(
            plans, descriptions, overlay, "the_plan"
        )
        traces: Quota = plans["the_plan"][Tracker.COUNTERS][Counter.TRACES_INGESTED]
        # Only retention changed; the rest is untouched.
        assert traces.retention == Retention.YEARLY
        assert traces.free == 5000
        assert traces.period == Period.MONTHLY

    def test_throttle_category_patch_preserves_other_throttles(self):
        plans = {"the_plan": self._base_plan()}
        overlay = controls._parse_default_plan_overlay(
            {"throttles": {"standard": {"bucket": {"rate": 7200}}}}
        )
        plans, _ = controls._apply_default_plan_overlay(plans, {}, overlay, "the_plan")
        throttles = plans["the_plan"][Tracker.THROTTLES]
        # Standard throttle: rate patched, capacity preserved.
        standard = next(t for t in throttles if t.categories == [Category.STANDARD])
        assert standard.bucket.rate == 7200
        assert standard.bucket.capacity == 480
        # Multi-category throttle: untouched.
        multi = next(t for t in throttles if t.categories and len(t.categories) > 1)
        assert multi.bucket.rate == 1200

    def test_overlay_targeting_unknown_plan_fails(self):
        plans = {"the_plan": self._base_plan()}
        overlay = controls._parse_default_plan_overlay({"flags": {"access": True}})
        with pytest.raises(ValueError, match="not in the effective plan set"):
            controls._apply_default_plan_overlay(plans, {}, overlay, "ghost_plan")

    def test_overlay_targeting_throttle_with_no_match_fails(self):
        plans = {"the_plan": self._base_plan()}
        overlay = controls._parse_default_plan_overlay(
            {"throttles": {"ai_services": {"bucket": {"rate": 99}}}}
        )
        with pytest.raises(
            ValueError, match="no single-category throttle entry for 'ai_services'"
        ):
            controls._apply_default_plan_overlay(plans, {}, overlay, "the_plan")

    def test_description_replaces(self):
        plans = {"the_plan": self._base_plan()}
        overlay = controls._parse_default_plan_overlay(
            {"description": "Self-hosted override"}
        )
        _, descriptions = controls._apply_default_plan_overlay(
            plans, {}, overlay, "the_plan"
        )
        assert descriptions["the_plan"] == "Self-hosted override"

    def test_flag_patch_only_overwrites_named_keys(self):
        base = self._base_plan()
        base[Tracker.FLAGS] = {Flag.ACCESS: False, Flag.RBAC: True}
        plans = {"the_plan": base}
        overlay = controls._parse_default_plan_overlay({"flags": {"access": True}})
        plans, _ = controls._apply_default_plan_overlay(plans, {}, overlay, "the_plan")
        flags = plans["the_plan"][Tracker.FLAGS]
        assert flags[Flag.ACCESS] is True
        assert flags[Flag.RBAC] is True  # untouched


# ---------------------------------------------------------------------------
# Roles overlay parser + apply
# ---------------------------------------------------------------------------


class TestRolesOverlayParse:
    def test_empty_payload_rejected(self):
        with pytest.raises(ValueError, match="non-empty"):
            controls._parse_roles_overlay({})

    def test_non_dict_rejected(self):
        with pytest.raises(ValueError, match="non-empty JSON object"):
            controls._parse_roles_overlay([])

    def test_non_project_scope_rejected(self):
        with pytest.raises(ValueError, match="only supports the 'project' scope"):
            controls._parse_roles_overlay(
                {"workspace": {"editor": {"permissions": ["read_system"]}}}
            )

    def test_multiple_scopes_rejected_lists_offenders(self):
        with pytest.raises(ValueError, match="organization"):
            controls._parse_roles_overlay(
                {
                    "project": {"editor": {"permissions": ["read_system"]}},
                    "organization": {"foo": {"permissions": []}},
                }
            )

    def test_empty_project_block_rejected(self):
        with pytest.raises(ValueError, match="must be a non-empty"):
            controls._parse_roles_overlay({"project": {}})

    def test_reserved_role_patch_rejected(self):
        with pytest.raises(ValueError, match="cannot patch reserved role 'owner'"):
            controls._parse_roles_overlay(
                {"project": {"owner": {"permissions": ["read_system"]}}}
            )

    def test_reserved_viewer_patch_rejected(self):
        with pytest.raises(ValueError, match="cannot patch reserved role 'viewer'"):
            controls._parse_roles_overlay(
                {"project": {"viewer": {"permissions": ["read_system"]}}}
            )

    def test_unknown_permission_rejected(self):
        with pytest.raises(ValueError, match="Unknown permission"):
            controls._parse_roles_overlay(
                {"project": {"editor": {"permissions": ["bogus_perm"]}}}
            )

    def test_extra_field_rejected(self):
        with pytest.raises(ValueError, match="Invalid AGENTA_ACCESS_ROLES_OVERLAY"):
            controls._parse_roles_overlay({"project": {"editor": {"surprise": "yes"}}})

    def test_project_focused_shortcut_accepted(self):
        # Top-level keys are role slugs (no scope wrapper).
        overlay = controls._parse_roles_overlay(
            {"editor": {"permissions": ["read_system"]}}
        )
        assert set(overlay.keys()) == {"editor"}
        assert overlay["editor"].permissions == ["read_system"]

    def test_project_focused_shortcut_rejects_reserved_role(self):
        with pytest.raises(ValueError, match="cannot patch reserved role 'owner'"):
            controls._parse_roles_overlay({"owner": {"permissions": ["read_system"]}})

    def test_full_form_with_organization_scope_rejected(self):
        with pytest.raises(ValueError, match="only supports the 'project' scope"):
            controls._parse_roles_overlay(
                {"organization": {"editor": {"permissions": ["read_system"]}}}
            )

    def test_full_form_with_workspace_scope_rejected(self):
        with pytest.raises(ValueError, match="only supports the 'project' scope"):
            controls._parse_roles_overlay(
                {"workspace": {"editor": {"permissions": ["read_system"]}}}
            )

    def test_mixing_scope_and_role_keys_rejected(self):
        with pytest.raises(ValueError, match="mixes scope keys with non-scope"):
            controls._parse_roles_overlay(
                {
                    "project": {"editor": {"permissions": ["read_system"]}},
                    "auditor": {"permissions": ["read_system"]},
                }
            )


class TestRolesOverlayApply:
    def _base_roles(self) -> dict:
        # Mirror the code-default catalog (minima + default extras for
        # workspace and project; minima only for organization).
        return controls._default_roles()

    def test_patch_existing_role_replaces_permissions_in_both_scopes(self):
        roles = self._base_roles()
        overlay = controls._parse_roles_overlay(
            {"project": {"editor": {"permissions": ["read_system"]}}}
        )
        result = controls._apply_roles_overlay(roles, overlay)

        for scope in ("workspace", "project"):
            editor = next(r for r in result[scope] if r["role"] == "editor")
            assert editor["permissions"] == ["read_system"]

    def test_patch_existing_role_preserves_description_when_not_set(self):
        roles = self._base_roles()
        original_description = next(
            r for r in roles["project"] if r["role"] == "editor"
        )["description"]
        overlay = controls._parse_roles_overlay(
            {"project": {"editor": {"permissions": ["read_system"]}}}
        )
        result = controls._apply_roles_overlay(roles, overlay)

        for scope in ("workspace", "project"):
            editor = next(r for r in result[scope] if r["role"] == "editor")
            assert editor["description"] == original_description

    def test_patch_existing_role_preserves_permissions_when_not_set(self):
        roles = self._base_roles()
        original_perms = list(
            next(r for r in roles["project"] if r["role"] == "editor")["permissions"]
        )
        overlay = controls._parse_roles_overlay(
            {"project": {"editor": {"description": "Custom description"}}}
        )
        result = controls._apply_roles_overlay(roles, overlay)

        for scope in ("workspace", "project"):
            editor = next(r for r in result[scope] if r["role"] == "editor")
            assert editor["description"] == "Custom description"
            assert editor["permissions"] == original_perms

    def test_new_role_added_to_both_scopes(self):
        roles = self._base_roles()
        overlay = controls._parse_roles_overlay(
            {
                "project": {
                    "auditor": {
                        "description": "Audit-only.",
                        "permissions": ["read_system"],
                    }
                }
            }
        )
        result = controls._apply_roles_overlay(roles, overlay)

        for scope in ("workspace", "project"):
            slugs = [r["role"] for r in result[scope]]
            assert "auditor" in slugs

    def test_new_role_without_permissions_rejected(self):
        roles = self._base_roles()
        overlay = controls._parse_roles_overlay(
            {"project": {"auditor": {"description": "Only description"}}}
        )
        with pytest.raises(ValueError, match="new role requires 'permissions'"):
            controls._apply_roles_overlay(roles, overlay)

    def test_organization_scope_untouched(self):
        roles = self._base_roles()
        original_org_slugs = [r["role"] for r in roles["organization"]]
        overlay = controls._parse_roles_overlay(
            {
                "project": {
                    "auditor": {
                        "description": "Audit-only.",
                        "permissions": ["read_system"],
                    }
                }
            }
        )
        result = controls._apply_roles_overlay(roles, overlay)

        assert [r["role"] for r in result["organization"]] == original_org_slugs
