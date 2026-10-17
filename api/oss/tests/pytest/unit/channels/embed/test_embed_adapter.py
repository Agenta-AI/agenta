"""EmbedAdapter on its own: the visitor key rule, the hashed space locator,
the parsed event, the setup document and the base64 uploads. No DB."""

import base64
import string
import json
from hashlib import sha256
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.embed.adapter import (
    EmbedAdapter,
    allowed_origins,
    sanitize_origins,
    visitor_key,
)
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionFlags,
    ChannelEventKind,
    ChannelRequestContext,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelSignatureInvalid,
)

KEY = string.ascii_letters[:40]  # a strong key: 40 distinct
OTHER_KEY = string.ascii_letters[10:50]
EMBED_ID = "Ab12_cd34-EF56gh78ij90"

WEAK_KEYS = [
    "short-but-random-abc123",  # under 32 characters
    string.ascii_letters[:40] + "!",  # a character outside base64url
    string.ascii_letters[:20] + " " + string.ascii_letters[20:40],  # a space
    "user-00000000000000000000000000042",  # fewer than 12 distinct
    "a" * 64,
    "",
]


def _connection(*, active=True, name="Support widget") -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="embed-connection",
        channel="embed",
        name=name,
        external_key=uuid4(),
        data={
            "connection_locator": {"embed": EMBED_ID},
            "allowed_origins": "https://tool.example.com",
        },
        flags=ChannelConnectionFlags(is_active=active, is_verified=True),
    )


def _request(key=KEY, body=b"") -> ChannelRequestContext:
    headers = {"X-Agenta-Visitor-Key": key} if key is not None else {}
    return ChannelRequestContext(
        headers=headers, path=f"/channels/embed/events/{EMBED_ID}/", body=body
    )


async def _parse(payload, *, key=KEY, connection=None):
    body = json.dumps(payload).encode()
    return await EmbedAdapter().parse_event(
        body=body,
        connection=connection or _connection(),
        request=_request(key, body),
    )


# --- the visitor key rule --------------------------------------------------- #


def test_a_strong_key_passes():
    assert visitor_key({"X-Agenta-Visitor-Key": KEY}) == KEY


@pytest.mark.parametrize("key", WEAK_KEYS)
def test_weak_keys_are_refused(key):
    assert visitor_key({"x-agenta-visitor-key": key}) is None


def test_a_missing_key_is_refused():
    assert visitor_key({}) is None


# --- ingress ---------------------------------------------------------------- #


def test_connection_locator_reads_the_embed_id_from_the_path():
    adapter = EmbedAdapter()
    for prefix in ("/channels", "/preview/channels"):
        request = ChannelRequestContext(
            headers={}, path=f"{prefix}/embed/events/{EMBED_ID}/", body=b""
        )
        assert adapter.connection_locator(request=request) == {"embed": EMBED_ID}


def test_connection_locator_is_none_off_the_embed_path():
    request = ChannelRequestContext(
        headers={}, path="/channels/agenta/events/", body=b""
    )
    assert EmbedAdapter().connection_locator(request=request) is None


async def test_verify_signature_returns_the_embed_id():
    result = await EmbedAdapter().verify_signature(
        request=_request(), connection=_connection()
    )
    assert result == EMBED_ID


@pytest.mark.parametrize("key", WEAK_KEYS + [None])
async def test_verify_signature_refuses_a_weak_or_missing_key(key):
    with pytest.raises(ChannelSignatureInvalid):
        await EmbedAdapter().verify_signature(
            request=_request(key), connection=_connection()
        )


async def test_verify_signature_refuses_an_inactive_connection():
    with pytest.raises(ChannelSignatureInvalid):
        await EmbedAdapter().verify_signature(
            request=_request(), connection=_connection(active=False)
        )


async def test_the_space_is_the_key_hash_and_the_raw_key_is_never_stored():
    event = await _parse({"text": "hello", "displayName": "Ada"})

    key_hash = sha256(KEY.encode()).hexdigest()
    assert event.space_kind == ChannelSpaceKind.PRIVATE
    assert event.external_locator == {"visitor": key_hash, "thread": key_hash}
    assert event.addressed is True
    assert event.processed.content == [{"type": "text", "text": "hello"}]
    assert event.processed.sender == {
        "id": key_hash[:16],
        "name": "Ada",
        "platform": "Support widget",
    }
    assert KEY not in event.model_dump_json()


async def test_context_is_carried_and_a_non_object_is_dropped():
    event = await _parse({"text": "hi", "context": {"page": "/orders/42"}})
    assert event.processed.context == {"page": "/orders/42"}

    event = await _parse({"text": "hi", "context": "not an object"})
    assert event.processed.context is None


