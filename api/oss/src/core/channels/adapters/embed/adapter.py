"""`EmbedAdapter` -- the public chat widget as a channel.

The credential is a visitor key in the `X-Agenta-Visitor-Key` header. It
proves nothing about who the visitor is; it only owns a space. Only its
SHA-256 hash is stored, as that space's locator. Replies post into our own
tables exactly as for `agenta`, so the post methods are inherited.
"""

import base64
import binascii
import html
import json
import re
import secrets
from hashlib import sha256
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.adapters.embed.capabilities import (
    fetch_embed_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelRequestContext,
    ChannelSetupDoc,
    ChannelSetupIdentity,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelSignatureInvalid,
)
from oss.src.utils.env import env

VISITOR_KEY_HEADER = "x-agenta-visitor-key"

# The server cannot measure randomness, so it refuses what it can see is weak:
# short, outside base64url, or few distinct characters. The upper bound only
# keeps a header from being arbitrarily large.
_VISITOR_KEY_RE = re.compile(r"[A-Za-z0-9_-]{32,256}")
_VISITOR_KEY_MIN_DISTINCT = 12

_PATH_EMBED_RE = re.compile(r"/embed/events/(?P<embed>[^/]+)")
_HOSTNAME_RE = re.compile(r"[a-z0-9.-]+")
_DISPLAY_NAME_MAX_CHARS = 80


def visitor_key(headers: Dict[str, str]) -> Optional[str]:
    """The request's visitor key, or None when it is missing or weak."""

    lowered = {k.lower(): v for k, v in headers.items()}
    key = lowered.get(VISITOR_KEY_HEADER) or ""
    if not _VISITOR_KEY_RE.fullmatch(key):
        return None
    if len(set(key)) < _VISITOR_KEY_MIN_DISTINCT:
        return None
    return key


def visitor_key_hash(key: str) -> str:
    return sha256(key.encode("utf-8")).hexdigest()


def visitor_locator(key: str) -> Dict[str, str]:
    """The visitor's space and thread locator: the key's hash, never the key."""

    key_hash = visitor_key_hash(key)
    return {"visitor": key_hash, "thread": key_hash}


# The config route's answer for an embed with no origin list: any site may frame it.
ANY_ORIGIN = "*"


def allowed_origins(connection: ChannelConnection) -> List[str]:
    """The connection's allowed origins as `scheme://host[:port]`, rebuilt from
    the parsed parts, or `["*"]` when the owner set none. A list whose entries
    are all unusable stays restricted to nothing: an edit skips the setup
    pattern, and these values go into a CSP header."""

    data = connection.data if isinstance(connection.data, dict) else {}
    raw = data.get("allowed_origins")
    if not _origin_entries(raw):
        return [ANY_ORIGIN]
    return sanitize_origins(raw)


_DEFAULT_PORTS = {"http": 80, "https": 443}


def _origin_entries(raw: Any) -> List[Any]:
    # Only None, blank text and [] are "no list"; any other type stays restricted.
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        return raw.split()
    return [] if raw is None else [raw]


def sanitize_origins(raw: Any) -> List[str]:
    """Each entry as `scheme://host[:port]`, where host may start with one `*.`
    label (any subdomain, as in CSP). Anything else is dropped."""

    origins: List[str] = []
    for value in _origin_entries(raw):
        if not isinstance(value, str):
            continue
        try:
            parts = urlsplit(value.strip())
            port = parts.port
        except ValueError:
            continue
        host = parts.hostname or ""
        name = host[2:] if host.startswith("*.") else host
        if parts.scheme not in ("http", "https") or not _HOSTNAME_RE.fullmatch(name):
            continue
        if parts.username or parts.password or parts.path not in ("", "/"):
            continue
        if parts.query or parts.fragment:
            continue
        # The browser's origin form drops the scheme's default port.
        if port == _DEFAULT_PORTS[parts.scheme]:
            port = None
        origin = f"{parts.scheme}://{host}" + (f":{port}" if port else "")
        if origin not in origins:
            origins.append(origin)
    return origins


class EmbedAdapter(AgentaAdapter):
    channel = "embed"

    def __init__(self) -> None:
        # Nothing to inject: no API key to resolve and no spaces to discover.
        pass

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_embed_capabilities()

    # --- setup --- #

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Mint the public embed id. Nothing is called. No origin list means
        any site; a list with no usable origin could never load, so it is
        refused here."""

        data = connection.data if isinstance(connection.data, dict) else {}
        raw = data.get("allowed_origins")
        if _origin_entries(raw) and not sanitize_origins(raw):
            raise ChannelConnectionIncomplete(
                channel=self.channel, field="allowed_origins"
            )
        return {"embed": secrets.token_urlsafe(16)}

    async def build_setup_document(
        self,
        *,
        request_url: str,
        identity: Optional[ChannelSetupIdentity] = None,
        locator: Optional[Dict[str, Any]] = None,
    ) -> Optional[ChannelSetupDoc]:
        embed_id = (locator or {}).get("embed")
        if not embed_id:
            return None

        web_url = (env.agenta.web_url or "").rstrip("/")
        parts = urlsplit(web_url)
        web_origin = f"{parts.scheme}://{parts.netloc}"
        src = html.escape(f"{web_url}/m/embed/{embed_id}", quote=True)
        target = json.dumps(web_origin)
        content = f"""<iframe
  id="agenta-chat"
  src="{src}"
  style="width: 400px; height: 600px; border: 0"
  allow="clipboard-write"
