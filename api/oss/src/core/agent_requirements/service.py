"""The needs-setup check: which items an agent names that are not ready where it runs.

Reads references only. It never changes the configuration and never replaces a missing
item, by name or by default. A reference resolves only to the exact item it names.

A `"user"` item names no account: each person who runs the agent brings their own. The
check reads those items with the run's own resolver (`AccountChoicesService.resolve`), for
the person who asks, in one statement and only when the agent has such items. So the
check and the run cannot disagree. The reasons for those items live here, never in the
resolver.

Reads, per check: the project's one vault entry (a cache read, shared with the LLM
check through the request memo), one endpoint row when the model key is a custom
endpoint, the project's MCP endpoints only when the agent names an MCP server, and the
project's app connections only when the agent names one. The organization's rows are read
only to tell `not_shared` from `not_found`, after an organization item was not found.
"""

from typing import Awaitable, Callable, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from agenta.sdk.agents.capabilities import (
    HARNESS_CONNECTION_CAPABILITIES,
    harness_allows_pair,
    harness_allows_provider,
)
from agenta.sdk.agents.accounts import UserItem, read_user_items
from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.platform.connections import subscription_runs_on
from agenta.sdk.agents.requirements import (
    AgentReferences,
    ItemReference,
    LlmReference,
    read_agent_references,
    requirement,
    user_item_reference,
)

from oss.src.core.access.permissions.types import Permission
from oss.src.core.account_choices.dtos import ItemAccount
from oss.src.core.account_choices.exceptions import AccountDataUnreadable
from oss.src.core.account_choices.policy import personal_accounts_enabled
from oss.src.core.account_choices.service import AccountChoicesService
from oss.src.core.agent_requirements.dtos import (
    AgentRequirement,
    AgentRequirementAsk,
    AgentRequirementFix,
    AgentRequirementKind,
    AgentRequirementReason,
    AgentRequirements,
)
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme, MCPEndpoint
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import SecretKind, SecretOwnerKind
from oss.src.core.secrets.services import VaultService
from oss.src.utils.context import AuthScope
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

Allowed = Callable[[Permission], Awaitable[bool]]
Decision = Callable[[], Awaitable[bool]]

_KIND = AgentRequirementKind
_REASON = AgentRequirementReason

# The permission that creates (or signs in again) an item of each kind in the project.
_MANAGE_PERMISSION: Dict[AgentRequirementKind, Optional[Permission]] = {
    _KIND.MODEL_KEY: Permission.EDIT_SECRET,
    _KIND.SUBSCRIPTION: Permission.EDIT_SECRET,
    _KIND.MODEL: None,
    _KIND.MCP_SERVER: Permission.EDIT_MCP_ENDPOINTS,
    _KIND.MCP_SIGN_IN: Permission.EDIT_MCP_ENDPOINTS,
    _KIND.SECRET: Permission.EDIT_SECRET,
    _KIND.APP_CONNECTION: Permission.EDIT_TOOLS,
}

_MODEL_KEY_KINDS = (SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER)


def _family(secret: SecretResponseDTO) -> Optional[str]:
    kind = getattr(secret.data, "kind", None)
    value = getattr(kind, "value", kind)
    return str(value) if value else None


def _is_text_secret(secret: SecretResponseDTO) -> bool:
    if secret.kind != SecretKind.CUSTOM_SECRET:
        return False
    settings = getattr(secret.data, "secret", None)
    fmt = getattr(settings, "format", None)
    return getattr(fmt, "value", fmt) == "text" and isinstance(
        getattr(settings, "content", None), str
    )


def _subscription_ready(secret: SecretResponseDTO) -> bool:
    state = getattr(secret.data, "login_state", None)
    return getattr(state, "value", state) == "ready" and bool(
        getattr(secret.data, "login", None)
    )


def _mcp_ready(endpoint: MCPEndpoint) -> bool:
    """The gateway's own rule for a custom endpoint (`MCPGatewayService._connection_state`)."""
    if endpoint.auth_mode == MCPAuthScheme.NONE:
        return True
    return endpoint.secret_id is not None and endpoint.flags.is_valid


