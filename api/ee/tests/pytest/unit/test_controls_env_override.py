"""Integration-style tests for env-driven access-controls overrides.

`controls.py` and `settings.py` parse env at import time, so each scenario
runs in a fresh Python subprocess. Tests cover the consistency rules between
`AGENTA_ACCESS_PLANS`, `AGENTA_BILLING_CATALOG`, and `AGENTA_BILLING_PRICING`,
plus the free-plan derivation and trial-plan accessors.
"""

import json
import os
import subprocess
import sys


def _run(env_extra: dict, snippet: str) -> tuple[int, str, str]:
    """Run a Python snippet in a subprocess with extra env vars.

    Returns (exit_code, stdout, stderr). Console logging is silenced in the
    subprocess so stdout contains only what the snippet prints.
    """
    env = dict(os.environ)
    env.update(env_extra)
    env["AGENTA_LICENSE"] = "ee"
    env.setdefault("AGENTA_LOG_CONSOLE_ENABLED", "false")
    proc = subprocess.run(
        [sys.executable, "-c", snippet],
        env=env,
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _ok(snippet: str, env_extra: dict | None = None) -> str:
    ec, out, err = _run(env_extra or {}, snippet)
    assert ec == 0, f"expected success, got {ec}\nstdout: {out}\nstderr: {err}"
    return out


def _fails(snippet: str, env_extra: dict, expected_msg_substr: str) -> str:
    ec, out, err = _run(env_extra, snippet)
    assert ec != 0, f"expected failure, got success\nstdout: {out}"
    assert expected_msg_substr in err, (
        f"expected error containing {expected_msg_substr!r}, got:\n{err}"
    )
    return err


# ---------------------------------------------------------------------------
# Defaults path
# ---------------------------------------------------------------------------


class TestNoOverride:
    def test_no_env_uses_defaults(self):
        # Plans count should equal DefaultPlan enum size; catalog count
        # should match (one entry per plan in DEFAULT_CATALOG plus the
        # Enterprise contact-sales tier which has no `plan` field).
        from ee.src.core.entitlements.types import DEFAULT_CATALOG, DefaultPlan

        expected_plans = len(list(DefaultPlan))
        expected_catalog = len(DEFAULT_CATALOG)
        out = _ok(
            "from ee.src.core.entitlements.controls import get_plans; "
            "from ee.src.core.subscriptions.settings import get_catalog; "
            "print(len(get_plans())); print(len(get_catalog()))"
        )
        assert out.splitlines() == [str(expected_plans), str(expected_catalog)]

    def test_billing_pricing_accepts_legacy_agenta_pricing_alias(self):
        # The legacy alias is only consulted when the canonical var is unset.
        # Clear it explicitly so an `AGENTA_BILLING_PRICING` inherited from the
        # parent env (e.g. a loaded .env.ee.dev) doesn't take precedence.
        out = _ok(
            "from oss.src.utils.env import env; "
            "print(env.agenta.billing.pricing['cloud_v0_pro']['base']['price'])",
            {
                "AGENTA_BILLING_PRICING": "",
                "AGENTA_PRICING": json.dumps(
                    {"cloud_v0_pro": {"base": {"price": "price_agenta"}}}
                ),
            },
        )
        assert out.strip() == "price_agenta"

    def test_billing_pricing_accepts_legacy_stripe_pricing_alias(self):
        # See note above: clear higher-priority sources so STRIPE_PRICING wins.
        out = _ok(
            "from oss.src.utils.env import env; "
            "print(env.agenta.billing.pricing['cloud_v0_pro']['base']['price'])",
            {
                "AGENTA_BILLING_PRICING": "",
                "AGENTA_PRICING": "",
                "STRIPE_PRICING": json.dumps(
                    {"cloud_v0_pro": {"base": {"price": "price_stripe"}}}
                ),
            },
        )
        assert out.strip() == "price_stripe"

    def test_billing_pricing_prefers_canonical_env_over_legacy_aliases(self):
        out = _ok(
            "from oss.src.utils.env import env; "
            "print(env.agenta.billing.pricing['cloud_v0_pro']['base']['price'])",
            {
                "AGENTA_BILLING_PRICING": json.dumps(
                    {"cloud_v0_pro": {"base": {"price": "price_billing"}}}
                ),
                "AGENTA_PRICING": json.dumps(
                    {"cloud_v0_pro": {"base": {"price": "price_agenta"}}}
                ),
                "STRIPE_PRICING": json.dumps(
                    {"cloud_v0_pro": {"base": {"price": "price_stripe"}}}
                ),
            },
        )
        assert out.strip() == "price_billing"


# ---------------------------------------------------------------------------
# Plans override
# ---------------------------------------------------------------------------


class TestPlansOverride:
    _CONSISTENT_OVERRIDE = {
        "AGENTA_ACCESS_PLANS": json.dumps(
            {
                "only_plan": {
                    "description": "Test",
                    "flags": {
                        "rbac": False,
                        "access": False,
                        "domains": False,
                        "sso": False,
                    },
                }
            }
        ),
        "AGENTA_BILLING_CATALOG": json.dumps(
            [
                {
                    "title": "Only",
                    "description": "Only plan",
                    "plan": "only_plan",
                    "type": "standard",
                    "features": [],
                }
            ]
        ),
        "AGENTA_BILLING_PRICING": json.dumps(
            {"only_plan": {"free": True, "trial": 14}}
        ),
    }

    def test_consistent_override_works_end_to_end(self):
        out = _ok(
            "from ee.src.core.entitlements.controls import get_plans, get_plan_description; "
            "from ee.src.core.subscriptions.settings import get_catalog, get_free_plan; "
            "print(','.join(sorted(get_plans()))); "
            "print(get_plan_description('only_plan')); "
            "print(len(get_catalog())); "
            "print(get_free_plan())",
            env_extra=self._CONSISTENT_OVERRIDE,
        )
        lines = out.splitlines()
        assert lines[0] == "only_plan"
        assert lines[1] == "Test"
        assert lines[2] == "1"
        assert lines[3] == "only_plan"

    def test_invalid_json_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_plans",
            {"AGENTA_ACCESS_PLANS": "{not json"},
            "AGENTA_ACCESS_PLANS is not valid JSON",
        )

    def test_wrong_top_level_type_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_plans",
            {"AGENTA_ACCESS_PLANS": "[1,2,3]"},
            "must be a JSON object",
        )

    def test_empty_object_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_plans",
            {"AGENTA_ACCESS_PLANS": "{}"},
            "non-empty",
        )

    def test_plan_with_only_description_allowed(self):
        # Display-only plans (no enforced trackers) are accepted. They show
        # up in the effective plan map with an empty entitlements dict.
        out = _ok(
            "from ee.src.core.entitlements.controls import get_plans, get_plan_entitlements; "
            "print(sorted(get_plans())); print(get_plan_entitlements('x'))",
            env_extra={"AGENTA_ACCESS_PLANS": '{"x":{"description":"y"}}'},
        )
        lines = out.splitlines()
        assert lines[0] == "['x']"
        assert lines[1] == "{}"