></iframe>

<!-- Optional: pass a visitor key, a display name or page context. -->
<script>
  const agentaChat = document.getElementById("agenta-chat");
  window.addEventListener("message", (event) => {{
    if (event.source !== agentaChat.contentWindow) return;
    if (event.data?.type !== "agenta:ready") return;
    agentaChat.contentWindow.postMessage(
      {{
        type: "agenta:init",
        // A random secret of at least 128 bits that you store per user.
        // Never a user id or an email.
        visitorKey: undefined,
        displayName: undefined,
        context: {{ page: location.pathname }},
      }},
      {target},
    );
  }});
  // Later, when the page changes:
  // agentaChat.contentWindow.postMessage(
  //   {{ type: "agenta:context", context: {{ page: location.pathname }} }},
  //   {target},
  // );
</script>
"""
        return ChannelSetupDoc(format="html", content=content, filename="embed.html")

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        match = _PATH_EMBED_RE.search(request.path or "")
        return {"embed": match.group("embed")} if match else None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        # No Origin check: the widget's requests carry Agenta's origin, not the
        # host page's. frame-ancestors and the CORS preflight guard browsers.
        if visitor_key(request.headers) is None or not connection.flags.is_active:
            raise ChannelSignatureInvalid(channel=self.channel)
        embed_id = _embed_id(connection)
        if not embed_id:
            raise ChannelSignatureInvalid(channel=self.channel)
        return embed_id

    async def parse_event(
        self,
        *,
        body: bytes,
        connection: Optional[ChannelConnection] = None,
        request: Optional[ChannelRequestContext] = None,
    ) -> Optional[ChannelInboundEvent]:
        key = visitor_key(request.headers) if request else None
        if key is None:
            return None
        payload = parse_body(body)
        locator = visitor_locator(key)
        key_hash = locator["visitor"]

        # Namespaced by the key hash: inbox dedup is per connection, and two
        # visitors may send the same body or the same client id.
        client_id = payload.get("id")
        seed = str(client_id).encode("utf-8") if client_id else body
        external_id = sha256(key_hash.encode("ascii") + b":" + seed).hexdigest()

        if payload.get("type") == "action":
            token = payload.get("token")
            if not isinstance(token, str) or not token:
                return None
            kind = ChannelEventKind.ACTION
            content: List[Dict[str, Any]] = [{"type": "text", "text": token}]
        else:
            kind = ChannelEventKind.MESSAGE
            content = _message_parts(payload, external_id=external_id)
            if not content:
                return None

        sender: Dict[str, Any] = {"id": key_hash[:16]}
        name = _display_name(payload.get("displayName"))
        if name:
            sender["name"] = name
        if connection is not None and connection.name:
            sender["platform"] = connection.name

        context = payload.get("context")
        return ChannelInboundEvent(
            external_id=external_id,
            kind=kind,
            space_kind=ChannelSpaceKind.PRIVATE,
            external_locator=locator,
            processed=ChannelInboxEventProcessed(
                content=content,
                sender=sender,
                context=context if isinstance(context, dict) and context else None,
            ),
            addressed=True,
        )

    # --- discovery --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        # A visitor space appears on its first message; nothing to list ahead.
        return []

    # --- media --- #

    async def fetch_media(
        self,
        *,
        connection: ChannelConnection,
        media: Dict[str, Any],
        max_bytes: Optional[int] = None,
    ) -> Optional[Tuple[bytes, Optional[str]]]:
        """The upload is already in the inbox row, as base64."""

        try:
            data = base64.b64decode(media.get("data") or "", validate=True)
        except (binascii.Error, ValueError) as e:
            raise ValueError("embed upload is not valid base64") from e
        limit = env.channels.embed.max_file_bytes
        if max_bytes is not None:
            limit = min(limit, max_bytes)
        if len(data) > limit:
            return None
        return data, media.get("mime_type")


def parse_body(body: bytes) -> Dict[str, Any]:
    try:
        payload = json.loads(body) if body else {}
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _embed_id(connection: ChannelConnection) -> Optional[str]:
    data = connection.data if isinstance(connection.data, dict) else {}
    locator = data.get("connection_locator")
    embed_id = locator.get("embed") if isinstance(locator, dict) else None
    return str(embed_id) if embed_id else None


def _display_name(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    name = " ".join(value.split())[:_DISPLAY_NAME_MAX_CHARS]
    return name or None


def _message_parts(
    payload: Dict[str, Any], *, external_id: str
) -> List[Dict[str, Any]]:
    parts: List[Dict[str, Any]] = []
    text = payload.get("text")
    if isinstance(text, str) and text.strip():
        parts.append({"type": "text", "text": text})
    files = payload.get("files")
    for index, file in enumerate(files if isinstance(files, list) else []):
        if not isinstance(file, dict) or not isinstance(file.get("data"), str):
            continue
        parts.append(
            {
                "type": "media",
                "kind": "document",
                "media_id": f"{external_id}:{index}",
                "filename": file.get("filename")
                if isinstance(file.get("filename"), str)
                else None,
                "mime_type": file.get("media_type")
                if isinstance(file.get("media_type"), str)
                else None,
                "data": file["data"],
            }
        )
    return parts
