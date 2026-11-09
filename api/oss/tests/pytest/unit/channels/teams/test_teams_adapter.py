import base64
import io
import json
import zipfile
from uuid import UUID, uuid5

import pytest

from oss.src.core.channels.adapters.teams import package
from oss.src.core.channels.dtos import (
    ChannelConnectionCreate,
    ChannelRequestContext,
    ChannelSetupIdentity,
)
from oss.src.core.channels.types import (
    ChannelConnectionVerificationFailed,
    ChannelSignatureInvalid,
)
from oss.src.utils.env import env

from . import fake_teams as f
from . import payloads as p


@pytest.fixture
def fake():
    return f.FakeMicrosoft()


@pytest.fixture
def adapter(fake):
    return f.adapter_for(fake)


def _create(app_id=p.APP_ID, tenant_id=p.TENANT_ID):
    return ChannelConnectionCreate(
        channel="teams", data={"app_id": app_id, "tenant_id": tenant_id}
    )


# --- verify_connection --------------------------------------------------- #


async def test_a_token_from_microsoft_verifies_the_connection(adapter, fake):
    discovered = await adapter.verify_connection(
        connection=_create(), credentials={"client_secret": p.CLIENT_SECRET}
    )

    assert discovered == {
        "app_id": p.APP_ID,
        "tenant_id": p.TENANT_ID,
        "webhook_url": f"{env.agenta.api_url.rstrip('/')}/channels/teams/events/",
    }
    (request,) = fake.token_requests
    assert request["tenant_id"] == p.TENANT_ID
    assert request["host"] == "login.microsoftonline.com"
    assert request["grant_type"] == "client_credentials"
    assert request["client_id"] == p.APP_ID
    assert request["client_secret"] == p.CLIENT_SECRET
    assert request["scope"] == "https://api.botframework.com/.default"


async def test_ids_are_stored_in_lowercase(adapter):
    discovered = await adapter.verify_connection(
        connection=_create(app_id=p.APP_ID.upper(), tenant_id=p.TENANT_ID.upper()),
        credentials={"client_secret": p.CLIENT_SECRET},
    )

    assert discovered["app_id"] == p.APP_ID
    assert discovered["tenant_id"] == p.TENANT_ID


async def test_rotation_reads_the_stored_app_id(adapter, fake):
    stored = ChannelConnectionCreate(
        channel="teams",
        data={"connection_locator": {"app_id": p.APP_ID}, "tenant_id": p.TENANT_ID},
    )

    await adapter.verify_connection(
        connection=stored, credentials={"client_secret": "new-secret"}
    )

    assert fake.token_requests[0]["client_id"] == p.APP_ID


@pytest.mark.parametrize(
    "error, code, message",
    [
        (
            "invalid_client",
            7000215,
            "Microsoft rejected this client secret. Copy the secret's Value, "
            "not its Secret ID.",
        ),
        (
            "invalid_client",
            7000222,
            "Microsoft rejected this client secret. Copy the secret's Value, "
            "not its Secret ID.",
        ),
        (
            "unauthorized_client",
            700016,
            "Microsoft found no application with this ID in this tenant.",
        ),
        (
            "invalid_request",
            90002,
            "Microsoft found no directory with this tenant ID.",
        ),
        (
            "temporarily_unavailable",
            50001,
            "Could not check these values with Microsoft. Try again.",
        ),
    ],
)
async def test_each_refusal_has_its_message(adapter, fake, error, code, message):
    fake.refuse_token(status=400, error=error, code=code)

    with pytest.raises(ChannelConnectionVerificationFailed) as caught:
        await adapter.verify_connection(
            connection=_create(), credentials={"client_secret": p.CLIENT_SECRET}
        )

    assert str(caught.value) == message
    assert p.CLIENT_SECRET not in str(caught.value.__cause__)


async def test_a_server_error_without_a_body_is_a_generic_failure(adapter, fake):
    fake.token_status = 503
    fake.token_body = {}

    with pytest.raises(ChannelConnectionVerificationFailed) as caught:
        await adapter.verify_connection(
            connection=_create(), credentials={"client_secret": p.CLIENT_SECRET}
        )

    assert (
        str(caught.value) == "Could not check these values with Microsoft. Try again."
    )


async def test_no_answer_is_a_generic_failure():
    import httpx

    from oss.src.core.channels.adapters.teams.adapter import TeamsAdapter

    def unreachable(request):
        raise httpx.ConnectError("down", request=request)

    adapter = TeamsAdapter(
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(unreachable))
    )

    with pytest.raises(ChannelConnectionVerificationFailed) as caught:
        await adapter.verify_connection(
            connection=_create(), credentials={"client_secret": p.CLIENT_SECRET}
        )

    assert (
        str(caught.value) == "Could not check these values with Microsoft. Try again."
    )


# --- the app package ----------------------------------------------------- #


def _unzip(document):
    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(document.content)))
    return {name: archive.read(name) for name in archive.namelist()}


async def test_the_package_holds_the_manifest_and_two_icons(adapter):
    document = await adapter.build_setup_document(
        request_url="https://unused/", locator={"app_id": p.APP_ID}
    )

    assert document.format == "zip"
    assert document.filename.endswith(".zip")
    assert document.link is None
    files = _unzip(document)
    assert set(files) == {"manifest.json", "color.png", "outline.png"}
    manifest = json.loads(files["manifest.json"])
    assert manifest["bots"][0]["botId"] == p.APP_ID
    assert manifest["bots"][0]["scopes"] == ["personal", "groupChat", "team"]
    assert "webApplicationInfo" not in manifest
    assert "authorization" not in manifest
    assert manifest["icons"] == {"color": "color.png", "outline": "outline.png"}


