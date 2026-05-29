"""Environment-only configuration for the Agenta MCP server."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """Runtime settings loaded from environment variables.

    The Agenta API key carries project scope. Do not add project_id here.
    """

    api_key: str
    api_url: str = "https://cloud.agenta.ai/api"
    auth_scheme: str = "ApiKey"
    mcp_transport: str = "stdio"
    mcp_port: int = 8001
    mcp_host: str = "0.0.0.0"

    @classmethod
    def from_env(cls) -> "Settings":
        api_key = os.getenv("AGENTA_API_KEY", "").strip()
        if not api_key:
            raise ValueError("AGENTA_API_KEY is required")

        api_url = os.getenv("AGENTA_API_URL", cls.api_url).strip().rstrip("/")
        auth_scheme = os.getenv("AGENTA_AUTH_SCHEME", cls.auth_scheme).strip()
        transport = os.getenv("AGENTA_MCP_TRANSPORT", cls.mcp_transport).strip() or "stdio"
        host = os.getenv("MCP_HOST", cls.mcp_host).strip() or cls.mcp_host

        port_raw = os.getenv("MCP_PORT", str(cls.mcp_port)).strip()
        try:
            port = int(port_raw)
        except ValueError as exc:
            raise ValueError(f"MCP_PORT must be an integer, got {port_raw!r}") from exc

        return cls(
            api_key=api_key,
            api_url=api_url,
            auth_scheme=auth_scheme,
            mcp_transport=transport,
            mcp_port=port,
            mcp_host=host,
        )

    @property
    def authorization_value(self) -> str:
        """Return the Authorization header value.

        `ApiKey <key>` is the confirmed Agenta convention. Set
        AGENTA_AUTH_SCHEME to an empty string or `bare` for a raw key when
        testing non-standard deployments.
        """

        if not self.auth_scheme or self.auth_scheme.lower() == "bare":
            return self.api_key
        return f"{self.auth_scheme} {self.api_key}"