# ---------------------------------------------------------------------------
# Catalog consistency vs plans
# ---------------------------------------------------------------------------


class TestCatalogConsistency:
    def test_catalog_referencing_missing_plan_fails(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_catalog",
            {
                "AGENTA_ACCESS_PLANS": json.dumps(
                    {
                        "only": {
                            "flags": {
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [
                        {
                            "plan": "nonexistent",
                            "title": "X",
                            "description": "x",
                            "type": "standard",
                            "features": [],
                        }
                    ]
                ),
            },
            "AGENTA_BILLING_CATALOG references plan 'nonexistent'",
        )

    def test_default_catalog_with_restricted_plans_fails(self):
        # Plans override removes built-in slugs but the default catalog still
        # references them — must fail loudly, not silently use defaults.
        _fails(
            "from ee.src.core.subscriptions.settings import get_catalog",
            {
                "AGENTA_ACCESS_PLANS": json.dumps(
                    {
                        "only": {
                            "flags": {
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                )
            },
            "AGENTA_BILLING_CATALOG references plan",
        )


# ---------------------------------------------------------------------------
# Pricing consistency vs plans
# ---------------------------------------------------------------------------


class TestPricingConsistency:
    def test_pricing_referencing_missing_plan_fails(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_pricing",
            {
                "AGENTA_ACCESS_PLANS": json.dumps(
                    {
                        "only": {
                            "flags": {
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [
                        {
                            "plan": "only",
                            "title": "Only",
                            "description": "Only plan",
                            "type": "standard",
                            "features": [],
                        }
                    ]
                ),
                "AGENTA_BILLING_PRICING": json.dumps({"missing": {"free": True}}),
            },
            "AGENTA_BILLING_PRICING references plan",
        )

    def test_pricing_free_marker_drives_get_free_plan(self):
        out = _ok(
            "from ee.src.core.subscriptions.settings import get_free_plan; "
            "print(get_free_plan())",
            env_extra={
                "AGENTA_ACCESS_PLANS": json.dumps(
                    {
                        "only": {
                            "flags": {
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [
                        {
                            "plan": "only",
                            "title": "Only",
                            "description": "Only plan",
                            "type": "standard",
                            "features": [],
                        }
                    ]
                ),
                "AGENTA_BILLING_PRICING": json.dumps(
                    {"only": {"free": True, "trial": 14}}
                ),
            },
        )
        assert out.strip() == "only"

    def test_multiple_free_plans_fails(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_pricing",
            {
                "AGENTA_ACCESS_PLANS": json.dumps(
                    {
                        "a": {
                            "flags": {
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        },
                        "b": {
                            "flags": {
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        },
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [
                        {
                            "plan": "a",
                            "title": "A",
                            "description": "a",
                            "type": "standard",
                            "features": [],
                        },
                        {
                            "plan": "b",
                            "title": "B",
                            "description": "b",
                            "type": "standard",
                            "features": [],
                        },
                    ]
                ),
                "AGENTA_BILLING_PRICING": json.dumps(
                    {"a": {"free": True}, "b": {"free": True}}
                ),
            },
            "multiple free plans",
        )


# ---------------------------------------------------------------------------
# Trial — declared per-entry inside AGENTA_BILLING_PRICING as `{"trial": N}`
# ---------------------------------------------------------------------------
#
# The previous design used two separate env vars (`AGENTA_BILLING_TRIAL_PLAN`
# and `AGENTA_BILLING_TRIAL_DAYS`); they were collapsed into a per-pricing-
# entry `trial: N` marker so the trial plan and its duration live as one
# atomic unit on a single plan slug. These tests exercise the new shape.


class TestTrialPricingEntry:
    def test_trial_entry_enables_trial(self):
        pricing = json.dumps(
            {
                "cloud_v0_business": {
                    "trial": 30,
                    "base": {"price": "p_business", "quantity": 1},
                },
                "cloud_v0_hobby": {"free": True},
            }
        )
        out = _ok(
            "from ee.src.core.subscriptions.settings import "
            "get_trial_plan, get_trial_days, trial_enabled; "
            "print(get_trial_plan()); print(get_trial_days()); print(trial_enabled())",
            env_extra={"AGENTA_BILLING_PRICING": pricing},
        )
        assert out.splitlines() == ["cloud_v0_business", "30", "True"]

    def test_no_trial_entry_falls_back_to_pro_trial_when_stripe_enabled(self):
        out = _ok(
            "from ee.src.core.subscriptions.settings import "
            "get_trial_plan, get_trial_days, trial_enabled; "
            "print(get_trial_plan()); print(get_trial_days()); print(trial_enabled())",
            env_extra={"STRIPE_API_KEY": "sk_test_dummy"},
        )
        assert out.splitlines() == ["cloud_v0_pro", "14", "True"]

    def test_no_trial_entry_stays_disabled_when_stripe_disabled(self):
        out = _ok(
            "from ee.src.core.subscriptions.settings import "
            "get_trial_plan, get_trial_days, trial_enabled; "
            "print(get_trial_plan()); print(get_trial_days()); print(trial_enabled())",
            env_extra={
                "STRIPE_API_KEY": "",
                "AGENTA_ACCESS_PLANS": json.dumps(
                    {
                        "only_plan": {
                            "flags": {
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [
                        {
                            "plan": "only_plan",
                            "title": "Only",
                            "description": "Only plan",
                            "type": "standard",
                            "features": [],
                        }
                    ]
                ),
                "AGENTA_BILLING_PRICING": json.dumps({"only_plan": {"free": True}}),
            },
        )
        assert out.splitlines() == ["None", "None", "False"]

    def test_trial_plan_not_in_effective_plans_fails(self):
        # Note: the higher-level pricing cross-reference guard fires first
        # ("AGENTA_BILLING_PRICING references plan 'bogus_plan' not in
        # effective plans"); we don't reach the trial-specific guard at the
        # bottom of `_build_settings`. Either error confirms the
        # invariant.
        pricing = json.dumps({"bogus_plan": {"trial": 14, "base": {"price": "p_x"}}})
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_plan",
            {"AGENTA_BILLING_PRICING": pricing},
            "not in effective plans",
        )

    def test_trial_days_non_positive_fails(self):
        pricing = json.dumps({"cloud_v0_pro": {"trial": 0, "base": {"price": "p_pro"}}})
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_days",
            {"AGENTA_BILLING_PRICING": pricing},
            "trial must be a positive integer",
        )

    def test_trial_days_string_fails(self):
        pricing = json.dumps(
            {"cloud_v0_pro": {"trial": "ninety", "base": {"price": "p_pro"}}}
        )
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_plan",
            {"AGENTA_BILLING_PRICING": pricing},
            "trial must be a positive integer",
        )

    def test_multiple_trial_entries_rejected(self):
        pricing = json.dumps(
            {
                "cloud_v0_pro": {"trial": 30, "base": {"price": "p1"}},
                "cloud_v0_business": {"trial": 90, "base": {"price": "p2"}},
            }
        )
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_plan",
            {"AGENTA_BILLING_PRICING": pricing},
            "multiple trial plans",
        )


# ---------------------------------------------------------------------------
# Roles env override
# ---------------------------------------------------------------------------


class TestRolesOverride:
    """End-to-end env override; the minima (`owner` + `viewer`) are synthesized
    by the platform and the env can only ADD custom roles, never redefine
    them.
    """

    def test_custom_role_with_known_permission_appended_to_minima(self):
        out = _ok(
            "from ee.src.core.entitlements.controls import get_roles, get_role_permissions; "
            "print(','.join(r['role'] for r in get_roles('project'))); "
            "print(','.join(get_role_permissions('project','reviewer')))",
            env_extra={
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "reviewer", "permissions": ["read_system"]}]}
                )
            },
        )
        lines = out.splitlines()
        # owner + viewer minima first, custom role last.
        assert lines[0] == "owner,viewer,reviewer"
        assert lines[1] == "read_system"

    def test_project_override_is_mirrored_to_workspace_today(self):
        # TODAY: workspace and project roles must match at runtime because the
        # workspace role catalog is used by the Invite Members flow for project
        # membership. A project-only override therefore intentionally replaces
        # workspace extras too, instead of leaving workspace defaults intact.
        out = _ok(
            "from ee.src.core.entitlements.controls import get_roles; "
            "print(','.join(r['role'] for r in get_roles('workspace')))",
            env_extra={
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "reviewer", "permissions": ["read_system"]}]}
                )
            },
        )
        assert out.strip() == "owner,viewer,reviewer"

    def test_unknown_permission_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "x", "permissions": ["bogus_perm_id"]}]}
                )
            },
            "Unknown permission",
        )

    def test_redefining_owner_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "owner", "permissions": ["*"]}]}
                )
            },
            "cannot redefine reserved role 'owner'",
        )

    def test_redefining_viewer_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "viewer", "permissions": ["read_system"]}]}
                )
            },
            "cannot redefine reserved role 'viewer'",
        )

    def test_duplicate_custom_role_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {
                        "project": [
                            {"role": "reviewer", "permissions": ["read_system"]},
                            {"role": "reviewer", "permissions": ["read_system"]},
                        ]
                    }
                )
            },
            "Duplicate role slug",
        )

    def test_empty_roles_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {"AGENTA_ACCESS_ROLES": "{}"},
            "non-empty",
        )

    def test_empty_scope_list_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {"AGENTA_ACCESS_ROLES": json.dumps({"project": []})},
            "non-empty list of roles",
        )


