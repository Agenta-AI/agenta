"""The run person's own secrets, read in one call (`POST /secrets/resolve`)."""

from agenta.sdk.agents.platform import secrets
from agenta.sdk.agents.platform.secrets import resolve_user_secrets


async def test_user_secrets_are_read_in_one_call(fake_http, connection):
    capture = fake_http(
        secrets,
        payload={
            "count": 1,
            "item_secrets": [
                {
                    "item_key": "secret:user/GITHUB_TOKEN",
                    "secret": {
                        "kind": "custom_secret",
                        "data": {"secret": {"format": "text", "content": "g"}},
                    },
                }
            ],
        },
    )
    resolved = await resolve_user_secrets(
        ["secret:user/GITHUB_TOKEN", "secret:user/OTHER"], connection=connection
    )
    assert resolved == {"secret:user/GITHUB_TOKEN": "g"}
    assert capture["method"] == "POST"
    assert capture["url"] == "https://api.x/api/secrets/resolve"


async def test_no_keys_make_no_call(fake_http, connection):
    capture = fake_http(secrets, payload={})
    assert await resolve_user_secrets([], connection=connection) == {}
    assert capture == {}