async def test_the_manifest_id_is_stable_for_one_app_id(adapter):
    first = await adapter.build_setup_document(
        request_url="https://unused/", locator={"app_id": p.APP_ID}
    )
    second = await adapter.build_setup_document(
        request_url="https://unused/", locator={"app_id": p.APP_ID}
    )

    one = json.loads(_unzip(first)["manifest.json"])
    two = json.loads(_unzip(second)["manifest.json"])
    assert one["id"] == two["id"] == str(uuid5(package.MANIFEST_ID_NAMESPACE, p.APP_ID))
    assert one["version"] == two["version"] == package.MANIFEST_VERSION
    assert first.content == second.content
    assert UUID(one["id"]).version == 5


async def test_the_manifest_text_defaults_and_developer_fields(adapter):
    document = await adapter.build_setup_document(
        request_url="https://unused/", locator={"app_id": p.APP_ID}
    )

    manifest = json.loads(_unzip(document)["manifest.json"])
    assert manifest["name"]["short"] == "Agenta"
    assert manifest["description"]["short"] == "An Agenta agent."
    assert manifest["developer"] == {
        "name": "Agenta",
        "websiteUrl": env.agenta.web_url,
        "privacyUrl": env.agenta.web_url,
        "termsOfUseUrl": env.agenta.web_url,
    }


async def test_a_long_name_is_cut_to_thirty_characters(adapter):
    name = "  Support desk agent for the whole EMEA team  "
    document = await adapter.build_setup_document(
        request_url="https://unused/",
        identity=ChannelSetupIdentity(name=name, description="Line one\nline two"),
        locator={"app_id": p.APP_ID},
    )

    manifest = json.loads(_unzip(document)["manifest.json"])
    assert manifest["name"]["short"] == "Support desk agent for the who"
    assert len(manifest["name"]["short"]) <= 30
    assert manifest["name"]["full"] == name.strip()
    assert manifest["description"]["short"] == "Line one line two"


async def test_no_app_id_gives_no_document(adapter):
    assert await adapter.build_setup_document(request_url="https://unused/") is None
    assert (
        await adapter.build_setup_document(request_url="https://unused/", locator={})
        is None
    )


# --- ingress ------------------------------------------------------------- #


def test_the_locator_reads_the_recipient(adapter):
    request = ChannelRequestContext(
        headers={}, path="/channels/teams/events/", body=p.encode(p.message())
    )

    assert adapter.connection_locator(request=request) == {"app_id": p.APP_ID}


def test_a_body_without_a_recipient_has_no_locator(adapter):
    request = ChannelRequestContext(headers={}, path="/", body=b"{}")

    assert adapter.connection_locator(request=request) is None


async def test_a_signed_request_returns_the_bare_app_id(adapter):
    request = ChannelRequestContext(
        headers=f.auth_headers(f.sign_token(audience=f"api://botid-{p.APP_ID}")),
        path="/channels/teams/events/",
        body=p.encode(p.message()),
    )

    assert (
        await adapter.verify_signature(request=request, connection=p.connection())
        == p.APP_ID
    )


async def test_a_token_for_another_service_url_is_refused(adapter):
    activity = p.message()
    activity["serviceUrl"] = "https://smba.trafficmanager.net/emea/"
    request = ChannelRequestContext(
        headers=f.auth_headers(), path="/", body=p.encode(activity)
    )

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(request=request, connection=p.connection())


async def test_a_foreign_tenant_is_dropped(adapter):
    activity = p.message(text="hi", tenant_id=p.OTHER_TENANT_ID)

    assert (
        await adapter.parse_event(body=p.encode(activity), connection=p.connection())
        is None
    )


async def test_the_tenant_falls_back_to_the_conversation(adapter):
    activity = p.message(text="hi")
    activity.pop("channelData")

    event = await adapter.parse_event(
        body=p.encode(activity), connection=p.connection()
    )

    assert event is not None and event.external_locator["tenant_id"] == p.TENANT_ID


async def test_the_same_tenant_parses_and_keys_on_the_activity_id(adapter):
    event = await adapter.parse_event(
        body=p.encode(p.message(text="hi", activity_id="1700000000999")),
        connection=p.connection(),
    )

    assert event.external_id == "1700000000999"


@pytest.mark.parametrize(
    "activity",
    [
        p.message(type="installationUpdate", action="remove"),
        p.message(
            type="conversationUpdate",
            membersAdded=[{"id": f"28:{p.APP_ID}"}],
        ),
        p.message(type="messageReaction"),
        p.message(type="invoke", name="adaptiveCard/action"),
    ],
    ids=["uninstall", "bot added", "reaction", "invoke"],
)
async def test_other_activities_write_nothing_and_never_deactivate(adapter, activity):
    body = p.encode(activity)

    assert await adapter.parse_event(body=body, connection=p.connection()) is None
    assert await adapter.detect_deactivation(body=body) is False


async def test_no_connection_parses_nothing(adapter):
    assert await adapter.parse_event(body=p.encode(p.message())) is None


async def test_discover_spaces_returns_nothing(adapter):
    assert await adapter.discover_spaces(connection=p.connection()) == []