# ---------------------------------------------------------------------------
# Required-env validations
# ---------------------------------------------------------------------------


class TestEnvTypeValidation:
    def test_plans_as_list_fails(self):
        _fails(
            "from oss.src.utils.env import env; print(env.agenta.access.plans)",
            {"AGENTA_ACCESS_PLANS": "[1,2,3]"},
            "must be a JSON object",
        )

    def test_catalog_as_dict_fails(self):
        _fails(
            "from oss.src.utils.env import env; print(env.agenta.billing.catalog)",
            {"AGENTA_BILLING_CATALOG": "{}"},
            "must be a JSON array",
        )


# ---------------------------------------------------------------------------
# Default-plan overlay (env wired end-to-end)
# ---------------------------------------------------------------------------


class TestDefaultPlanOverlay:
    """The overlay targets whatever `get_default_plan()` resolves to. We
    pin the default plan via `AGENTA_ACCESS_DEFAULT_PLAN` to make the test
    deterministic regardless of whether Stripe is configured in the parent
    environment.
    """

    def test_overlay_patches_traces_retention(self):
        # Note: 525600 = Retention.YEARLY; the overlay only accepts canonical
        # Retention enum values, so we use one of those rather than an
        # arbitrary minute count.
        out = _ok(
            "from ee.src.core.entitlements.controls import get_plan_entitlements; "
            "from ee.src.core.entitlements.types import Tracker, Counter; "
            "ent = get_plan_entitlements('cloud_v0_hobby'); "
            "print(ent[Tracker.COUNTERS][Counter.TRACES_INGESTED].retention.value)",
            env_extra={
                "AGENTA_ACCESS_DEFAULT_PLAN": "cloud_v0_hobby",
                "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY": json.dumps(
                    {"counters": {"traces_ingested": {"retention": 525600}}}
                ),
            },
        )
        assert out.strip() == "525600"

    def test_overlay_preserves_other_quota_fields(self):
        # Hobby's traces_ingested quota: free=5000, period=Period.MONTHLY,
        # retention=Retention.MONTHLY. Overlay sets only retention → free
        # and period stay.
        out = _ok(
            "from ee.src.core.entitlements.controls import get_plan_entitlements; "
            "from ee.src.core.entitlements.types import Tracker, Counter; "
            "q = get_plan_entitlements('cloud_v0_hobby')"
            "[Tracker.COUNTERS][Counter.TRACES_INGESTED]; "
            "print(q.retention.value, q.free, q.period.value)",
            env_extra={
                "AGENTA_ACCESS_DEFAULT_PLAN": "cloud_v0_hobby",
                "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY": json.dumps(
                    {"counters": {"traces_ingested": {"retention": 525600}}}
                ),
            },
        )
        assert out.strip() == "525600 5000 monthly"

    def test_overlay_patches_throttle_rate_only(self):
        out = _ok(
            "from ee.src.core.entitlements.controls import get_plan_entitlements; "
            "from ee.src.core.entitlements.types import Tracker, Category; "
            "ent = get_plan_entitlements('cloud_v0_hobby'); "
            "t = next(t for t in ent[Tracker.THROTTLES] "
            "         if t.categories == [Category.STANDARD]); "
            "print(t.bucket.rate, t.bucket.capacity)",
            env_extra={
                "AGENTA_ACCESS_DEFAULT_PLAN": "cloud_v0_hobby",
                "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY": json.dumps(
                    {"throttles": {"standard": {"bucket": {"rate": 7200}}}}
                ),
            },
        )
        # rate patched; capacity preserved from the hobby default (480).
        assert out.strip() == "7200 480"

    def test_overlay_invalid_field_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_plans",
            {
                "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY": json.dumps(
                    {"flags": {"bogus_flag": True}}
                )
            },
            "Unknown flag",
        )

    def test_overlay_targeting_unknown_plan_fails(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_plans",
            {
                "AGENTA_ACCESS_DEFAULT_PLAN": "ghost_plan",
                "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY": json.dumps(
                    {"flags": {"rbac": True}}
                ),
            },
            "not in the effective plan set",
        )

    def test_overlay_empty_object_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_plans",
            {"AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY": "{}"},
            "non-empty",
        )


