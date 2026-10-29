from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.identity import compose_external_user_key


def _capabilities(**identity) -> ChannelCapabilities:
    return ChannelCapabilities(channel="slack", identity=identity)


def test_workspace_scope_distinguishes_two_connections_with_the_same_raw_id():
    capabilities = _capabilities(scope="workspace", stable=True)

    key_a = compose_external_user_key(capabilities, "U012ABC", scope_id="T_ALPHA")
    key_b = compose_external_user_key(capabilities, "U012ABC", scope_id="T_BETA")

    assert key_a != key_b


def test_workspace_scope_is_deterministic():
    capabilities = _capabilities(scope="workspace", stable=True)

    first = compose_external_user_key(capabilities, "U012ABC", scope_id="T_ALPHA")
    second = compose_external_user_key(capabilities, "U012ABC", scope_id="T_ALPHA")

    assert first == second


def test_no_scope_uses_the_raw_platform_id_alone():
    capabilities = _capabilities(stable=True)

    key = compose_external_user_key(capabilities, "12345", scope_id="ignored")

    assert key == compose_external_user_key(_capabilities(stable=True), "12345")


def test_global_scope_uses_the_raw_platform_id_alone():
    capabilities = _capabilities(scope="global", stable=True)

    key_a = compose_external_user_key(capabilities, "12345", scope_id="T_ALPHA")
    key_b = compose_external_user_key(capabilities, "12345", scope_id="T_BETA")

    # global uniqueness: embedding a workspace id would be noise, not signal
    assert key_a == key_b
