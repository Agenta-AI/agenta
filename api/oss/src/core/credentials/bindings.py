"""Connection bindings (M7): whose account an agent connection uses.

Every model, Composio and MCP gateway reference of an agent has a binding:

- `caller_account` ("Each person's own account"): the credential of the person the run
  acts for (`caller_user_id`).
- `project_default` ("The project's shared account"): the connection the reference names,
  from the project or the organization, exactly as under M5. Never a user-owned row.

A reference without a binding is `project_default`, so every revision saved before M7
keeps its meaning. The server derives the `caller_account` bindings from the resolved
revision and signs them into the run credential (`gateway_bindings`). A lookup with no
signed binding resolves as `project_default`: the sandbox cannot ask for a personal
credential that the revision did not bind.
"""

from enum import Enum
from typing import Any, Dict, Iterable, List, Literal, Optional, Tuple
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from oss.src.core.access.dtos import PrincipalKind, RunAuthority


class Binding(str, Enum):
    CALLER_ACCOUNT = "caller_account"
    PROJECT_DEFAULT = "project_default"


ConnectionKind = Literal["model", "tool"]


class ConnectionKey(BaseModel):
    """Which connection of the agent a lookup is for, as the claim names it.

    - model: `service` is the provider family (`openai`).
    - tool: `service` is `composio:<integration>:<slug>`, the entry's own connection.
    Personal subscription logins and MCP accounts are later steps; a binding on them is
    refused, so they have no key yet.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: ConnectionKind
    service: str


class BindingClaim(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    key: ConnectionKey
    binding: Binding


class InvalidBinding(ValueError):
    """A reference whose binding the first step does not support. `where` names the
    connection, so the author knows which one to fix."""

    def __init__(self, *, where: str, message: str) -> None:
        self.where = where
        super().__init__(f"{where}: {message}")


# --- the caller --------------------------------------------------------------------


def caller_user_id(authority: Optional[RunAuthority]) -> Optional[UUID]:
    """The person a `caller_account` connection uses, or None when the run has none.

    A human principal is that person. A channel turn is the linked person of the
    channel user (owner decision 2026-10-28); an unlinked channel user has none. An API
    key is no person until personal keys exist (M6a), so it has none."""

    if authority is None:
        return None
    if authority.principal.kind == PrincipalKind.HUMAN:
        return authority.principal.id
    if authority.principal.kind == PrincipalKind.INSTALLATION:
        return authority.linked_user_id
    return None


# --- reading a revision -------------------------------------------------------------


def _agent(revision_data: Any) -> Dict[str, Any]:
    if hasattr(revision_data, "model_dump"):
        revision_data = revision_data.model_dump(mode="json", exclude_none=True)
    if not isinstance(revision_data, dict):
        return {}
    parameters = revision_data.get("parameters")
    agent = parameters.get("agent") if isinstance(parameters, dict) else None
    return agent if isinstance(agent, dict) else {}


def _binding(value: Any, *, where: str) -> Binding:
    if value is None:
        return Binding.PROJECT_DEFAULT
    try:
        return Binding(value)
    except ValueError as e:
        if value == "specific":
            raise InvalidBinding(
                where=where,
                message="'One fixed account' (binding 'specific') is not available yet.",
            ) from e
        raise InvalidBinding(
            where=where,
            message="binding must be 'caller_account' or 'project_default'.",
        ) from e


def _model_provider(llm: Dict[str, Any]) -> Optional[str]:
    provider = llm.get("provider")
    if isinstance(provider, str) and provider.strip():
        return provider.strip()
    model = llm.get("model")
    if isinstance(model, str) and "/" in model:
        head = model.split("/", 1)[0].strip()
        return head or None
    return None


def _model_claims(agent: Dict[str, Any]) -> Iterable[BindingClaim]:
    llm = agent.get("llm")
    connection = llm.get("connection") if isinstance(llm, dict) else None
    if not isinstance(connection, dict):
        return
    where = "agent.llm.connection"
    binding = _binding(connection.get("binding"), where=where)
    if binding != Binding.CALLER_ACCOUNT:
        return
    if connection.get("scope") == "organization" or (
        connection.get("namespace") == "organization"
    ):
        raise InvalidBinding(
            where=where,
            message="an organization connection cannot use each person's own account.",
        )
    if connection.get("mode") == "self_managed":
        # Personal subscription logins need their own sign-in flow and are a later step.
        # Refused rather than ignored: ignoring it would run the project's login.
        raise InvalidBinding(
            where=where,
            message="each person's own subscription login is not available yet.",
        )
    provider = _model_provider(llm)
    if provider is None:
        raise InvalidBinding(
            where=where,
            message="each person's own key needs the model's provider.",
        )
    yield BindingClaim(
        key=ConnectionKey(kind="model", service=provider), binding=binding
    )


def _tool_claims(agent: Dict[str, Any]) -> List[BindingClaim]:
    """A tool entry's personal binding names its own connection: the integration AND
    the entry's slug, so another entry of the same integration keeps its own account."""
    claims = []
    for index, entry in enumerate(_entries(agent.get("tools"))):
        connection = entry.get("connection")
        if entry.get("type") != "gateway_connection" or not isinstance(
            connection, dict
        ):
            continue
        where = f"agent.tools[{index}].connection"
        binding = _binding(connection.get("binding"), where=where)
        integration, slug = connection.get("integration"), connection.get("slug")
        if binding != Binding.CALLER_ACCOUNT:
            continue
        if not isinstance(integration, str) or not isinstance(slug, str):
            raise InvalidBinding(
                where=where, message="a connection needs its integration and slug."
            )
        claims.append(
            BindingClaim(
                key=tool_key(integration=integration, slug=slug), binding=binding
            )
        )
    return claims