class _Found:
    """One requirement before the caller's fix is added."""

    def __init__(
        self,
        item: ItemReference,
        *,
        reason: AgentRequirementReason,
        kind: Optional[AgentRequirementKind] = None,
        candidates: int = 0,
        fixable: bool = True,
        by_person: Optional[bool] = None,
    ) -> None:
        self.item = item
        self.kind = kind or AgentRequirementKind(item.kind)
        self.reason = reason
        self.candidates = candidates
        # A "user" item with no run person, with personal accounts off, or a login
        # (no flow creates one yet) has no fix.
        self.fixable = fixable
        # Whether the person sets it up with their own account. A "user" item whose
        # project server is missing is the project's to fix, like an "agent" item.
        self.by_person = (
            item.account_source == "user" if by_person is None else by_person
        )

    @property
    def is_organization(self) -> bool:
        """An organization item shared with the project: the organization fixes it."""
        reference = self.item.reference
        return (
            reference.get("scope") == "organization"
            or reference.get("namespace") == "organization"
        )


class AgentRequirementsService:
    def __init__(
        self,
        *,
        vault_service: VaultService,
        llm_gateway_service: LLMGatewayService,
        mcp_gateway_service: MCPGatewayService,
        connections_service: ConnectionsService,
        account_choices_service: AccountChoicesService,
    ) -> None:
        self.vault_service = vault_service
        self.llm_gateway_service = llm_gateway_service
        self.mcp_gateway_service = mcp_gateway_service
        self.connections_service = connections_service
        self.account_choices_service = account_choices_service

    async def check(
        self,
        *,
        scope: AuthScope,
        parameters: Optional[dict],
        artifact_id: Optional[UUID],
        run_person_id: Optional[UUID],
        #
        can_edit_agent: Decision,
        allowed: Allowed,
        may_run_agent: Decision,
        manages_organization: Decision,
    ) -> AgentRequirements:
        """The requirements of one agent configuration, with what the caller can do.
        `run_person_id` is the person who asks, whose accounts the `"user"` items use.
        The caller's permissions are read only when something needs setup."""
        manages_organization = _once(manages_organization)
        references = read_agent_references(parameters)
        found = await self._find(
            scope=scope,
            references=references,
            manages_organization=manages_organization,
        )
        found.extend(
            await self._user_items(
                scope=scope,
                items=read_user_items(parameters),
                artifact_id=artifact_id,
                run_person_id=run_person_id,
            )
        )
        if not found:
            return AgentRequirements.of([])

        edits = await can_edit_agent()
        permissions: Dict[Permission, bool] = {}
        for entry in found:
            permission = _MANAGE_PERMISSION[entry.kind]
            if (
                not entry.by_person
                and permission is not None
                and permission not in permissions
            ):
                permissions[permission] = await allowed(permission)
        may_run = any(entry.by_person and entry.fixable for entry in found) and bool(
            await may_run_agent()
        )
        manages = any(
            entry.is_organization and not entry.by_person for entry in found
        ) and bool(await manages_organization())

        return AgentRequirements.of(
            [
                self._requirement_of(
                    entry,
                    can_edit_agent=edits,
                    permissions=permissions,
                    may_run=may_run,
                    manages_organization=manages,
                )
                for entry in found
            ]
        )

    async def model_requirements(
        self,
        *,
        scope: AuthScope,
        parameters: Optional[dict],
        artifact_id: Optional[UUID],
        run_person_id: Optional[UUID],
    ) -> List[AgentRequirement]:
        """Only the requirements that block a run, for a turn-on check, for the person
        the automation runs as (`run_person_id`). Reads the vault and the model key,
        never the MCP endpoints or the app connections."""
        references = read_agent_references(parameters)
        found = await self._find(
            scope=scope,
            references=AgentReferences(llm=references.llm),
            manages_organization=_never,
        )
        found.extend(
            await self._user_items(
                scope=scope,
                items=[
                    item
                    for item in read_user_items(parameters)
                    if item.kind == _KIND.SUBSCRIPTION.value
                ],
                artifact_id=artifact_id,
                run_person_id=run_person_id,
            )
        )
        return [
            self._requirement_of(
                entry,
                can_edit_agent=False,
                permissions={},
                may_run=False,
                manages_organization=False,
            )
            for entry in found
        ]

    # -- finding -----------------------------------------------------------------------

    async def _find(
        self,
        *,
        scope: AuthScope,
        references: AgentReferences,
        manages_organization: Callable[[], Awaitable[bool]],
    ) -> List[_Found]:
        found: List[_Found] = []
        project_rows: List[SecretResponseDTO] = []
        organization_rows: List[SecretResponseDTO] = []
        if references.llm is not None or references.secrets:
            (
                project_rows,
                organization_rows,
            ) = await self.vault_service.list_project_and_organization_secrets(
                organization_id=scope.organization_id, project_id=scope.project_id
            )

        if references.llm is not None:
            found.extend(
                await self._llm(
                    scope=scope,
                    llm=references.llm,
                    project_rows=project_rows,
                    organization_rows=organization_rows,
                    manages_organization=manages_organization,
                )
            )
        if references.mcp_servers:
            found.extend(
                await self._mcp_servers(scope=scope, items=references.mcp_servers)
            )
        if references.secrets:
            found.extend(
                await self._secrets(
                    scope=scope,
                    items=references.secrets,
                    project_rows=project_rows,
                    organization_rows=organization_rows,
                    manages_organization=manages_organization,
                )
            )
        if references.app_connections:
            found.extend(
                await self._app_connections(
                    scope=scope, items=references.app_connections
                )
            )
        return found

    async def _user_items(
        self,
        *,
        scope: AuthScope,
        items: Sequence[UserItem],
        artifact_id: Optional[UUID],
        run_person_id: Optional[UUID],
    ) -> List[_Found]:
        """The `"user"` items with no ready account for the run person. One resolve, and
        only when there are such items and a person to resolve them for."""
        if not items:
            return []
        found: List[_Found] = []
        servers = [item for item in items if item.kind == _KIND.MCP_SERVER.value]
        if servers:
            # A person signs in to a server of the project. When the project has no such
            # server, or it is turned off, the project fixes it, as for an "agent" item.
            # One read, only in this check (never on the run path).
            missing = await self._missing_servers(scope=scope, items=servers)
            found.extend(missing)
            left_out = {entry.item.key for entry in missing}
            items = [item for item in items if item.item_key not in left_out]
            if not items:
                return found
        person = run_person_id if personal_accounts_enabled() else None
        accounts = {}
        if person is not None:
            # Without an agent (a draft with no `workflow_id`) the resolver reads no
            # choices; defaults and sign-ins still apply.
            try:
                resolved = await self.account_choices_service.resolve(
                    organization_id=scope.organization_id,
                    project_id=scope.project_id,
                    artifact_id=artifact_id,
                    user_id=person,
                    items=items,
                )
            except AccountDataUnreadable:
                # A stored sign-in that cannot be read: the run leaves these items
                # out, so the person sets them up again.
                log.warning("needs setup: a stored account could not be read")
                resolved = [ItemAccount(item_key=item.item_key) for item in items]
            accounts = {account.item_key: account for account in resolved}

        for item in items:
            reference = user_item_reference(item)
            account = accounts.get(item.item_key)
            if account is not None and account.is_ready:
                continue
            if account is None or item.kind == _KIND.SUBSCRIPTION.value:
                found.append(
                    _Found(
                        reference,
                        reason=_REASON.NEEDS_PERSONAL_ACCOUNT,
                        fixable=False,
                    )
                )
            elif account.match is None:
                found.append(
                    _Found(
                        reference,
                        reason=_REASON.NEEDS_PERSONAL_ACCOUNT,
                        candidates=account.candidates,
                    )
                )
            else:
                # Matched but not ready: the person signs in again.
                found.append(
                    _Found(
                        reference,
                        reason=_REASON.NEEDS_SIGN_IN,
                        kind=(
                            _KIND.MCP_SIGN_IN
                            if item.kind == _KIND.MCP_SERVER.value
                            else None
                        ),
                        candidates=account.candidates,
                    )
                )
        return found

    async def _missing_servers(
        self, *, scope: AuthScope, items: Sequence[UserItem]
    ) -> List[_Found]:
        """The "user" MCP items whose project server is missing or turned off."""
        endpoints = await self.mcp_gateway_service.query_endpoints(
            project_id=scope.project_id
        )
        by_slug = {
            endpoint.slug: endpoint
            for endpoint in endpoints
            if endpoint.namespace == GatewayEndpointNamespace.CUSTOM and endpoint.slug
        }
        candidates = sum(
            1
            for endpoint in by_slug.values()
            if endpoint.flags.is_active and _mcp_ready(endpoint)
        )
        found: List[_Found] = []
        for item in items:
            endpoint = by_slug.get(item.match_text)
            if endpoint is not None and endpoint.flags.is_active:
                continue
            found.append(
                _Found(
                    user_item_reference(item),
                    reason=(
                        _REASON.NOT_FOUND if endpoint is None else _REASON.TURNED_OFF
                    ),
                    candidates=candidates,
                    by_person=False,
                )
            )
        return found

    async def _not_shared(
        self,
        *,
        scope: AuthScope,
        slug: str,
        manages_organization: Callable[[], Awaitable[bool]],
    ) -> bool:
        """Whether the organization holds this slug, which this project may not use.
        Told only to a caller who manages the organization's connections: anyone else
        reads `not_found`, so a draft cannot probe for connection names."""
        if not await manages_organization():
            return False
        rows = await self.vault_service.list_organization_secrets(
            organization_id=scope.organization_id
        )
        return any(row.slug == slug for row in rows)

    async def _llm(
        self,
        *,
        scope: AuthScope,
        llm: LlmReference,
        project_rows: Sequence[SecretResponseDTO],
        organization_rows: Sequence[SecretResponseDTO],
        manages_organization: Callable[[], Awaitable[bool]],
    ) -> List[_Found]:
        connection = llm.connection_item()
        if llm.account_source == "user" and llm.user_login_item() is None:
            # A login each person brings, for a provider no login serves: the run
            # fails with this model, so the model is what needs changing.
            return [_Found(llm.model_item(), reason=_REASON.NOT_AVAILABLE)]
        if connection is None:
            # The operator's own login on the runner: not an Agenta item.
            return []

        if connection.kind == _KIND.SUBSCRIPTION.value:
            return await self._subscription(
                scope=scope,
                manages_organization=manages_organization,
                llm=llm,
                item=connection,
                rows=organization_rows if llm.is_organization else project_rows,
                candidates=sum(
                    1
                    for row in (*project_rows, *organization_rows)
                    if row.kind == SecretKind.SUBSCRIPTION_PROVIDER
                    and _subscription_ready(row)
                ),
            )

        model_key_candidates = sum(
            1
            for row in (*project_rows, *organization_rows)
            if row.kind in _MODEL_KEY_KINDS
            and (not llm.provider or _family(row) == llm.provider)
        )

        if (
            not llm.slug
            and llm.provider
            and llm.provider != "mock"
            and not _harness_allows(llm.harness, llm.provider)
        ):
            return [_Found(llm.model_item(), reason=_REASON.NOT_AVAILABLE)]

        (
            outcome,
            resolution,
        ) = await self.llm_gateway_service.agent_connection_requirement(
            scope=scope,
            model=llm.model,
            provider_key=llm.provider,
            connection_slug=llm.slug,
            connection_namespace=(
                GatewayEndpointNamespace(llm.namespace) if llm.namespace else None
            ),
            connection_scope=(
                SecretOwnerKind.ORGANIZATION
                if llm.is_organization
                else SecretOwnerKind.PROJECT
            ),
        )
        if outcome is None:
            # The run's post-resolve check: the harness must consume the pair the
            # connection resolved to (a named connection's provider is known only here).
            if resolution is not None and not _harness_allows_pair(
                llm.harness,
                resolution.provider_key,
                getattr(
                    resolution.deployment_kind, "value", resolution.deployment_kind
                ),
            ):
                return [_Found(llm.model_item(), reason=_REASON.NOT_AVAILABLE)]
            return []
        kind, reason = outcome
        if kind == _KIND.MODEL.value:
            return [_Found(llm.model_item(), reason=AgentRequirementReason(reason))]
        reason_value = AgentRequirementReason(reason)
        if (
            reason_value == _REASON.NOT_FOUND
            and llm.is_organization
            and llm.slug
            and await self._not_shared(
                scope=scope, slug=llm.slug, manages_organization=manages_organization
            )
        ):
            reason_value = _REASON.NOT_SHARED
        return [
            _Found(connection, reason=reason_value, candidates=model_key_candidates)
        ]

    async def _subscription(
        self,
        *,
        scope: AuthScope,
        manages_organization: Callable[[], Awaitable[bool]],
        llm: LlmReference,
        item: ItemReference,
        rows: Sequence[SecretResponseDTO],
        candidates: int,
    ) -> List[_Found]:
        row = next(
            (
                row
                for row in rows
                if row.kind == SecretKind.SUBSCRIPTION_PROVIDER and row.slug == llm.slug
            ),
            None,
        )
        if row is None:
            reason = _REASON.NOT_FOUND
            if (
                llm.is_organization
                and llm.slug
                and await self._not_shared(
                    scope=scope,
                    slug=llm.slug,
                    manages_organization=manages_organization,
                )
            ):
                reason = _REASON.NOT_SHARED
            return [_Found(item, reason=reason, candidates=candidates)]
        # The run's order: a login this harness cannot drive is a model to change,
        # before its sign-in state matters.
        provider = getattr(row.data, "provider", None)
        provider = str(getattr(provider, "value", provider) or "")
        if not subscription_runs_on(provider, _harness_kind(llm.harness)):
            return [_Found(llm.model_item(), reason=_REASON.NOT_AVAILABLE)]
        if not _subscription_ready(row):
            return [_Found(item, reason=_REASON.NEEDS_SIGN_IN, candidates=candidates)]
        return []

    async def _mcp_servers(
        self, *, scope: AuthScope, items: Sequence[ItemReference]
    ) -> List[_Found]:
        endpoints = await self.mcp_gateway_service.query_endpoints(
            project_id=scope.project_id
        )
        by_slug = {
            endpoint.slug: endpoint
            for endpoint in endpoints
            if endpoint.namespace == GatewayEndpointNamespace.CUSTOM and endpoint.slug
        }
        candidates = sum(
            1
            for endpoint in by_slug.values()
            if endpoint.flags.is_active and _mcp_ready(endpoint)
        )
        found: List[_Found] = []
        for item in items:
            endpoint = by_slug.get(item.reference.get("slug"))
            if endpoint is None:
                found.append(
                    _Found(item, reason=_REASON.NOT_FOUND, candidates=candidates)
                )
            elif not endpoint.flags.is_active:
                found.append(
                    _Found(item, reason=_REASON.TURNED_OFF, candidates=candidates)
                )
            elif not _mcp_ready(endpoint):
                # The sign-in check runs only when the server exists.
                found.append(
                    _Found(
                        item,
                        reason=_REASON.NEEDS_SIGN_IN,
                        kind=_KIND.MCP_SIGN_IN,
                        candidates=candidates,
                    )
                )
        return found

    async def _secrets(
        self,
        *,
        scope: AuthScope,
        items: Sequence[ItemReference],
        project_rows: Sequence[SecretResponseDTO],
        organization_rows: Sequence[SecretResponseDTO],
        manages_organization: Decision,
    ) -> List[_Found]:
        """A project reference reads the project's secrets; an organization reference
        (`namespace: "organization"`) reads the organization's secrets shared with it."""
        present = {
            None: {row.slug for row in project_rows if _is_text_secret(row)},
            "organization": {
                row.slug for row in organization_rows if _is_text_secret(row)
            },
        }
        found: List[_Found] = []
        for item in items:
            namespace = item.reference.get("namespace")
            slug = item.reference.get("slug")
            slugs = present.get(namespace, set())
            if slug in slugs:
                continue
            reason = _REASON.NOT_FOUND
            if namespace == "organization" and await self._not_shared(
                scope=scope, slug=slug, manages_organization=manages_organization
            ):
                reason = _REASON.NOT_SHARED
            found.append(_Found(item, reason=reason, candidates=len(slugs)))
        return found

    async def _app_connections(
        self, *, scope: AuthScope, items: Sequence[ItemReference]
    ) -> List[_Found]:
        connections = await self.connections_service.query_connections(
            project_id=scope.project_id, is_active=None
        )
        by_key: Dict[Tuple[str, str, str], object] = {
            (
                connection.provider_key,
                connection.integration_key,
                connection.slug,
            ): connection
            for connection in connections
        }
        found: List[_Found] = []
        for item in items:
            reference = item.reference
            integration = reference.get("integration")
            candidates = sum(
                1
                for connection in connections
                if connection.integration_key == integration
                and connection.is_active
                and connection.is_valid
            )
            connection = by_key.get(
                (reference.get("provider"), integration, reference.get("slug"))
            )
            if connection is None:
                reason = _REASON.NOT_FOUND
            elif not connection.is_active:
                reason = _REASON.TURNED_OFF
            elif not connection.is_valid or (
                connection.has_auth and not connection.provider_connection_id
            ):
                reason = _REASON.NEEDS_SIGN_IN
            else:
                continue
            found.append(_Found(item, reason=reason, candidates=candidates))
        return found

    # -- the caller's fix ----------------------------------------------------------------

    @classmethod
    def _requirement_of(
        cls,
        entry: _Found,
        *,
        can_edit_agent: bool,
        permissions: Dict[Permission, bool],
        may_run: bool,
        manages_organization: bool,
    ) -> AgentRequirement:
        if entry.by_person:
            return cls._user_requirement(
                entry, can_edit_agent=can_edit_agent, may_run=may_run
            )
        return cls._requirement(
            entry,
            can_edit_agent=can_edit_agent,
            permissions=permissions,
            manages_organization=manages_organization,
        )

    @staticmethod
    def _requirement(
        entry: _Found,
        *,
        can_edit_agent: bool,
        permissions: Dict[Permission, bool],
        manages_organization: bool,
    ) -> AgentRequirement:
        if entry.is_organization:
            # Only who manages the organization's connections adds or shares one.
            manages = manages_organization
        else:
            permission = _MANAGE_PERMISSION[entry.kind]
            manages = bool(permission is not None and permissions.get(permission))
        sign_in = entry.reason == _REASON.NEEDS_SIGN_IN
        can_sign_in = sign_in and manages
        can_connect = not sign_in and entry.kind != _KIND.MODEL and manages
        ask: Optional[AgentRequirementAsk] = None
        if entry.reason == _REASON.NOT_SHARED or (
            entry.is_organization and not manages
        ):
            # Only the organization adds, shares or signs in its own item.
            ask = AgentRequirementAsk(role="organization_admin")
        elif sign_in and not can_sign_in:
            ask = AgentRequirementAsk(role="project_admin")
        elif not sign_in and not can_edit_agent:
            ask = AgentRequirementAsk(role="agent_editor")
        shape = requirement(
            entry.item, reason=entry.reason.value, kind=entry.kind.value
        )
        return AgentRequirement(
            **shape,
            fix=AgentRequirementFix(
                can_edit_agent=can_edit_agent,
                can_connect=can_connect,
                can_sign_in=can_sign_in,
                candidates=entry.candidates,
                ask=ask,
            ),
        )

    @staticmethod
    def _user_requirement(
        entry: _Found, *, can_edit_agent: bool, may_run: bool
    ) -> AgentRequirement:
        """A person sets up only their own account, so anyone who may run the agent
        gets the fix. Nobody else can do it for them, so there is no `ask`."""
        shape = requirement(
            entry.item, reason=entry.reason.value, kind=entry.kind.value
        )
        if not entry.fixable:
            return AgentRequirement(**shape)
        sign_in = entry.kind in (_KIND.MCP_SERVER, _KIND.MCP_SIGN_IN) or (
            entry.reason == _REASON.NEEDS_SIGN_IN
        )
        return AgentRequirement(
            **shape,
            fix=AgentRequirementFix(
                can_edit_agent=can_edit_agent,
                can_connect=may_run and not sign_in,
                can_sign_in=may_run and sign_in,
                candidates=entry.candidates,
            ),
        )


