"""Unit tests for sandbox credit conversion (to_credits).

Tests the pure conversion function against the rate table defined in
credits.DEFAULT_PROVIDER_RATES. No dollar/cents values are asserted;
credit->money is Stripe's concern. The cross-check scenario at the end is
informational only -- it verifies the rate table is self-consistent, not
that any dollar amount is correct.
"""

from decimal import Decimal


from ee.src.core.sandboxes.credits import (
    DEFAULT_PROVIDER_RATES,
    Dimension,
    ProviderRates,
    to_credits,
)


class TestToCreditsDefaultRates:
    """Per-dimension conversion against the code-default rate table."""

    # E2B — each dimension on its own rate

    def test_cpu_e2b_1000s(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("1000")
        )
        expected = Decimal("1000") * DEFAULT_PROVIDER_RATES["e2b"].cpu
        assert result == expected

    def test_ram_e2b_1000s(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.RAM, raw_units=Decimal("1000")
        )
        expected = Decimal("1000") * DEFAULT_PROVIDER_RATES["e2b"].ram
        assert result == expected

    def test_ssd_e2b_1000s(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.SSD, raw_units=Decimal("1000")
        )
        expected = Decimal("1000") * DEFAULT_PROVIDER_RATES["e2b"].ssd
        assert result == expected

    def test_gpu_e2b_is_zero(self):
        # E2B GPU rate is 0 by default.
        result = to_credits(
            provider="e2b", dimension=Dimension.GPU, raw_units=Decimal("100")
        )
        assert result == Decimal("0")

    # Daytona — same default rates as E2B

    def test_cpu_daytona_1000s(self):
        result = to_credits(
            provider="daytona", dimension=Dimension.CPU, raw_units=Decimal("1000")
        )
        expected = Decimal("1000") * DEFAULT_PROVIDER_RATES["daytona"].cpu
        assert result == expected

    def test_ram_daytona_1000s(self):
        result = to_credits(
            provider="daytona", dimension=Dimension.RAM, raw_units=Decimal("1000")
        )
        expected = Decimal("1000") * DEFAULT_PROVIDER_RATES["daytona"].ram
        assert result == expected

    def test_ssd_daytona_1000s(self):
        result = to_credits(
            provider="daytona", dimension=Dimension.SSD, raw_units=Decimal("1000")
        )
        expected = Decimal("1000") * DEFAULT_PROVIDER_RATES["daytona"].ssd
        assert result == expected

    def test_gpu_daytona_is_zero(self):
        # Daytona GPU rate is 0 by default; set via env override.
        result = to_credits(
            provider="daytona", dimension=Dimension.GPU, raw_units=Decimal("100")
        )
        assert result == Decimal("0")

    # Local — zero-rated

    def test_local_cpu_is_zero(self):
        result = to_credits(
            provider="local", dimension=Dimension.CPU, raw_units=Decimal("1000")
        )
        assert result == Decimal("0")

    def test_local_ram_is_zero(self):
        result = to_credits(
            provider="local", dimension=Dimension.RAM, raw_units=Decimal("1000")
        )
        assert result == Decimal("0")

    def test_local_ssd_is_zero(self):
        result = to_credits(
            provider="local", dimension=Dimension.SSD, raw_units=Decimal("1000")
        )
        assert result == Decimal("0")


class TestDimensionIndependence:
    """Each dimension converts on its own rate; changing one doesn't affect others."""

    def test_each_dimension_uses_own_rate(self):
        cpu_rate = DEFAULT_PROVIDER_RATES["e2b"].cpu
        ram_rate = DEFAULT_PROVIDER_RATES["e2b"].ram
        ssd_rate = DEFAULT_PROVIDER_RATES["e2b"].ssd

        units = Decimal("3600")
        cpu_credits = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=units
        )
        ram_credits = to_credits(
            provider="e2b", dimension=Dimension.RAM, raw_units=units
        )
        ssd_credits = to_credits(
            provider="e2b", dimension=Dimension.SSD, raw_units=units
        )

        assert cpu_credits == units * cpu_rate
        assert ram_credits == units * ram_rate
        assert ssd_credits == units * ssd_rate
        # All three must be distinct (rates differ).
        assert cpu_credits != ram_credits
        assert ram_credits != ssd_credits

    def test_rates_are_distinct_per_dimension(self):
        rates = DEFAULT_PROVIDER_RATES["e2b"]
        assert rates.cpu != rates.ram
        assert rates.ram != rates.ssd
        assert rates.cpu != rates.ssd


class TestToCreditsEdgeCases:
    """Edge and boundary cases."""

    def test_zero_input_returns_zero(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("0")
        )
        assert result == Decimal("0")

    def test_negative_input_returns_zero(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("-500")
        )
        assert result == Decimal("0")

    def test_unknown_provider_returns_zero(self):
        result = to_credits(
            provider="unknown_cloud_xyz",
            dimension=Dimension.CPU,
            raw_units=Decimal("1000"),
        )
        assert result == Decimal("0")

    def test_unknown_dimension_string_returns_zero(self):
        result = to_credits(
            provider="e2b", dimension="quantum_processor", raw_units=Decimal("1000")
        )
        assert result == Decimal("0")

    def test_provider_case_insensitive(self):
        lower = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("1000")
        )
        upper = to_credits(
            provider="E2B", dimension=Dimension.CPU, raw_units=Decimal("1000")
        )
        assert lower == upper

    def test_dimension_as_string(self):
        enum_result = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("1000")
        )
        str_result = to_credits(
            provider="e2b", dimension="cpu", raw_units=Decimal("1000")
        )
        assert enum_result == str_result

    def test_dimension_string_case_insensitive(self):
        lower = to_credits(provider="e2b", dimension="cpu", raw_units=Decimal("1000"))
        upper = to_credits(provider="e2b", dimension="CPU", raw_units=Decimal("1000"))
        assert lower == upper


