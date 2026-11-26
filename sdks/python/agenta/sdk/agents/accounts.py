"""Whose account fills an agent item, and the reader of an agent's "user" items.

An item says whose account fills it with one field, ``account_source``:

- ``"agent"`` (or the field left out): the account the agent names, for every run.
- ``"user"``: the run person's own account. Agenta finds it at run start.

This module is the one place that builds an item key (``<kind>:user/<match text>``), so the
API, the services and Needs setup name each "user" item with the same text.

The module imports nothing from the rest of the agents package at load time, because the
item models import ``AccountSource`` from here.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, get_args

from pydantic import BaseModel, ConfigDict

AccountSource = Literal["agent", "user"]
UserItemKind = Literal["app_connection", "mcp_server", "secret", "subscription"]
_KINDS = get_args(UserItemKind)
# The shape of a "user" item key, for a route model that checks it.
USER_ITEM_KEY_PATTERN = rf"^({'|'.join(_KINDS)}):user/\S+$"

# The model provider of a self-managed model, mapped to the stored login kind. The only
# place that turns a provider name into a login kind.
_LOGIN_KINDS: Dict[str, str] = {"anthropic": "claude", "openai-codex": "chatgpt"}


class UserItem(BaseModel):
    """One "user" item of an agent. Two items with the same key are one item."""

    model_config = ConfigDict(frozen=True)

    item_key: str
    kind: UserItemKind
    # The text the item matches on: the integration, the MCP server slug, the variable
    # name, or the login kind.
    match_text: str
    # Every configuration path that names the item, as in Needs setup.
    paths: List[str]


def user_item_key(*, kind: UserItemKind, match_text: str) -> str:
    return f"{kind}:user/{match_text}"


def user_item_from_key(item_key: str) -> Optional[UserItem]:
    """The item an item key names (no paths), or None for text that is not a "user" item
    key. The inverse of `user_item_key`, for a caller that carries only the key."""
    kind, separator, match_text = item_key.partition(":user/")
    if (
        not separator
        or kind not in _KINDS
        or not match_text
        or match_text.strip() != (match_text)
    ):
        return None
    return UserItem(item_key=item_key, kind=kind, match_text=match_text, paths=[])


def _string(value: Any) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _agent_section(parameters: Any) -> tuple[Dict[str, Any], str]:
    if not isinstance(parameters, dict):
        return {}, ""
    agent = parameters.get("agent")
    if isinstance(agent, dict):
        return agent, "agent."
    return parameters, ""


class _Items:
    def __init__(self) -> None:
        self._by_key: Dict[str, UserItem] = {}

    def add(self, *, kind: UserItemKind, match_text: Optional[str], path: str) -> None:
        if not match_text:
            return
        key = user_item_key(kind=kind, match_text=match_text)
        existing = self._by_key.get(key)
        if existing is None:
            self._by_key[key] = UserItem(
                item_key=key, kind=kind, match_text=match_text, paths=[path]
            )
        elif path not in existing.paths:
            self._by_key[key] = existing.model_copy(
                update={"paths": [*existing.paths, path]}
            )

    def values(self) -> List[UserItem]:
        return list(self._by_key.values())


def _llm(agent: Dict[str, Any], prefix: str, items: _Items) -> None:
    llm = agent.get("llm")
    connection = llm.get("connection") if isinstance(llm, dict) else None
    if not isinstance(connection, dict):
        return
    if connection.get("account_source") != "user":
        return
    if connection.get("mode") != "self_managed":
        return
    provider = _string(llm.get("provider"))
    items.add(
        kind="subscription",
        match_text=_LOGIN_KINDS.get(provider or ""),
        path=f"{prefix}llm.connection",
    )


def _tools(agent: Dict[str, Any], prefix: str, items: _Items) -> None:
    from .tools import GatewayConnectionToolConfig, coerce_tool_configs

    tools = agent.get("tools")
    for index, entry in enumerate(tools if isinstance(tools, list) else []):
        configs = coerce_tool_configs([entry], on_error="collect").tool_configs
        config = configs[0] if configs else None
        if not isinstance(config, GatewayConnectionToolConfig):
            continue
        if config.connection.account_source != "user":
            continue
        items.add(
            kind="app_connection",
            match_text=config.connection.integration,
            path=f"{prefix}tools[{index}].connection",
        )


def _mcps(agent: Dict[str, Any], prefix: str, items: _Items) -> None:
    from .mcp import MCPGatewayConnection, MCPServerConfig

    mcps = agent.get("mcps")
    for index, entry in enumerate(mcps if isinstance(mcps, list) else []):
        try:
            server = MCPServerConfig.model_validate(entry)
        except Exception:  # pylint: disable=broad-except
            continue
        connection = server.connection
        if not isinstance(connection, MCPGatewayConnection):
            continue
        if connection.account_source != "user":
            continue
        items.add(
            kind="mcp_server",
            match_text=connection.slug,
            path=f"{prefix}mcps[{index}].connection",
        )


def _secrets(agent: Dict[str, Any], prefix: str, items: _Items) -> None:
    sandbox = agent.get("sandbox")
    credentials = sandbox.get("credentials") if isinstance(sandbox, dict) else None
    for index, entry in enumerate(credentials if isinstance(credentials, list) else []):
        if not isinstance(entry, dict):
            continue
        secret, binding = entry.get("secret"), entry.get("binding")
        if not isinstance(secret, dict) or secret.get("account_source") != "user":
            continue
        name = _string(binding.get("name")) if isinstance(binding, dict) else None
        items.add(
            kind="secret",
            match_text=name,
            path=f"{prefix}sandbox.credentials[{index}].secret",
        )


def read_user_items(parameters: Optional[dict]) -> List[UserItem]:
    """The "user" items of an agent's parameters, one per item key, in configuration
    order. Never raises: an entry that does not parse names no item."""
    agent, prefix = _agent_section(parameters)
    items = _Items()
    for reader in (_llm, _tools, _mcps, _secrets):
        try:
            reader(agent, prefix, items)
        except Exception:  # pylint: disable=broad-except
            continue
    return items.values()
