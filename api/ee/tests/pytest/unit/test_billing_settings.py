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

    def test_paid_with_line_items(self):
        result = settings._normalize_pricing_entry(
            "p",
            {"stripe": {"line_items": [{"price": "price_x", "quantity": 1}]}},
        )
        assert result == {
            "stripe": {
                "line_items": [{"price": "price_x", "quantity": 1}],
                "meters": {},
            }
        }

    def test_with_per_meter_prices(self):
        result = settings._normalize_pricing_entry(
            "p",
            {
                "stripe": {
                    "line_items": [{"price": "p1"}],
                    "meters": {"users": {"price": "p_users"}},
                }
            },
        )
        assert result["stripe"]["meters"] == {"users": {"price": "p_users"}}

    def test_non_dict_rejected(self):
        with pytest.raises(ValueError, match="must be an object"):
            settings._normalize_pricing_entry("p", "not-a-dict")

    def test_unknown_top_level_key_rejected(self):
        with pytest.raises(ValueError, match="unknown keys"):
            settings._normalize_pricing_entry("p", {"surprise": True})

    def test_stripe_not_dict_rejected(self):
        with pytest.raises(ValueError, match="stripe must be an object"):
            settings._normalize_pricing_entry("p", {"stripe": "nope"})

    def test_unknown_stripe_key_rejected(self):
        with pytest.raises(ValueError, match="stripe has unknown keys"):
            settings._normalize_pricing_entry("p", {"stripe": {"foo": []}})

    def test_line_items_not_list_rejected(self):
        with pytest.raises(ValueError, match="line_items must be a list"):
            settings._normalize_pricing_entry("p", {"stripe": {"line_items": "nope"}})

    def test_meters_not_dict_rejected(self):
        with pytest.raises(ValueError, match="meters must be an object"):
            settings._normalize_pricing_entry("p", {"stripe": {"meters": "nope"}})

    def test_meter_entry_missing_price_rejected(self):
        with pytest.raises(ValueError, match="must be an object with a 'price'"):
            settings._normalize_pricing_entry(
                "p", {"stripe": {"meters": {"users": {}}}}
            )


# ---------------------------------------------------------------------------
# Pricing parser (full payload)
# ---------------------------------------------------------------------------


class TestParsePricingOverride:
    def test_multi_plan(self):
        result = settings._parse_pricing_override(
            {
                "free_plan": {"free": True},
                "paid_plan": {
                    "stripe": {"line_items": [{"price": "p_x", "quantity": 1}]}
                },
            }
        )
        assert result["free_plan"]["free"] is True
        assert result["paid_plan"]["stripe"]["line_items"][0]["price"] == "p_x"

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
# Public accessors (defaults state)
# ---------------------------------------------------------------------------


class TestDefaults:
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

    def test_get_trial_plan_disabled_when_no_env(self):
        # No AGENTA_BILLING_TRIAL_PLAN/DAYS set → trial is disabled.
        assert settings.get_trial_plan() is None

    def test_get_trial_days_disabled_when_no_env(self):
        assert settings.get_trial_days() is None

    def test_trial_enabled_false_when_no_env(self):
        assert settings.trial_enabled() is False