class TestToCreditsDecimalPrecision:
    """Decimal arithmetic must be exact; no float drift."""

    def test_no_float_drift_cpu(self):
        # 10800 vCPU-s at rate 0.0014 = 15.12 exactly
        result = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("10800")
        )
        assert result == Decimal("10800") * DEFAULT_PROVIDER_RATES["e2b"].cpu

    def test_no_float_drift_ram(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.RAM, raw_units=Decimal("14400")
        )
        assert result == Decimal("14400") * DEFAULT_PROVIDER_RATES["e2b"].ram

    def test_no_float_drift_ssd(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.SSD, raw_units=Decimal("360000")
        )
        assert result == Decimal("360000") * DEFAULT_PROVIDER_RATES["e2b"].ssd

    def test_result_type_is_decimal(self):
        result = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("1")
        )
        assert isinstance(result, Decimal)

    def test_sum_of_dimensions_is_exact(self):
        """Full event: cpu + ram + ssd credits sum without float drift."""
        cpu = to_credits(
            provider="e2b", dimension=Dimension.CPU, raw_units=Decimal("3600")
        )
        ram = to_credits(
            provider="e2b", dimension=Dimension.RAM, raw_units=Decimal("7200")
        )
        ssd = to_credits(
            provider="e2b", dimension=Dimension.SSD, raw_units=Decimal("7200")
        )

        rates = DEFAULT_PROVIDER_RATES["e2b"]
        assert cpu == Decimal("3600") * rates.cpu
        assert ram == Decimal("7200") * rates.ram
        assert ssd == Decimal("7200") * rates.ssd

        total = cpu + ram + ssd
        expected = (
            Decimal("3600") * rates.cpu
            + Decimal("7200") * rates.ram
            + Decimal("7200") * rates.ssd
        )
        assert total == expected


class TestProviderRatesModel:
    """ProviderRates is a typed Pydantic model with named fields."""

    def test_provider_rates_has_named_fields(self):
        rates = DEFAULT_PROVIDER_RATES["e2b"]
        assert isinstance(rates, ProviderRates)
        assert isinstance(rates.cpu, Decimal)
        assert isinstance(rates.ram, Decimal)
        assert isinstance(rates.ssd, Decimal)
        assert isinstance(rates.gpu, Decimal)

    def test_all_default_providers_present(self):
        assert "e2b" in DEFAULT_PROVIDER_RATES
        assert "daytona" in DEFAULT_PROVIDER_RATES
        assert "local" in DEFAULT_PROVIDER_RATES

    def test_local_all_zero(self):
        rates = DEFAULT_PROVIDER_RATES["local"]
        assert rates.cpu == Decimal("0")
        assert rates.ram == Decimal("0")
        assert rates.ssd == Decimal("0")
        assert rates.gpu == Decimal("0")


class TestReferenceScenarioCrossCheck:
    """Informational cross-check: rate table applied to a reference machine-minute.

    This is a sanity check on the rate table, NOT a billing input.
    A 2vCPU / 2GiB-RAM / 10GiB-disk machine running for 1 minute (60s) with the
    default E2B rates should produce a credits figure consistent with the table.
    This test asserts against the rate table itself — it does NOT assert a dollar
    amount (credit->money is Stripe's job).
    """

    def test_reference_machine_minute_e2b(self):
        cpu_s = Decimal("2") * Decimal("60")  # 2 vCPU × 60s = 120 vCPU·s
        ram_s = Decimal("2") * Decimal("60")  # 2 GiB × 60s = 120 GiB·s
        ssd_s = Decimal("10") * Decimal("60")  # 10 GiB × 60s = 600 GiB·s

        rates = DEFAULT_PROVIDER_RATES["e2b"]
        cpu_credits = cpu_s * rates.cpu
        ram_credits = ram_s * rates.ram
        ssd_credits = ssd_s * rates.ssd
        total_credits = cpu_credits + ram_credits + ssd_credits

        # Each dimension contributes independently.
        assert cpu_credits == Decimal("120") * rates.cpu
        assert ram_credits == Decimal("120") * rates.ram
        assert ssd_credits == Decimal("600") * rates.ssd

        # Total must equal the per-dimension sum.
        assert total_credits == cpu_credits + ram_credits + ssd_credits

        # Sanity bound: reference machine should produce a positive credit amount.
        assert total_credits > Decimal("0")

    def test_reference_machine_minute_daytona(self):
        cpu_s = Decimal("2") * Decimal("60")
        ram_s = Decimal("2") * Decimal("60")
        ssd_s = Decimal("10") * Decimal("60")

        rates = DEFAULT_PROVIDER_RATES["daytona"]
        total_credits = cpu_s * rates.cpu + ram_s * rates.ram + ssd_s * rates.ssd
        assert total_credits > Decimal("0")
        # Daytona and E2B share default rates; cross-check they agree.
        e2b_rates = DEFAULT_PROVIDER_RATES["e2b"]
        e2b_total = (
            cpu_s * e2b_rates.cpu + ram_s * e2b_rates.ram + ssd_s * e2b_rates.ssd
        )
        assert total_credits == e2b_total
