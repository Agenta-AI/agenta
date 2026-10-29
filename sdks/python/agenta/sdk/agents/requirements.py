"""The items an agent names, and the requirement shape for an item that needs setup.

An agent names the exact model key, subscription login, MCP server, custom secret and
connected app it uses. This module reads those references out of a revision's parameters,
without checking anything, and builds the one requirement shape that the API check
(`POST /workflows/revisions/requirements/query`) and the run-start error
(`agent_needs_setup`) both return.

Pure: no I/O. The API decides each reason from its stores; the agent handler decides it
from the resolve calls it already makes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from agenta.sdk.engines.running.errors import ERRORS_BASE_URL, ErrorStatus

from .accounts import AccountSource, UserItem, read_user_items
from .connections import ModelRef
from .connections.errors import (
    ConnectionNotFoundError,
    MissingCredentialError,
    SubscriptionNotSupportedError,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)
from .mcp import MCPGatewayConnection, MCPServerConfig
from .tools import (
    CodeToolConfig,
    GatewayConnectionToolConfig,
    GatewayToolConfig,
    coerce_tool_configs,
)

KIND_MODEL_KEY = "model_key"
KIND_SUBSCRIPTION = "subscription"
KIND_MODEL = "model"
KIND_MCP_SERVER = "mcp_server"
KIND_MCP_SIGN_IN = "mcp_sign_in"
KIND_SECRET = "secret"
KIND_APP_CONNECTION = "app_connection"

# Only these block a run. Every other missing item is left out of the run.
MODEL_KINDS = frozenset({KIND_MODEL_KEY, KIND_SUBSCRIPTION, KIND_MODEL})

REASON_NOT_CHOSEN = "not_chosen"
REASON_NOT_FOUND = "not_found"
REASON_NOT_SHARED = "not_shared"
REASON_TURNED_OFF = "turned_off"
REASON_NEEDS_SIGN_IN = "needs_sign_in"
REASON_NOT_AVAILABLE = "not_available"
REASON_NEEDS_PERSONAL_ACCOUNT = "needs_personal_account"

AGENT_NEEDS_SETUP = "agent_needs_setup"
AGENT_NEEDS_SETUP_MESSAGE = "The model needs setup before this agent can run."


@dataclass
class ItemReference:
    """One item the agent names, with every configuration path that names it."""

    kind: str
    key: str
    label: str
    reference: Dict[str, Any]
    paths: List[str] = field(default_factory=list)
    account_source: AccountSource = "agent"


def user_item_reference(item: UserItem) -> ItemReference:
    """The requirement view of an item each person sets up with their own account. Its
    key is the item key, so the screens and the account choices name it the same way."""
    if item.kind == KIND_APP_CONNECTION:
        reference: Dict[str, Any] = {
            "provider": "composio",
            "integration": item.match_text,
        }
    elif item.kind == KIND_MCP_SERVER:
        reference = {"type": "gateway", "namespace": "custom", "slug": item.match_text}
    elif item.kind == KIND_SECRET:
        reference = {"name": item.match_text}
    else:
        reference = {"login": item.match_text}
    return ItemReference(
        kind=item.kind,
        key=item.item_key,
        label=item.match_text,
        reference={**reference, "account_source": "user"},
        paths=list(item.paths),
        account_source="user",
    )


@dataclass
class LlmReference:
    """The model the agent runs and the connection that pays for it."""

    model: str
    provider: Optional[str]
    mode: str
    slug: Optional[str]
    namespace: Optional[str]
    scope: Optional[str]
    harness: Optional[str]
    prefix: str
    account_source: AccountSource = "agent"

    @property
    def is_organization(self) -> bool:
        return self.scope == "organization"

    @classmethod
    def from_model_ref(
        cls, model_ref: ModelRef, *, harness: Optional[str], prefix: str = "agent."
    ) -> "LlmReference":
        return cls(
            model=model_ref.model,
            provider=model_ref.provider,
            mode=model_ref.connection.mode,
            slug=_string(model_ref.connection.slug),
            namespace=model_ref.connection.namespace,
            scope=model_ref.connection.scope,
            harness=harness,
            prefix=prefix,
            account_source=_account_source(model_ref.connection),
        )

    def connection_item(self) -> Optional[ItemReference]:
        """The model key or the subscription login, or None for the operator's login and
        for a login each person brings (`user_login_item`)."""
        if self.account_source == "user":
            return None
        path = f"{self.prefix}llm.connection"
        if self.mode == "self_managed":
            if not self.slug:
                return None
            scope = self.scope or "project"
            return ItemReference(
                kind=KIND_SUBSCRIPTION,
                key=f"{KIND_SUBSCRIPTION}:{scope}/{self.slug}",
                label=self.slug,
                reference={"scope": scope, "slug": self.slug},
                paths=[path],
            )
        if self.slug:
            scope = self.scope or "project"
            reference: Dict[str, Any] = {"scope": scope, "slug": self.slug}
            if self.namespace:
                reference["namespace"] = self.namespace
            if self.provider:
                reference["provider"] = self.provider
            return ItemReference(
                kind=KIND_MODEL_KEY,
                key=f"{KIND_MODEL_KEY}:{scope}/{self.slug}",
                label=self.slug,
                reference=reference,
                paths=[path],
            )
        provider = self.provider or ""
        return ItemReference(
            kind=KIND_MODEL_KEY,
            key=f"{KIND_MODEL_KEY}:{provider}",
            label=provider,
            reference={"provider": provider},
            paths=[path],
        )

    def user_login_item(self) -> Optional[ItemReference]:
        """The subscription login each person brings, or None."""
        if self.account_source != "user":
            return None
        connection: Dict[str, Any] = {
            "mode": self.mode,
            "account_source": "user",
        }
        items = read_user_items(
            {
                "agent": {
                    "llm": {
                        "model": self.model,
                        "provider": self.provider,
                        "connection": connection,
                    }
                }
            }
        )
        if not items:
            return None
        item = user_item_reference(items[0])
        item.paths = [f"{self.prefix}llm.connection"]
        return item

    def model_item(self) -> ItemReference:
        provider = self.provider or ""
        return ItemReference(
            kind=KIND_MODEL,
            key=f"{KIND_MODEL}:{provider}/{self.model}",
            label=self.model,
            reference={"provider": provider, "model": self.model},
            paths=[f"{self.prefix}llm.model"],
        )


@dataclass
class AgentReferences:
    """Every reference of one agent configuration, grouped by item."""

    llm: Optional[LlmReference] = None
    mcp_servers: List[ItemReference] = field(default_factory=list)
    secrets: List[ItemReference] = field(default_factory=list)
    app_connections: List[ItemReference] = field(default_factory=list)


def _agent_section(parameters: Any) -> tuple[Dict[str, Any], str]:
    """The agent template and the path prefix its references are written under."""
    if not isinstance(parameters, dict):
        return {}, ""
    agent = parameters.get("agent")
    if isinstance(agent, dict):
        return agent, "agent."
    return parameters, ""


def _account_source(value: Any) -> AccountSource:
    """`"user"` when an item names no account and each person brings their own. Read
    from the raw entry or the parsed model, so this reader never depends on a model
    accepting the field."""
    source = (
        value.get("account_source")
        if isinstance(value, dict)
        else getattr(value, "account_source", None)
    )
    return "user" if source == "user" else "agent"


def _string(value: Any) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _harness(agent: Dict[str, Any]) -> Optional[str]:
    harness = agent.get("harness")
    kind = harness.get("kind") if isinstance(harness, dict) else None
    return _string(kind)


def _llm(agent: Dict[str, Any], prefix: str) -> Optional[LlmReference]:
    llm = agent.get("llm")
    if not isinstance(llm, dict):
        return None
    model = _string(llm.get("model"))
    if model is None:
        return None
    connection = llm.get("connection")
    try:
        if llm.get("provider") or connection:
            ref = ModelRef.model_validate(
                {
                    "model": model,
                    **({"provider": llm["provider"]} if llm.get("provider") else {}),
                    **({"connection": connection} if connection else {}),
                }
            )
        else:
            ref = ModelRef.coerce(model)
    except Exception:  # pylint: disable=broad-except
        # A shape the runtime would refuse is not a missing item; the run reports it.
        return None
    return LlmReference(
        model=ref.model,
        provider=ref.provider,
        mode=ref.connection.mode,
        slug=_string(ref.connection.slug),
        namespace=ref.connection.namespace,
        scope=ref.connection.scope,
        harness=_harness(agent),
        prefix=prefix,
        account_source=_account_source(connection),
    )


def _add(items: Dict[str, ItemReference], item: ItemReference) -> None:
    existing = items.get(item.key)
    if existing is None:
        items[item.key] = item
    else:
        existing.paths.extend(path for path in item.paths if path not in existing.paths)


def _mcp_servers(agent: Dict[str, Any], prefix: str) -> List[ItemReference]:
    raw = agent.get("mcps")
    if not isinstance(raw, list):
        return []
    items: Dict[str, ItemReference] = {}
    for index, entry in enumerate(raw):
        if (
            isinstance(entry, dict)
            and _account_source(entry.get("connection")) == "user"
        ):
            # `read_user_items` is the one reader of a "user" item.
            continue
        try:
            server = MCPServerConfig.model_validate(entry)
        except Exception:  # pylint: disable=broad-except
            continue
        connection = server.connection
        if not isinstance(connection, MCPGatewayConnection):
            continue
        if connection.namespace != "custom" or not connection.slug:
            continue
        _add(
            items,
            ItemReference(
                kind=KIND_MCP_SERVER,
                key=f"{KIND_MCP_SERVER}:{connection.slug}",
                label=server.name,
                reference={"slug": connection.slug},
                paths=[f"{prefix}mcps[{index}].connection"],
            ),
        )
    return list(items.values())


def _secret_item(slug: str, path: str) -> ItemReference:
    return ItemReference(
        kind=KIND_SECRET,
        key=f"{KIND_SECRET}:{slug}",
        label=slug,
        reference={"slug": slug},
        paths=[path],
    )


def _tool_config(entry: Any) -> Any:
    configs = coerce_tool_configs([entry], on_error="collect").tool_configs
    return configs[0] if configs else None


def _secrets_and_apps(
    agent: Dict[str, Any], prefix: str
) -> tuple[List[ItemReference], List[ItemReference]]:
    secrets: Dict[str, ItemReference] = {}
    apps: Dict[str, ItemReference] = {}

    sandbox = agent.get("sandbox")
    credentials = sandbox.get("credentials") if isinstance(sandbox, dict) else None
    for index, entry in enumerate(credentials if isinstance(credentials, list) else []):
        secret = entry.get("secret") if isinstance(entry, dict) else None
        if _account_source(secret) == "user":
            continue
        slug = _string(secret.get("slug")) if isinstance(secret, dict) else None
        if slug:
            _add(
                secrets,
                _secret_item(slug, f"{prefix}sandbox.credentials[{index}].secret"),
            )

    tools = agent.get("tools")
    for index, entry in enumerate(tools if isinstance(tools, list) else []):
        if (
            isinstance(entry, dict)
            and _account_source(entry.get("connection")) == "user"
        ):
            continue
        config = _tool_config(entry)
        if isinstance(config, CodeToolConfig):
            for position, slug in enumerate(config.secrets):
                if _string(slug):
                    _add(
                        secrets,
                        _secret_item(
                            slug, f"{prefix}tools[{index}].secrets[{position}]"
                        ),
                    )
            continue
        if isinstance(config, GatewayToolConfig):
            provider, integration, slug = (
                config.provider,
                config.integration,
                config.connection,
            )
        elif isinstance(config, GatewayConnectionToolConfig):
            provider = config.connection.provider
            integration = config.connection.integration
            slug = config.connection.slug
        else:
            continue
        if not slug:
            continue
        _add(
            apps,
            ItemReference(
                kind=KIND_APP_CONNECTION,
                key=f"{KIND_APP_CONNECTION}:{integration}/{slug}",
                label=integration,
                reference={
                    "provider": provider,
                    "integration": integration,
                    "slug": slug,
                },
                paths=[f"{prefix}tools[{index}].connection"],
            ),
        )
    return list(secrets.values()), list(apps.values())


def read_agent_references(parameters: Any) -> AgentReferences:
    """Every item a revision's parameters name. Never raises: an entry that does not
    parse names no item (the run reports a malformed configuration on its own)."""
    agent, prefix = _agent_section(parameters)
    secrets, apps = _secrets_and_apps(agent, prefix)
    return AgentReferences(
        llm=_llm(agent, prefix),
        mcp_servers=_mcp_servers(agent, prefix),
        secrets=secrets,
        app_connections=apps,
    )


def requirement(
    item: ItemReference,
    *,
    reason: str,
    code: Optional[str] = None,
    kind: Optional[str] = None,
) -> Dict[str, Any]:
    """The requirement shape for one item. ``kind`` overrides the item's kind, for the
    MCP sign-in requirement that reads the MCP server's reference."""
    kind = kind or item.kind
    key = item.key if kind == item.kind else f"{kind}:{item.key.split(':', 1)[1]}"
    value: Dict[str, Any] = {
        "key": key,
        "kind": kind,
        "label": item.label,
        "reference": dict(item.reference),
        "paths": list(item.paths),
        "reason": reason,
        "blocks_run": kind in MODEL_KINDS,
        "account_source": item.account_source,
    }
    if code:
        value["detail"] = {"code": code}
    return value


