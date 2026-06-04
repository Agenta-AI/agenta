"""Unit tests for billing settings parsers in
``ee.src.core.subscriptions.settings``.

Covers `_normalize_pricing_entry`, `_parse_pricing_override`,
`_parse_catalog_override`, and the public accessors in their no-env-override
state.
"""

import pytest

from ee.src.core.subscriptions import settings
from ee.src.core.entitlements.types import DefaultPlan


# ---------------------------------------------------------------------------
# Catalog parser
# ---------------------------------------------------------------------------


class TestParseCatalogOverride:
    _FULL_ENTRY = {
        "title": "T",
        "description": "d",
        "type": "standard",
        "features": ["a"],
        "plan": "p",
    }

    def test_minimal_valid_catalog(self):
        result = settings._parse_catalog_override([self._FULL_ENTRY])
        assert result == [self._FULL_ENTRY]

    def test_extra_fields_passed_through(self):
        entry = dict(self._FULL_ENTRY, custom_badge="new")
        result = settings._parse_catalog_override([entry])
        assert result[0]["custom_badge"] == "new"

    def test_missing_required_field_rejected(self):
        broken = dict(self._FULL_ENTRY)
        del broken["title"]
        with pytest.raises(ValueError, match="is invalid"):
            settings._parse_catalog_override([broken])

    def test_invalid_type_value_rejected(self):
        broken = dict(self._FULL_ENTRY, type="garbage")
        with pytest.raises(ValueError, match="type must be one of"):
            settings._parse_catalog_override([broken])

    def test_non_list_rejected(self):
        with pytest.raises(ValueError, match="JSON array"):
            settings._parse_catalog_override({"oops": "dict"})

    def test_non_dict_entry_rejected(self):
        with pytest.raises(ValueError, match="must be objects"):
            settings._parse_catalog_override(["not-a-dict"])


# ---------------------------------------------------------------------------
# Pricing parser (single entry)
# ---------------------------------------------------------------------------


class TestNormalizePricingEntry:
    def test_free_plan_entry(self):
        result = settings._normalize_pricing_entry("p", {"free": True})
        assert result == {"free": True}

    def test_paid_with_single_slot(self):
        result = settings._normalize_pricing_entry(
            "p",
            {"base": {"price": "price_x", "quantity": 1}},
        )
        assert result == {"base": {"price": "price_x", "quantity": 1}}

    def test_paid_with_multiple_slots(self):
        result = settings._normalize_pricing_entry(
            "p",
            {
                "base": {"price": "p_base", "quantity": 1},
                "users": {"price": "p_users"},
                "traces": {"price": "p_traces"},
            },
        )
        assert set(result.keys()) == {"base", "users", "traces"}
        assert result["users"] == {"price": "p_users"}
        assert result["base"]["quantity"] == 1

    def test_trial_plan_entry(self):
        result = settings._normalize_pricing_entry(
            "p", {"trial": 90, "base": {"price": "p_base"}}
        )
        assert result["trial"] == 90
        assert result["base"]["price"] == "p_base"

    def test_trial_must_be_positive_int(self):
        with pytest.raises(ValueError, match="trial must be a positive integer"):
            settings._normalize_pricing_entry("p", {"trial": 0})
        with pytest.raises(ValueError, match="trial must be a positive integer"):
            settings._normalize_pricing_entry("p", {"trial": -7})
        with pytest.raises(ValueError, match="trial must be a positive integer"):
            settings._normalize_pricing_entry("p", {"trial": "ninety"})
        with pytest.raises(ValueError, match="trial must be a positive integer"):
            settings._normalize_pricing_entry("p", {"trial": True})

    def test_non_dict_rejected(self):
        with pytest.raises(ValueError, match="must be an object"):
            settings._normalize_pricing_entry("p", "not-a-dict")

    def test_slot_value_not_dict_rejected(self):
        with pytest.raises(ValueError, match="slot must be an object"):
            settings._normalize_pricing_entry("p", {"users": "nope"})

    def test_slot_missing_price_rejected(self):
        with pytest.raises(ValueError, match="missing or invalid 'price'"):
            settings._normalize_pricing_entry("p", {"users": {}})

    def test_slot_empty_price_rejected(self):
        with pytest.raises(ValueError, match="missing or invalid 'price'"):
            settings._normalize_pricing_entry("p", {"users": {"price": ""}})

    def test_slot_quantity_must_be_int(self):
        with pytest.raises(ValueError, match="quantity must be an integer"):
            settings._normalize_pricing_entry(
                "p", {"users": {"price": "p1", "quantity": "many"}}
            )

    def test_slot_unknown_subkey_rejected(self):
        with pytest.raises(ValueError, match="unknown sub-keys"):
            settings._normalize_pricing_entry(
                "p", {"users": {"price": "p1", "color": "purple"}}
            )

    def test_empty_pricing_entry_rejected(self):
        """`{}` would contribute nothing and silently 400 at checkout. Require at
        least one of `free` / `trial` / a meter slot."""
        with pytest.raises(
            ValueError,
            match=(
                "must declare at least one of 'free', 'trial', or a Stripe meter slot"
            ),
        ):
            settings._normalize_pricing_entry("my_plan", {})


# ---------------------------------------------------------------------------
# Pricing parser (full payload)
# ---------------------------------------------------------------------------