async def test_display_name_is_flattened_and_capped():
    event = await _parse({"text": "hi", "displayName": "Ada\n\nLovelace " + "x" * 200})
    name = event.processed.sender["name"]
    assert "\n" not in name and len(name) == 80


async def test_the_same_body_from_two_keys_gives_two_external_ids():
    first = await _parse({"text": "hello"})
    second = await _parse({"text": "hello"}, key=OTHER_KEY)
    again = await _parse({"text": "hello"})

    assert first.external_id != second.external_id
    assert first.external_id == again.external_id


async def test_a_client_id_is_namespaced_by_the_key():
    first = await _parse({"id": "m-1", "text": "hello"})
    retry = await _parse({"id": "m-1", "text": "hello again"})
    other = await _parse({"id": "m-1", "text": "hello"}, key=OTHER_KEY)

    assert first.external_id == retry.external_id
    assert first.external_id != other.external_id


async def test_an_action_carries_its_token():
    event = await _parse({"type": "action", "token": "approve:abc"})
    assert event.kind == ChannelEventKind.ACTION
    assert event.processed.content == [{"type": "text", "text": "approve:abc"}]


async def test_nothing_to_act_on_gives_no_event():
    assert await _parse({"text": "   "}) is None
    assert await _parse({"type": "action"}) is None
    assert await _parse({"text": "hi"}, key="weak") is None


async def test_files_become_media_parts_that_fetch_media_decodes():
    data = base64.b64encode(b"%PDF-1.4 hello").decode()
    event = await _parse(
        {
            "text": "see attached",
            "files": [
                {"filename": "a.pdf", "media_type": "application/pdf", "data": data}
            ],
        }
    )
    media = event.processed.content[1]
    assert media["type"] == "media"
    assert media["media_id"] == f"{event.external_id}:0"
    assert media["filename"] == "a.pdf"

    fetched = await EmbedAdapter().fetch_media(connection=_connection(), media=media)
    assert fetched == (b"%PDF-1.4 hello", "application/pdf")


async def test_fetch_media_refuses_a_file_over_the_limit_and_bad_base64():
    media = {"data": base64.b64encode(b"x" * 100).decode()}
    adapter = EmbedAdapter()
    assert (
        await adapter.fetch_media(connection=_connection(), media=media, max_bytes=10)
        is None
    )

    with pytest.raises(ValueError):
        await adapter.fetch_media(
            connection=_connection(), media={"data": "not base64!"}
        )


# --- origins and setup ------------------------------------------------------ #


def test_origins_are_rebuilt_from_their_parts():
    raw = """https://tool.example.com
    http://localhost:3000/
    HTTPS://Upper.Example.com
    https://tool.example.com
    javascript:alert(1)
    https://evil.example.com; script-src *
    https://user:pass@example.com
    https://example.com/path
    https://a.example.com?x=1
    ftp://files.example.com
    https://bad_host.example.com
    https://example.com:99999"""
    assert sanitize_origins(raw) == [
        "https://tool.example.com",
        "http://localhost:3000",
        "https://upper.example.com",
    ]


def test_sanitize_origins_drops_the_default_port_like_a_browser():
    assert sanitize_origins("https://a.example.com:443 http://b.example.com:80") == [
        "https://a.example.com",
        "http://b.example.com",
    ]
    assert sanitize_origins("https://a.example.com:80") == ["https://a.example.com:80"]


def test_allowed_origins_reads_a_list_too():
    connection = _connection()
    connection.data["allowed_origins"] = ["https://a.example.com", 42, "nope"]
    assert allowed_origins(connection) == ["https://a.example.com"]


async def test_verify_connection_mints_an_embed_id():
    create = ChannelConnectionCreate(
        channel="embed", data={"allowed_origins": "https://tool.example.com"}
    )
    first = await EmbedAdapter().verify_connection(connection=create, credentials={})
    second = await EmbedAdapter().verify_connection(connection=create, credentials={})

    assert len(first["embed"]) >= 22
    assert first != second


async def test_verify_connection_refuses_no_usable_origin():
    create = ChannelConnectionCreate(channel="embed", data={"allowed_origins": "nope"})
    with pytest.raises(ChannelConnectionIncomplete):
        await EmbedAdapter().verify_connection(connection=create, credentials={})


async def test_setup_document_is_the_iframe_snippet():
    document = await EmbedAdapter().build_setup_document(
        request_url="http://api/channels/connections/x/setup",
        locator={"embed": EMBED_ID},
    )

    assert document.format == "html"
    assert f'/m/embed/{EMBED_ID}"' in document.content
    assert "agenta:init" in document.content
    assert "agenta:context" in document.content


async def test_setup_document_needs_a_connection():
    assert await EmbedAdapter().build_setup_document(request_url="http://api/") is None
