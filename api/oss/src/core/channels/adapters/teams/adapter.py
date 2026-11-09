import re
from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.teams import mapping, package
from oss.src.core.channels.adapters.teams.capabilities import (
    fetch_teams_capabilities,
)
from oss.src.core.channels.adapters.teams.signature import (
    BotFrameworkKeys,
    bearer_token,
    verify_token,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelInboundEvent,
    ChannelRequestContext,
    ChannelSetupDoc,
    ChannelSetupIdentity,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelConnectionVerificationFailed,
)
from oss.src.utils.env import env

_TOKEN_URL = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
_TOKEN_SCOPE = "https://api.botframework.com/.default"
_HTTP_TIMEOUT_SECONDS = 10.0

# Microsoft Entra error codes (AADSTS<code>) that verify_connection names.
_INVALID_CLIENT_SECRET = 7000215
_APPLICATION_NOT_FOUND = 700016
_TENANT_NOT_FOUND = 90002
_AADSTS_CODE = re.compile(r"AADSTS(\d+)")

_SECRET_REJECTED = (
    "Microsoft rejected this client secret. Copy the secret's Value, not its Secret ID."
)
_APPLICATION_UNKNOWN = "Microsoft found no application with this ID in this tenant."
_TENANT_UNKNOWN = "Microsoft found no directory with this tenant ID."
_CHECK_FAILED = "Could not check these values with Microsoft. Try again."


def _data(connection: ChannelConnection | ChannelConnectionCreate) -> Dict[str, Any]:
    return connection.data if isinstance(connection.data, dict) else {}


def _app_id(connection: ChannelConnection | ChannelConnectionCreate) -> str:
    """The bare app id, from a stored connection (under `connection_locator`)
    or from a create or rotate request (flat, as the user typed it)."""

    data = _data(connection)
    locator = data.get("connection_locator")
    value = locator.get("app_id") if isinstance(locator, dict) else None
    value = mapping.bare_app_id(value or data.get("app_id"))
    if not value:
        raise ChannelConnectionIncomplete(channel="teams", field="app_id")
    return value


def _tenant_id(connection: ChannelConnection | ChannelConnectionCreate) -> str:
    value = _data(connection).get("tenant_id")
    if not isinstance(value, str) or not value.strip():
        raise ChannelConnectionIncomplete(channel="teams", field="tenant_id")
    return value.strip().lower()