async def _never() -> bool:
    return False


def _once(decision: Decision) -> Decision:
    """The decision, asked at most once per check."""
    answers: List[bool] = []

    async def ask() -> bool:
        if not answers:
            answers.append(bool(await decision()))
        return answers[0]

    return ask


def _harness_allows(harness: Optional[str], provider: str) -> bool:
    """The run's pre-resolve provider check, for a connection with no slug. An agent
    with no harness runs the default one; an unknown harness is refused by the run
    itself, not reported here."""
    kind = _harness_kind(harness)
    if kind not in HARNESS_CONNECTION_CAPABILITIES:
        return True
    return harness_allows_provider(kind, provider)


def _harness_kind(harness: Optional[str]) -> str:
    """The harness a run uses: the agent's, or the default one."""
    return harness or str(getattr(_DEFAULT_HARNESS, "value", _DEFAULT_HARNESS))


def _harness_allows_pair(
    harness: Optional[str], provider: Optional[str], deployment: Optional[str]
) -> bool:
    kind = _harness_kind(harness)
    if kind not in HARNESS_CONNECTION_CAPABILITIES or not provider or not deployment:
        return True
    return harness_allows_pair(kind, provider, deployment)


_DEFAULT_HARNESS = AgentTemplate.model_fields["harness"].default


__all__ = ["AgentRequirementsService", "Allowed"]
