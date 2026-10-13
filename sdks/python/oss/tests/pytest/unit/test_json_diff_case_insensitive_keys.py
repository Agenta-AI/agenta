"""Unit tests for the case_insensitive_keys fix in _compare_jsons.

Regression coverage for issue #7149: `keys` was previously built from the
raw (possibly mixed-case) flattened dicts before `normalize_keys` lowercased
them, so any uppercase or camelCase key never matched and scored 0 even when
`case_insensitive_keys=True` was meant to tolerate exactly that drift
(Name vs name). The fix normalizes the dicts before building the key set.
"""

from agenta.sdk.engines.running.handlers import _compare_jsons


def test_identical_json_with_mixed_case_keys_scores_full_when_case_insensitive():
    gold = {"Name": "Ann", "Age": 30}
    output = {"Name": "Ann", "Age": 30}

    assert _compare_jsons(gold, output, {"case_insensitive_keys": True}) == 1.0


def test_nested_identical_json_with_camel_case_keys_scores_full():
    gold = {"user": {"firstName": "Ann", "lastName": "Lee", "id": 7}}
    output = {"user": {"firstName": "Ann", "lastName": "Lee", "id": 7}}

    assert _compare_jsons(gold, output, {"case_insensitive_keys": True}) == 1.0


def test_gold_capitalized_output_lowercase_key_matches_when_case_insensitive():
    gold = {"Name": "Ann"}
    output = {"name": "Ann"}

    assert _compare_jsons(gold, output, {"case_insensitive_keys": True}) == 1.0


def test_identical_json_with_mixed_case_keys_and_predict_keys_scores_full():
    gold = {"Name": "Ann", "Age": 30}
    output = {"Name": "Ann", "Age": 30}

    settings = {"case_insensitive_keys": True, "predict_keys": True}
    assert _compare_jsons(gold, output, settings) == 1.0


def test_identical_json_with_mixed_case_keys_and_schema_only_scores_full():
    gold = {"Name": "Ann", "Age": 30}
    output = {"Name": "Ann", "Age": 30}

    settings = {"case_insensitive_keys": True, "compare_schema_only": True}
    assert _compare_jsons(gold, output, settings) == 1.0


def test_case_sensitivity_still_applies_when_option_is_off():
    gold = {"Name": "Ann"}
    output = {"name": "Ann"}

    # Without case_insensitive_keys, "Name" and "name" are different keys and
    # the gold key is never found in the output, so this must stay 0.0.
    assert _compare_jsons(gold, output, {"case_insensitive_keys": False}) == 0.0


def test_wrong_values_still_score_zero_regardless_of_key_case():
    gold = {"Name": "Ann", "Age": 30}
    output = {"Name": "Bob", "Age": 99}

    assert _compare_jsons(gold, output, {"case_insensitive_keys": True}) == 0.0