class AgentNeedsSetupError(ErrorStatus, ValueError):
    """A model item of the agent needs setup, so the run stops before a sandbox starts.

    ``failure_details`` carries the requirements, which reach the client as
    ``status.details``. Each requirement keeps the code the run failed with before as
    ``detail.code``, so logs and tests can still match it.
    """

    code: int = 422
    type: str = f"{ERRORS_BASE_URL}#v0:agent:needs-setup"
    status_code = 422
    failure_code = AGENT_NEEDS_SETUP

    def __init__(self, requirements: List[Dict[str, Any]]) -> None:
        super().__init__(
            code=self.code, type=self.type, message=AGENT_NEEDS_SETUP_MESSAGE
        )
        self.requirements = requirements
        self.failure_details = {"requirements": requirements}


# The run's own failure codes, read from a model item's resolve failure.
_CONNECTION_REASONS = {
    "endpoint_not_found": REASON_NOT_FOUND,
    "connection_not_found": REASON_NOT_FOUND,
    "endpoint_inactive": REASON_TURNED_OFF,
    "subscription_connection_missing": REASON_NOT_FOUND,
    "subscription_login_required": REASON_NEEDS_SIGN_IN,
}
# The harness cannot run this model through this connection or login.
_UNSUPPORTED_CODES = (
    (UnsupportedProviderError, "unsupported_provider"),
    (UnsupportedDeploymentError, "unsupported_deployment"),
    (SubscriptionNotSupportedError, "subscription_not_supported"),
)

