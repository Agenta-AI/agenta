"""Sign-ins to a project MCP server: where they are stored and when one is ready.

A sign-in is a vault row at a slug that the server's id and `auth_mode` give: an OAuth
grant at `grant_slug`, or a token at `token_slug`. The project holds a grant there, and
each person may hold their own grant or token there, in their own rows. A person's
sign-in serves every agent of the project, so nothing here names an agent.
"""

from typing import Optional

from oss.src.core.gateways.mcps.dtos import MCPAuthScheme, MCPEndpoint
from oss.src.core.gateways.mcps.oauth.storage import grant_slug, token_slug
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import SecretKind


def sign_in_slug(endpoint: MCPEndpoint) -> Optional[str]:
    """The slug of a person's sign-in to this server, or None for a server that takes
    no sign-in."""
    if endpoint.id is None:
        return None
    if endpoint.auth_mode == MCPAuthScheme.OAUTH:
        return grant_slug(endpoint.id)
    if endpoint.auth_mode == MCPAuthScheme.API_KEY:
        return token_slug(endpoint.id)
    return None


def sign_in_kind(endpoint: MCPEndpoint) -> Optional[SecretKind]:
    """The vault kind of a person's sign-in to this server."""
    if endpoint.auth_mode == MCPAuthScheme.OAUTH:
        return SecretKind.OAUTH_GRANT
    if endpoint.auth_mode == MCPAuthScheme.API_KEY:
        return SecretKind.MCP_TOKEN
    return None


def is_sign_in_of(endpoint: MCPEndpoint, row: SecretResponseDTO) -> bool:
    """Whether a stored row is a sign-in to this server in its current mode."""
    slug = sign_in_slug(endpoint)
    return slug is not None and row.slug == slug and row.kind == sign_in_kind(endpoint)


def is_sign_in_ready(row: SecretResponseDTO, *, now: float) -> bool:
    """A token is always ready. A grant is ready unless it has expired and has no
    refresh token to renew it (the rule of `ItemAccount.is_ready`)."""
    if row.kind != SecretKind.OAUTH_GRANT:
        return True
    grant = getattr(row.data, "grant", None)
    if grant is None:
        return False
    expired = grant.expires_at is not None and grant.expires_at <= now
    return not expired or bool(grant.refresh_token)
