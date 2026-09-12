"""Deployment-specific endpoint URL grammar for the LLM gateway.

The generic registration gate owns SSRF protection.  This module owns the
*meaning* of a deployment's ``base_url``: a Bedrock deployment accepts an
origin only, while Vertex accepts exactly its common projects/locations prefix.
Keeping this beside URL composition makes it impossible for a new protocol door
to reinterpret arbitrary user-supplied path segments.
"""

import ipaddress
import re
from urllib.parse import urlparse

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind


_VERTEX_PREFIX = re.compile(
    r"^/v1/projects/[A-Za-z0-9][A-Za-z0-9._-]*/locations/"
    r"[A-Za-z0-9][A-Za-z0-9._-]*$"
)
_HOST_LABEL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def _valid_host(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        pass
    try:
        normalized = hostname.encode("idna").decode("ascii").rstrip(".")
    except UnicodeError:
        return False
    return bool(normalized) and all(
        _HOST_LABEL.fullmatch(label) for label in normalized.split(".")
    )


def _parsed_http_url(base_url: str):
    """Return a syntactically usable HTTP URL or raise a public ValueError.

    This is deliberately not a second egress policy.  The router still calls
    ``validate_url_format_and_literal_ip`` after this validation, so private
    networks and plaintext remain governed by the deployment's egress policy.
    """
    parsed = urlparse(base_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or not _valid_host(parsed.hostname)
    ):
        raise ValueError("must be an absolute http(s) URL with a host")
    if parsed.username or parsed.password:
        raise ValueError("must not contain user credentials")
    if parsed.query or parsed.fragment:
        raise ValueError("must not contain a query string or fragment")
    try:
        # Accessing ``port`` validates its numeric range too.
        parsed.port
    except ValueError as exc:
        raise ValueError("contains an invalid port") from exc
    return parsed


def validate_deployment_base_url(
    *, deployment_kind: LLMDeploymentKind, base_url: str | None
) -> None:
    """Validate a non-secret deployment URL before it is stored.

    ``None`` remains valid: Bedrock and Vertex can derive their public endpoint
    from the separately stored region/project fields.  An explicitly supplied
    URL, however, is never a free-form prefix for either deployment.
    """
    if base_url is None or deployment_kind not in {
        LLMDeploymentKind.BEDROCK,
        LLMDeploymentKind.VERTEX,
    }:
        return

    parsed = _parsed_http_url(base_url)
    path = parsed.path.rstrip("/")

    if deployment_kind == LLMDeploymentKind.BEDROCK:
        if path:
            raise ValueError(
                "Bedrock base_url must be an origin (scheme, host, and optional port)"
            )
        return

    if deployment_kind == LLMDeploymentKind.VERTEX and not _VERTEX_PREFIX.fullmatch(
        path
    ):
        raise ValueError(
            "Vertex base_url must be an origin followed by "
            "/v1/projects/{project}/locations/{region}"
        )
