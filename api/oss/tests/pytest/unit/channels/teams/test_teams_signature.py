import pytest

from oss.src.core.channels.adapters.teams import signature
from oss.src.core.channels.adapters.teams.signature import (
    BotFrameworkKeys,
    bearer_token,
    verify_token,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

from . import fake_teams as f
from . import payloads as p


@pytest.fixture
def fake():
    return f.FakeMicrosoft()


@pytest.fixture
def keys(fake):
    return BotFrameworkKeys(http_client=f.client_for(fake))


async def _verify(
    keys, token, *, service_url=p.SERVICE_URL, app_id=p.APP_ID, channel_id="msteams"
):
    await verify_token(
        token=token,
        app_id=app_id,
        service_url=service_url,
        channel_id=channel_id,
        keys=keys,
    )


@pytest.mark.parametrize(
    "audience", [p.APP_ID, f"api://{p.APP_ID}", f"api://botid-{p.APP_ID}"]
)
async def test_each_audience_form_is_accepted(keys, audience):
    await _verify(keys, f.sign_token(audience=audience))


async def test_a_trailing_slash_does_not_matter(keys):
    await _verify(
        keys,
        f.sign_token(service_url=p.SERVICE_URL.rstrip("/")),
        service_url=p.SERVICE_URL,
    )


@pytest.mark.parametrize(
    "token",
    [
        None,
        "",
        "not-a-jwt",
        f.sign_token(audience="ffffffff-ffff-4fff-8fff-ffffffffffff"),
        f.sign_token(
            issuer="https://sts.windows.net/f8cdef31-a31e-4b4a-93e4-5f571e91255a/"
        ),
        f.sign_token(expires_in=-301 - 60),
        f.sign_token(service_url="https://smba.trafficmanager.net/emea/"),
        f.sign_token(service_url=None),
        f.sign_token(private_key=f.OTHER_PRIVATE_KEY),
        f.sign_token(algorithm="RS512"),
    ],
    ids=[
        "missing",
        "empty",
        "garbage",
        "other bot",
        "emulator issuer",
        "expired beyond leeway",
        "service url mismatch",
        "no service url claim",
        "bad signature",
        "other algorithm",
    ],
)
async def test_a_bad_token_is_refused(keys, token):
    with pytest.raises(ChannelSignatureInvalid):
        await _verify(keys, token)


@pytest.mark.parametrize("channel_id", [None, "slack", "webchat"])
async def test_an_activity_from_another_channel_is_refused(keys, channel_id):
    with pytest.raises(ChannelSignatureInvalid):
        await _verify(keys, f.sign_token(), channel_id=channel_id)


@pytest.mark.parametrize("endorsements", [None, [], ["webchat"]])
async def test_a_key_not_endorsed_for_teams_is_refused(fake, keys, endorsements):
    fake.keys[0]["endorsements"] = endorsements

    with pytest.raises(ChannelSignatureInvalid):
        await _verify(keys, f.sign_token())


async def test_an_expired_token_within_the_leeway_is_accepted(keys):
    await _verify(keys, f.sign_token(expires_in=-120))


async def test_an_hs256_token_is_refused(keys):
    import jwt

    token = jwt.encode(
        {"iss": signature.ISSUER, "aud": p.APP_ID, "serviceurl": p.SERVICE_URL},
        "a-shared-secret-of-at-least-thirty-two-bytes",
        algorithm="HS256",
        headers={"kid": f.KEY_ID},
    )
    with pytest.raises(ChannelSignatureInvalid):
        await _verify(keys, token)


async def test_keys_are_read_once_and_reused(fake, keys):
    await _verify(keys, f.sign_token())
    await _verify(keys, f.sign_token())

    assert fake.key_reads == 1


async def test_an_unknown_key_id_reads_the_keys_again(fake, keys):
    await _verify(keys, f.sign_token())
    fake.keys.append(f.public_jwk(f.OTHER_PRIVATE_KEY, f.OTHER_KEY_ID))
    keys._attempted_at = None  # past the refresh interval

    await _verify(
        keys, f.sign_token(private_key=f.OTHER_PRIVATE_KEY, key_id=f.OTHER_KEY_ID)
    )

    assert fake.key_reads == 2


async def test_unknown_key_ids_read_the_keys_at_most_once_a_minute(fake, keys):
    await _verify(keys, f.sign_token())
    keys._attempted_at = None  # past the refresh interval
    for _ in range(3):
        with pytest.raises(ChannelSignatureInvalid):
            await _verify(keys, f.sign_token(key_id="unknown"))

    assert fake.key_reads == 2


async def test_keys_older_than_a_day_are_read_again(fake, keys):
    await _verify(keys, f.sign_token())
    keys._fetched_at -= 24 * 60 * 60 + 1
    keys._attempted_at -= 24 * 60 * 60 + 1

    await _verify(keys, f.sign_token())

    assert fake.key_reads == 2


async def test_a_failed_refresh_keeps_the_keys_already_held(fake, keys):
    await _verify(keys, f.sign_token())
    fake.keys = []
    keys._fetched_at -= 24 * 60 * 60 + 1
    keys._attempted_at = None

    await _verify(keys, f.sign_token())


def test_bearer_token_reads_the_authorization_header():
    assert bearer_token({"Authorization": "Bearer abc"}) == "abc"
    assert bearer_token({"authorization": "bearer abc"}) == "abc"
    assert bearer_token({"authorization": "Basic abc"}) is None
    assert bearer_token({}) is None
