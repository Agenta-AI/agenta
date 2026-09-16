import fnmatch

from oss.src.utils.caching import _pack


def test_pack_produces_expected_key_shape():
    packed = _pack(
        namespace="check_action_access",
        key={"permission": "run_service", "role": "member"},
        project_id="abc123",
        user_id="9c0d1e2f3a4b",
    )

    assert packed == (
        "cache:p:abc123------:u:9c0d1e2f3a4b:check_action_access:"
        "permission:run_service:role:member"
    )


def test_pack_sorts_dict_keys_for_deterministic_output():
    # Insertion order must not affect the packed key, or two callers building
    # "the same" cache key from an unordered dict would silently miss.
    key_a = {"permission": "run_service", "role": "member"}
    key_b = {"role": "member", "permission": "run_service"}

    assert _pack(namespace="ns", key=key_a) == _pack(namespace="ns", key=key_b)


def test_pack_rejects_non_str_non_dict_key():
    import pytest

    with pytest.raises(TypeError):
        _pack(namespace="ns", key=123)


def test_pack_scan_pattern_matches_key_written_with_user_id():
    # Regression test for the RBAC cache-invalidation bug: every role/membership
    # change calls invalidate_cache(namespace=..., project_id=...) WITHOUT a
    # user_id, relying on _pack(..., pattern=True) to emit a wildcard for the
    # omitted user segment. Before the fix, an omitted user_id was padded to a
    # literal "------------" segment even when pattern=True, so the scan
    # pattern never matched keys written with a real user_id — invalidation
    # was silently a no-op and stale permissions (positive and negative) were
    # served for up to the full 5-minute cache TTL.
    written = _pack(
        namespace="check_action_access",
        key={"permission": "run_service"},
        project_id="abc123",
        user_id="9c0d1e2f3a4b",
    )

    scan = _pack(
        namespace="check_action_access",
        project_id="abc123",
        pattern=True,
    )

    assert fnmatch.fnmatch(written, scan)


def test_pack_omitted_user_id_with_pattern_true_emits_wildcard():
    packed = _pack(namespace="check_action_access", project_id="abc123", pattern=True)
    assert ":u:*:" in packed


def test_pack_omitted_user_id_with_pattern_false_still_pads_with_dashes():
    # Write-path behavior for a genuinely-omitted id must stay unchanged,
    # only the pattern=True (invalidation scan) path should wildcard it.
    packed = _pack(namespace="check_action_access", project_id="abc123", pattern=False)
    assert ":u:------------:" in packed