# ---------------------------------------------------------------------------
# Default-plan env var (canonical + legacy)
# ---------------------------------------------------------------------------


class TestDefaultPlanEnv:
    def test_canonical_var_takes_precedence(self):
        out = _ok(
            "from ee.src.core.subscriptions.types import get_default_plan; "
            "print(get_default_plan())",
            env_extra={
                "AGENTA_ACCESS_DEFAULT_PLAN": "cloud_v0_business",
                "AGENTA_DEFAULT_PLAN": "cloud_v0_hobby",
            },
        )
        assert out.strip() == "cloud_v0_business"

    def test_legacy_var_still_honored(self):
        out = _ok(
            "from ee.src.core.subscriptions.types import get_default_plan; "
            "print(get_default_plan())",
            env_extra={"AGENTA_DEFAULT_PLAN": "cloud_v0_business"},
        )
        assert out.strip() == "cloud_v0_business"

    def test_unset_falls_back_to_self_hosted_when_stripe_off(self):
        # Force Stripe disabled by clearing the API key inherited from the
        # parent test env, so the fallback path is exercised independently
        # of the developer's local config.
        out = _ok(
            "from ee.src.core.subscriptions.types import get_default_plan; "
            "print(get_default_plan())",
            env_extra={"STRIPE_API_KEY": ""},
        )
        assert out.strip() == "self_hosted_enterprise"

    def test_unset_falls_back_to_hobby_when_stripe_on(self):
        out = _ok(
            "from ee.src.core.subscriptions.types import get_default_plan; "
            "print(get_default_plan())",
            env_extra={"STRIPE_API_KEY": "sk_test_dummy"},
        )
        assert out.strip() == "cloud_v0_hobby"

    def test_default_plan_not_in_effective_set_fails_startup(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_catalog",
            {"AGENTA_ACCESS_DEFAULT_PLAN": "ghost_plan"},
            "is not in the effective plans set",
        )