class TestParsePricingOverride:
    def test_multi_plan(self):
        result = settings._parse_pricing_override(
            {
                "free_plan": {"free": True},
                "paid_plan": {"base": {"price": "p_x", "quantity": 1}},
            }
        )
        assert result["free_plan"]["free"] is True
        assert result["paid_plan"]["base"]["price"] == "p_x"

    def test_non_dict_rejected(self):
        with pytest.raises(ValueError, match="JSON object"):
            settings._parse_pricing_override([])

    def test_multiple_free_plans_rejected(self):
        with pytest.raises(ValueError, match="multiple free plans"):
            settings._parse_pricing_override(
                {
                    "a": {"free": True},
                    "b": {"free": True},
                }
            )


# ---------------------------------------------------------------------------
# Trial resolution (derived from per-entry "trial" markers)
# ---------------------------------------------------------------------------


class TestResolveTrial:
    def test_no_trial_returns_none_none(self):
        pricing = {
            "a": {"free": True},
            "b": {"base": {"price": "p_b"}},
        }
        assert settings._resolve_trial(pricing) == (None, None)

    def test_single_trial_entry(self):
        pricing = {
            "free_plan": {"free": True},
            "pro": {"trial": 90, "base": {"price": "p_pro"}},
        }
        assert settings._resolve_trial(pricing) == ("pro", 90)

    def test_multiple_trial_entries_rejected(self):
        with pytest.raises(ValueError, match="multiple trial plans"):
            settings._resolve_trial(
                {
                    "a": {"trial": 90, "base": {"price": "p_a"}},
                    "b": {"trial": 30, "base": {"price": "p_b"}},
                }
            )


# ---------------------------------------------------------------------------
# Public accessors (defaults state)
# ---------------------------------------------------------------------------


class TestDefaults:
    @pytest.fixture(autouse=True)
    def _no_pricing_env(self, monkeypatch):
        monkeypatch.setattr(settings, "_PRICING", {})
        monkeypatch.setattr(settings, "_FREE_PLAN", None)

    def test_get_catalog_returns_default_catalog(self):
        catalog = settings.get_catalog()
        assert len(catalog) > 0
        # Default catalog references DefaultPlan slugs.
        plans_in_catalog = {entry.get("plan") for entry in catalog if entry.get("plan")}
        assert plans_in_catalog.issubset({p.value for p in DefaultPlan})

    def test_get_catalog_plan_lookup(self):
        # The default catalog has a Hobby entry.
        entry = settings.get_catalog_plan(DefaultPlan.CLOUD_V0_HOBBY.value)
        assert entry is not None
        assert entry["plan"] == DefaultPlan.CLOUD_V0_HOBBY.value

    def test_get_catalog_plan_unknown_returns_none(self):
        assert settings.get_catalog_plan("ghost") is None

    def test_get_catalog_plan_none_slug_returns_none(self):
        assert settings.get_catalog_plan(None) is None

    def test_get_pricing_defaults_to_empty(self):
        # No env override → no code-default pricing in this deployment.
        assert settings.get_pricing() == {}

    def test_get_stripe_line_items_empty_when_no_pricing(self):
        assert settings.get_stripe_line_items(DefaultPlan.CLOUD_V0_PRO.value) == []

    def test_require_pricing_fails_with_clear_message(self):
        with pytest.raises(ValueError) as exc:
            settings.require_pricing(
                DefaultPlan.CLOUD_V0_PRO.value,
                purpose="Reverse trial signup",
            )

        message = str(exc.value)
        assert "Reverse trial signup requires Stripe line items" in message
        assert DefaultPlan.CLOUD_V0_PRO.value in message
        assert "AGENTA_BILLING_PRICING" in message
        assert "base" in message

    def test_require_pricing_does_not_warn_about_supported_legacy_alias(
        self, monkeypatch
    ):
        monkeypatch.setenv("STRIPE_PRICING", '{"cloud_v0_pro": {"base": {}}}')

        with pytest.raises(ValueError) as exc:
            settings.require_pricing(
                DefaultPlan.CLOUD_V0_PRO.value,
                purpose="Reverse trial signup",
            )

        assert "Legacy STRIPE_PRICING is ignored" not in str(exc.value)

    def test_get_stripe_line_items_none_slug_returns_empty(self):
        assert settings.get_stripe_line_items(None) == []

    def test_get_stripe_meter_price_returns_none_when_no_pricing(self):
        assert (
            settings.get_stripe_meter_price(DefaultPlan.CLOUD_V0_PRO.value, "users")
            is None
        )

    def test_get_stripe_meter_price_with_none_args(self):
        assert settings.get_stripe_meter_price(None, "users") is None
        assert settings.get_stripe_meter_price("plan", None) is None

    def test_get_free_plan_falls_back_to_hobby(self):
        assert settings.get_free_plan() == DefaultPlan.CLOUD_V0_HOBBY.value

    def test_get_trial_plan_disabled_when_stripe_disabled_by_default(self):
        if settings.env.stripe.enabled:
            assert settings.get_trial_plan() == DefaultPlan.CLOUD_V0_PRO.value
        else:
            assert settings.get_trial_plan() is None

    def test_get_trial_days_disabled_when_stripe_disabled_by_default(self):
        if settings.env.stripe.enabled:
            assert settings.get_trial_days() == 14
        else:
            assert settings.get_trial_days() is None

    def test_trial_enabled_false_when_stripe_disabled_by_default(self):
        assert settings.trial_enabled() is settings.env.stripe.enabled

    def test_get_effective_pricing_includes_resolved_defaults(self):
        result = settings.get_effective_pricing()

        assert result[settings.get_free_plan()]["free"] is True
        if settings.trial_enabled():
            assert (
                result[settings.get_trial_plan()]["trial"] == settings.get_trial_days()
            )
