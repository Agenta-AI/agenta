"""Deployment-specific endpoint URL grammar for the LLM gateway.

The generic registration gate owns SSRF protection.  This module owns the
*meaning* of a deployment's ``base_url``: a Bedrock deployment accepts an
origin only, while Vertex accepts exactly its common projects/locations prefix.
Keeping this beside URL composition makes it impossible for a new protocol door
to reinterpret arbitrary user-supplied path segments.

The caller's model id lands in those same paths on Azure and Vertex, so its
admissible grammar lives here too rather than beside the ``f``-string that
interpolates it.
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

# One `/`-separated segment of a model identifier. The catalogue
# (`agenta.sdk.utils.assets.supported_llm_models`) spells every id it knows with letters,
# digits and `. _ - :` inside a segment — `openrouter/nvidia/nemotron-3-ultra:free`,
# `anthropic.claude-3-5-sonnet-20241022-v2:0` — and uses `/` only as a separator, both for
# provider-prefixed ids and for Agenta's own qualified `<provider>/<kind>/<model>` form.
_MODEL_SEGMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]*")


def is_path_safe_model_identifier(model: str) -> bool:
    """Whether a model id may be interpolated into a provider URL's path (OR60).

    Azure places the model in `/openai/deployments/{model}` and Vertex in
    `…/models/{model}:{action}`, so a value like `x/../..` walked out of the deployment's
    own prefix and reached arbitrary endpoints under the organisation's cloud credentials.

    Every `/`-separated segment must match the character class real model ids use, and no
    segment may be a run of dots — which is what excludes `.` and `..` while keeping
    `anthropic.claude-3-5-sonnet`. Percent-encoding is not used on top: `/` is a real
    separator in the qualified form, so escaping it would break the spelling live QA
    depends on, and within the admitted class only `:` is even reserved — and Vertex's
    `{model}:{action}` needs that colon to stay literal. The character class is the
    control; escaping would add nothing it does not already exclude.
    """
    if not model:
        return False
    return all(_MODEL_SEGMENT.fullmatch(segment) for segment in model.split("/"))


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