class TeamsAdapter(ChannelAdapterInterface):
    """A Teams bot the user registers in their own Microsoft tenant: the
    application (client) id, a client secret and the directory (tenant) id.

    Teams POSTs every activity to the one messaging endpoint with a JWT that
    the Bot Framework signed. Replies go to the activity's `serviceUrl` with
    an access token from Microsoft Entra."""

    channel = "teams"

    def __init__(self, *, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = http_client or httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS)
        self._keys = BotFrameworkKeys(http_client=self._client)

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_teams_capabilities()

    # --- setup --- #

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Ask Microsoft for an access token with the three values. A refusal
        stores nothing. Rotation calls this too, with the stored data and only
        the new secret."""

        app_id = _app_id(connection)
        tenant_id = _tenant_id(connection)
        client_secret = (credentials or {}).get("client_secret")
        if not client_secret:
            raise ChannelConnectionIncomplete(
                channel=self.channel, field="client_secret"
            )

        try:
            await self._request_token(
                app_id=app_id, tenant_id=tenant_id, client_secret=client_secret
            )
        except _TokenRequestRefused as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel, message=e.user_message
            ) from e
        except httpx.HTTPError as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel, message=_CHECK_FAILED
            ) from e

        base_url = (env.agenta.api_url or "").rstrip("/")
        return {
            "app_id": app_id,
            "tenant_id": tenant_id,
            "webhook_url": f"{base_url}/channels/teams/events/",
        }

    async def build_setup_document(
        self,
        *,
        request_url: str,
        identity: Optional[ChannelSetupIdentity] = None,
        locator: Optional[Dict[str, Any]] = None,
    ) -> Optional[ChannelSetupDoc]:
        app_id = mapping.bare_app_id((locator or {}).get("app_id"))
        if not app_id:
            return None
        return package.build_setup_document(app_id=app_id, identity=identity)

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        activity = mapping.parse_body(request.body)
        app_id = mapping.bare_app_id((activity.get("recipient") or {}).get("id"))
        return {"app_id": app_id} if app_id else None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        app_id = _app_id(connection)
        await verify_token(
            token=bearer_token(request.headers),
            app_id=app_id,
            service_url=mapping.parse_body(request.body).get("serviceUrl"),
            keys=self._keys,
        )
        return app_id

    async def parse_event(
        self,
        *,
        body: bytes,
        connection: Optional[ChannelConnection] = None,
        request: Optional[ChannelRequestContext] = None,
    ) -> Optional[ChannelInboundEvent]:
        """A message or a card click, or None for any other activity and for
        an activity from a tenant other than the connected one."""

        if connection is None:
            return None
        activity = mapping.parse_body(body)
        if mapping.tenant_id(activity) != _tenant_id(connection):
            return None
        return mapping.parse_activity(activity, app_id=_app_id(connection))

    async def detect_deactivation(self, *, body: bytes) -> bool:
        # Teams reports an uninstall per chat and per team, so one removal
        # must not switch the bot off everywhere.
        return False

    # --- egress --- #

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        raise NotImplementedError("Teams replies are not built yet.")

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        raise NotImplementedError("Teams replies are not built yet.")

    async def dismiss_choices(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        raise NotImplementedError("Teams replies are not built yet.")

    async def signal_activity(
        self, *, connection: ChannelConnection, locator: Dict[str, Any]
    ) -> None:
        raise NotImplementedError("Teams replies are not built yet.")

    # --- discovery and history --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        # Spaces register on their first message.
        return []

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        raise NotImplementedError("Teams history is not read; backfill is off.")

    # --- internals --- #

    async def _request_token(
        self, *, app_id: str, tenant_id: str, client_secret: str
    ) -> Dict[str, Any]:
        """The client credentials request. Raises _TokenRequestRefused when
        Microsoft answers with an error, httpx.HTTPError when it does not
        answer."""

        response = await self._client.post(
            _TOKEN_URL.format(tenant_id=tenant_id),
            data={
                "grant_type": "client_credentials",
                "client_id": app_id,
                "client_secret": client_secret,
                "scope": _TOKEN_SCOPE,
            },
        )
        try:
            body = response.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        if response.status_code < 400 and body.get("access_token"):
            return body
        raise _TokenRequestRefused(status_code=response.status_code, body=body)


class _TokenRequestRefused(Exception):
    """Microsoft refused the client credentials request. Carries Microsoft's
    error code and the message to show the user, never the secret."""

    def __init__(self, *, status_code: int, body: Dict[str, Any]):
        self.status_code = status_code
        self.error = str(body.get("error") or "")
        codes = {
            code for code in body.get("error_codes") or [] if isinstance(code, int)
        }
        codes |= {
            int(code)
            for code in _AADSTS_CODE.findall(str(body.get("error_description") or ""))
        }
        self.codes = codes
        super().__init__(
            f"Microsoft token request refused ({status_code}): "
            f"{self.error or 'unknown error'} {sorted(codes)}"
        )

    @property
    def user_message(self) -> str:
        if _APPLICATION_NOT_FOUND in self.codes:
            return _APPLICATION_UNKNOWN
        if _TENANT_NOT_FOUND in self.codes:
            return _TENANT_UNKNOWN
        if _INVALID_CLIENT_SECRET in self.codes or self.error == "invalid_client":
            return _SECRET_REJECTED
        return _CHECK_FAILED
