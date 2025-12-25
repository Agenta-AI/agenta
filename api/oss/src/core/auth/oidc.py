"""OIDC helper utilities for authorization and token exchange."""

import secrets
import httpx
from typing import Dict, Any, Optional
from urllib.parse import urlencode


class OIDCState:
    """Manages OIDC state for CSRF protection."""

    def __init__(self, provider_id: str, redirect_uri: str):
        self.state_id = secrets.token_urlsafe(32)
        self.nonce = secrets.token_urlsafe(32)
        self.provider_id = provider_id
        self.redirect_uri = redirect_uri

    def to_dict(self) -> Dict[str, str]:
        return {
            "state_id": self.state_id,
            "nonce": self.nonce,
            "provider_id": self.provider_id,
            "redirect_uri": self.redirect_uri,
        }


class OIDCClient:
    """OIDC client for building authorization URLs and exchanging tokens."""

    def __init__(self, config: Dict[str, Any], callback_url: str):
        self.issuer = config["issuer"]
        self.client_id = config["client_id"]
        self.client_secret = config["client_secret"]
        self.scopes = config.get("scopes", ["openid", "profile", "email"])
        self.callback_url = callback_url

        # Endpoints can be explicit or discovered
        self.authorization_endpoint = config.get("authorization_endpoint")
        self.token_endpoint = config.get("token_endpoint")
        self.userinfo_endpoint = config.get("userinfo_endpoint")

    async def discover_endpoints(self):
        """Discover OIDC endpoints from .well-known/openid-configuration."""
        if not self.authorization_endpoint or not self.token_endpoint:
            discovery_url = f"{self.issuer}/.well-known/openid-configuration"
            async with httpx.AsyncClient() as client:
                response = await client.get(discovery_url)
                response.raise_for_status()
                config = response.json()

                self.authorization_endpoint = config["authorization_endpoint"]
                self.token_endpoint = config["token_endpoint"]
                self.userinfo_endpoint = config.get("userinfo_endpoint")

    def build_authorization_url(self, state: OIDCState) -> str:
        """Build the OIDC authorization URL."""
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.callback_url,
            "response_type": "code",
            "scope": " ".join(self.scopes),
            "state": state.state_id,
            "nonce": state.nonce,
        }
        return f"{self.authorization_endpoint}?{urlencode(params)}"

    async def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """Exchange authorization code for tokens."""
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": self.callback_url,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_endpoint,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            return response.json()

    async def get_userinfo(self, access_token: str) -> Dict[str, Any]:
        """Fetch user info from the userinfo endpoint."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.userinfo_endpoint,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json()
