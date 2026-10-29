from agenta_client.core.jsonable_encoder import jsonable_encoder
from agenta_client.types.provider_credentials import ProviderCredentials


def test_provider_credentials_hide_secrets_from_display_but_keep_wire_values():
    key_canary = "key-canary-must-not-appear"
    extras_canary = "extras-canary-must-not-appear"
    credentials = ProviderCredentials(
        key=key_canary,
        url="https://provider.example/v1",
        extras={"authorization": extras_canary},
    )

    for displayed in (repr(credentials), str(credentials)):
        assert key_canary not in displayed
        assert extras_canary not in displayed
        assert "https://provider.example/v1" in displayed

    expected = {
        "key": key_canary,
        "url": "https://provider.example/v1",
        "version": None,
        "extras": {"authorization": extras_canary},
    }
    assert credentials.model_dump() == expected
    assert jsonable_encoder(credentials) == {
        key: value for key, value in expected.items() if value is not None
    }
