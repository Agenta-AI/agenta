"""One switch, one meaning, on both sides of the ordered-operations escape hatch.

`AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED` is read twice: the API parses it in
`oss.src.utils.env` to decide whether the ordered arm exists, and the SDK's op catalog
parses it again to decide whether to advertise that arm to the model. The SDK cannot
import the API's parser, so it mirrors it. The mirror has to hold in BOTH directions and
on the default: if the two ever drift, a deployment written `enabled` turns the arm on in
the API while the catalog keeps advertising the legacy surface, one written `off` shows
the model a shape the server refuses, and an unset variable does either — the model sends
a shape it was never shown, or was shown a shape that does not exist.

These tests are on the API side because it is the only side that can import both.
"""

import pytest

from agenta.sdk.agents.platform.op_catalog import (
    _ORDERED_OPERATIONS_ENV,
    _ordered_operations_enabled,
)
from oss.src.utils.env import _TRUTHY, _parse_bool_env


FLAG = "AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED"

# Ordered operations are the default, so the variable's job is to turn them OFF. These are
# the spellings that must do it, plus the unrecognized ones that fall the same way.
FALSY_SPELLINGS = (
    "false",
    "0",
    "f",
    "n",
    "no",
    "off",
    "disable",
    "disabled",
    "maybe",
    "2",
)

# Blank is not a spelling of "off": both parsers strip it and fall back to the default.
BLANK_SPELLINGS = ("", "   ")

# Every spelling the API accepts, plus the ones it must not, plus the whitespace and case
# variants both parsers strip and fold.
SPELLINGS = (
    sorted(_TRUTHY)
    + [spelling.upper() for spelling in sorted(_TRUTHY)]
    + ["  true  ", "  enabled", "  OFF  ", "DISABLED"]
    + list(FALSY_SPELLINGS)
    + list(BLANK_SPELLINGS)
)


def test_the_sdk_names_the_same_variable_as_the_api():
    assert _ORDERED_OPERATIONS_ENV == FLAG


@pytest.mark.parametrize("spelling", SPELLINGS)
def test_both_sides_read_the_same_spelling_the_same_way(monkeypatch, spelling):
    monkeypatch.setenv(FLAG, spelling)

    assert _ordered_operations_enabled() == _parse_bool_env(FLAG, True), (
        f"the API and the SDK catalog disagree on {spelling!r}: the API would offer the "
        "ordered arm while the catalog advertises the legacy surface, or the reverse"
    )


def test_an_unset_variable_leaves_the_arm_on_on_both_sides(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)

    assert _ordered_operations_enabled() is True
    assert _parse_bool_env(FLAG, True) is True


@pytest.mark.parametrize("spelling", FALSY_SPELLINGS)
def test_the_same_spellings_turn_the_arm_off_on_both_sides(monkeypatch, spelling):
    monkeypatch.setenv(FLAG, spelling)

    assert _ordered_operations_enabled() is False
    assert _parse_bool_env(FLAG, True) is False


@pytest.mark.parametrize("spelling", BLANK_SPELLINGS)
def test_a_blank_value_takes_the_default_on_both_sides(monkeypatch, spelling):
    monkeypatch.setenv(FLAG, spelling)

    assert _ordered_operations_enabled() is True
    assert _parse_bool_env(FLAG, True) is True