# The vault fallback path names no code; these keep the class name logs already show.
_CLASS_CODES = (
    (ConnectionNotFoundError, "connection_not_found", REASON_NOT_FOUND),
    (MissingCredentialError, "missing_credential", REASON_NOT_CHOSEN),
)


def model_requirement_from_error(
    error: BaseException, llm: LlmReference
) -> Optional[Dict[str, Any]]:
    """The model-item requirement a run-start resolve failure means, or None when the
    failure is not a missing item (an outage, a malformed configuration, a refusal)."""
    code = getattr(error, "failure_code", None)
    if code == "model_not_available":
        return requirement(llm.model_item(), reason=REASON_NOT_AVAILABLE, code=code)
    # The harness cannot drive this provider or deployment: the same pair check the
    # API's needs-setup check applies.
    for error_class, unsupported_code in _UNSUPPORTED_CODES:
        if isinstance(error, error_class):
            return requirement(
                llm.model_item(), reason=REASON_NOT_AVAILABLE, code=unsupported_code
            )
    login = llm.user_login_item()
    if login is not None:
        # A login each person brings: no account for the run person. The run never
        # falls back to the agent's or the operator's login.
        missing = (isinstance(code, str) and code in _CONNECTION_REASONS) or any(
            isinstance(error, error_class) for error_class, _, _ in _CLASS_CODES
        )
        if not missing:
            return None
        return requirement(
            login,
            reason=REASON_NEEDS_PERSONAL_ACCOUNT,
            code=code if isinstance(code, str) else None,
        )
    item = llm.connection_item()
    if item is None:
        return None
    if isinstance(code, str) and code in _CONNECTION_REASONS:
        return requirement(item, reason=_CONNECTION_REASONS[code], code=code)
    for error_class, class_code, reason in _CLASS_CODES:
        if isinstance(error, error_class):
            return requirement(item, reason=reason, code=class_code)
    return None