def tool_key(
    *, integration: str, slug: str, provider: str = "composio"
) -> ConnectionKey:
    return ConnectionKey(kind="tool", service=f"{provider}:{integration}:{slug}")


def _refuse_personal_mcp(agent: Dict[str, Any]) -> None:
    """Personal MCP servers and per-person MCP sign-ins are a later step. A reference
    that asks for one is refused, never read as the project's server."""
    for index, entry in enumerate(_entries(agent.get("mcps"))):
        connection = entry.get("connection")
        if not isinstance(connection, dict) or connection.get("type") != "gateway":
            continue
        where = f"agent.mcps[{index}].connection"
        binding = _binding(connection.get("binding"), where=where)
        if binding == Binding.CALLER_ACCOUNT or connection.get("scope") == "user":
            raise InvalidBinding(
                where=where,
                message="each person's own MCP account is not available yet.",
            )


def _entries(value: Any) -> List[Dict[str, Any]]:
    return (
        [item for item in value if isinstance(item, dict)]
        if isinstance(value, list)
        else []
    )


def binding_claims_for_revision(revision_data: Any) -> List[BindingClaim]:
    """The `caller_account` bindings of an agent revision, the only ones signed.

    Raises `InvalidBinding` for a binding the first step does not support. Commit runs
    it as a format check, and `_prepare_invoke` runs it again for revisions saved
    before the check existed."""

    agent = _agent(revision_data)
    if not agent:
        return []
    claims: List[BindingClaim] = []
    _refuse_personal_mcp(agent)
    for claim in (*_model_claims(agent), *_tool_claims(agent)):
        if claim not in claims:
            claims.append(claim)
    return claims


# --- the signed claim -----------------------------------------------------------------


def claims_to_token(claims: Iterable[BindingClaim]) -> List[Dict[str, Any]]:
    return [claim.model_dump(mode="json", exclude_none=True) for claim in claims]


def claims_from_token(value: Any) -> Tuple[BindingClaim, ...]:
    """The bindings a verified token carries. A missing or malformed claim reads as no
    binding at all, which resolves every lookup as `project_default` (fail closed)."""

    if not isinstance(value, list):
        return ()
    claims = []
    for item in value:
        try:
            claims.append(BindingClaim.model_validate(item))
        except Exception:  # noqa: BLE001 - an unknown shape binds nothing
            continue
    return tuple(claims)


def bound_to_caller(claims: Iterable[BindingClaim], key: ConnectionKey) -> bool:
    return any(
        claim.key == key and claim.binding == Binding.CALLER_ACCOUNT for claim in claims
    )