# ---------------------------------------------------------------------------
# Roles overlay (env wired end-to-end)
# ---------------------------------------------------------------------------


class TestRolesOverlay:
    """The overlay accepts only the `project` key today and applies to both
    workspace and project scopes (they share the same default role set).
    """

    def test_overlay_patches_editor_permissions_in_both_scopes(self):
        out = _ok(
            "from ee.src.core.entitlements.controls import get_role_permissions; "
            "print(get_role_permissions('workspace', 'editor')); "
            "print(get_role_permissions('project', 'editor'))",
            env_extra={
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {"project": {"editor": {"permissions": ["read_system"]}}}
                )
            },
        )
        lines = out.splitlines()
        assert lines[0] == "['read_system']"
        assert lines[1] == "['read_system']"

    def test_overlay_adds_new_role_to_both_scopes(self):
        out = _ok(
            "from ee.src.core.entitlements.controls import get_roles; "
            "print('auditor' in [r['role'] for r in get_roles('workspace')]); "
            "print('auditor' in [r['role'] for r in get_roles('project')])",
            env_extra={
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {
                        "project": {
                            "auditor": {
                                "description": "Audit-only.",
                                "permissions": ["read_system"],
                            }
                        }
                    }
                )
            },
        )
        assert out.splitlines() == ["True", "True"]

    def test_overlay_organization_scope_untouched(self):
        # Organization scope only has the minima (owner + viewer) by default.
        # The overlay must not change that — it targets workspace + project.
        out = _ok(
            "from ee.src.core.entitlements.controls import get_roles; "
            "print(','.join(r['role'] for r in get_roles('organization')))",
            env_extra={
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {
                        "project": {
                            "auditor": {
                                "description": "Audit-only.",
                                "permissions": ["read_system"],
                            }
                        }
                    }
                )
            },
        )
        assert out.strip() == "owner,viewer"

    def test_overlay_non_project_scope_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {"workspace": {"editor": {"permissions": ["read_system"]}}}
                )
            },
            "only supports the 'project' scope",
        )

    def test_overlay_reserved_role_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {"project": {"owner": {"permissions": ["*"]}}}
                )
            },
            "cannot patch reserved role 'owner'",
        )

    def test_overlay_unknown_permission_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {"project": {"editor": {"permissions": ["bogus_perm"]}}}
                )
            },
            "Unknown permission",
        )

    def test_overlay_empty_object_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {"AGENTA_ACCESS_ROLES_OVERLAY": "{}"},
            "non-empty",
        )

    def test_overlay_new_role_without_permissions_fails_startup(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_roles",
            {
                "AGENTA_ACCESS_ROLES_OVERLAY": json.dumps(
                    {"project": {"auditor": {"description": "x"}}}
                )
            },
            "new role requires 'permissions'",
        )
