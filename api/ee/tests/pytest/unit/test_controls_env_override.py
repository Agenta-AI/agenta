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
        out = _ok(
            "from ee.src.core.entitlements.controls import get_plans; "
            "from ee.src.core.subscriptions.settings import get_catalog; "
            "print(len(get_plans())); print(len(get_catalog()))"
        )
        assert out.splitlines() == ["7", "7"]


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
                        "hooks": True,
                        "rbac": False,
                        "access": False,
                        "domains": False,
                        "sso": False,
                    },
                }
            }
        ),
        "AGENTA_BILLING_CATALOG": json.dumps(
            [{"title": "Only", "plan": "only_plan", "type": "standard"}]
        ),
        "AGENTA_BILLING_PRICING": json.dumps({"only_plan": {"free": True}}),
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

    def test_plan_with_no_entitlements_fails(self):
        _fails(
            "from ee.src.core.entitlements.controls import get_plans",
            {"AGENTA_ACCESS_PLANS": '{"x":{"description":"y"}}'},
            "at least one of",
        )


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
                                "hooks": True,
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [{"plan": "nonexistent", "type": "standard"}]
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
                                "hooks": True,
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
                                "hooks": True,
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [{"plan": "only", "type": "standard"}]
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
                                "hooks": True,
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        }
                    }
                ),
                "AGENTA_BILLING_CATALOG": json.dumps(
                    [{"plan": "only", "type": "standard"}]
                ),
                "AGENTA_BILLING_PRICING": json.dumps({"only": {"free": True}}),
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
                                "hooks": True,
                                "rbac": False,
                                "access": False,
                                "domains": False,
                                "sso": False,
                            }
                        },
                        "b": {
                            "flags": {
                                "hooks": True,
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
                        {"plan": "a", "type": "standard"},
                        {"plan": "b", "type": "standard"},
                    ]
                ),
                "AGENTA_BILLING_PRICING": json.dumps(
                    {"a": {"free": True}, "b": {"free": True}}
                ),
            },
            "multiple free plans",
        )


# ---------------------------------------------------------------------------
# Trial env vars
# ---------------------------------------------------------------------------


class TestTrialEnv:
    def test_trial_both_set_enables_trial(self):
        out = _ok(
            "from ee.src.core.subscriptions.settings import "
            "get_trial_plan, get_trial_days, trial_enabled; "
            "print(get_trial_plan()); print(get_trial_days()); print(trial_enabled())",
            env_extra={
                "AGENTA_BILLING_TRIAL_PLAN": "cloud_v0_business",
                "AGENTA_BILLING_TRIAL_DAYS": "30",
            },
        )
        assert out.splitlines() == ["cloud_v0_business", "30", "True"]

    def test_trial_neither_set_disables_trial(self):
        out = _ok(
            "from ee.src.core.subscriptions.settings import "
            "get_trial_plan, get_trial_days, trial_enabled; "
            "print(get_trial_plan()); print(get_trial_days()); print(trial_enabled())",
        )
        assert out.splitlines() == ["None", "None", "False"]

    def test_trial_plan_only_fails_startup(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_plan",
            {"AGENTA_BILLING_TRIAL_PLAN": "cloud_v0_business"},
            "AGENTA_BILLING_TRIAL_DAYS is required",
        )

    def test_trial_days_only_fails_startup(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_days",
            {"AGENTA_BILLING_TRIAL_DAYS": "14"},
            "AGENTA_BILLING_TRIAL_PLAN is required",
        )

    def test_trial_plan_not_in_effective_plans_fails(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_plan",
            {
                "AGENTA_BILLING_TRIAL_PLAN": "bogus_plan",
                "AGENTA_BILLING_TRIAL_DAYS": "14",
            },
            "not in the effective plans set",
        )

    def test_trial_days_non_positive_fails(self):
        _fails(
            "from ee.src.core.subscriptions.settings import get_trial_days",
            {
                "AGENTA_BILLING_TRIAL_PLAN": "cloud_v0_pro",
                "AGENTA_BILLING_TRIAL_DAYS": "0",
            },
            "must be a positive integer",
        )

    def test_trial_days_invalid_fails_startup(self):
        _fails(
            "from oss.src.utils.env import env; print(env.billing.trial_days)",
            {"AGENTA_BILLING_TRIAL_DAYS": "not-a-number"},
            "must be an integer",
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

    def test_non_overridden_scope_keeps_defaults(self):
        # Overriding `project` does not clobber the workspace defaults.
        out = _ok(
            "from ee.src.core.entitlements.controls import get_roles; "
            "print(len(get_roles('workspace')))",
            env_extra={
                "AGENTA_ACCESS_ROLES": json.dumps(
                    {"project": [{"role": "reviewer", "permissions": ["read_system"]}]}
                )
            },
        )
        # Workspace = owner + viewer + 4 legacy extras (admin/developer/editor/annotator).
        assert int(out.strip()) == 6

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
            "from oss.src.utils.env import env; print(env.access_controls.plans)",
            {"AGENTA_ACCESS_PLANS": "[1,2,3]"},
            "must be a JSON object",
        )

    def test_catalog_as_dict_fails(self):
        _fails(
            "from oss.src.utils.env import env; print(env.billing.catalog)",
            {"AGENTA_BILLING_CATALOG": "{}"},
            "must be a JSON array",
        )
