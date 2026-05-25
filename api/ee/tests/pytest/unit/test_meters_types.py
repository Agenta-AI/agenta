from ee.src.core.entitlements.types import Counter, Gauge
from ee.src.core.meters.types import Meters


def test_every_counter_has_meter_key_mapping():
    for counter in Counter:
        assert Meters[counter.name].value == counter.value


def test_every_gauge_has_meter_key_mapping():
    for gauge in Gauge:
        assert Meters[gauge.name].value == gauge.value
