"""Test helpers for organization credentials (M5).

- `owner_scope(owner)`: the (project_id, organization_id) pair an owner names.
- `InMemorySecretsDAO`: an owner-based `SecretsDAOInterface` (organization connections
  with `shareable=True`) and `load_effective`, counting every call.
- `make_auth_scope(...)`: the one place tests build an `AuthScope`.
- `org_secret_payload(...)`: a create body for an organization credential.
- `SENTINEL_KEY`: a credential value that log and response sweeps search for.
"""

from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID, uuid4

from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    CreateSecretDTO,
    SecretOwner,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import (
    ORGANIZATION_SECRET_KINDS,
    SecretAvailability,
    SecretOwnerKind,
)
from oss.src.core.secrets.types import (
    ProjectNotInOrganization,
    SecretSlugConflict,
)
from oss.src.utils.context import AuthScope

SENTINEL_KEY = "sk-m5sentinel-0123456789abcdef"


def owner_scope(owner: SecretOwner) -> Tuple[Optional[UUID], Optional[UUID]]:
    if owner.kind == SecretOwnerKind.PROJECT:
        return owner.id, None
    if owner.kind == SecretOwnerKind.ORGANIZATION:
        return None, owner.id
    raise ValueError("User-owned secrets are not stored in this release.")


def make_auth_scope(
    *,
    organization_id: UUID,
    project_id: UUID,
    user_id: Optional[UUID] = None,
) -> AuthScope:
    """The only `AuthScope` constructor in the M5 tests."""
    return AuthScope(
        organization_id=organization_id,
        workspace_id=organization_id,
        project_id=project_id,
        user_id=user_id or uuid4(),
    )


def org_secret_payload(
    *,
    kind: str = "provider_key",
    family: str = "openai",
    key: str = SENTINEL_KEY,
    slug: Optional[str] = None,
    name: Optional[str] = None,
    url: str = "https://llm.example.com/v1",
    models: Sequence[str] = ("gpt-4o-mini",),
    extras: Optional[dict] = None,
) -> dict:
    if kind == "provider_key":
        body = {
            "header": {"name": name or "OpenAI"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": family, "provider": {"key": key}},
            },
        }
    elif kind == "custom_provider":
        provider = {"url": url, "key": key}
        if extras is not None:
            provider["extras"] = extras
        body = {
            "header": {"name": name or "Company provider"},
            "secret": {
                "kind": "custom_provider",
                "data": {
                    "kind": family,
                    "provider": provider,
                    "models": [{"slug": model} for model in models],
                },
            },
        }
    else:
        raise ValueError(kind)
    if slug:
        body["slug"] = slug
    return body


class InMemorySecretsDAO:
    """Owner-based `SecretsDAOInterface` over dicts. `calls` lists every method call.

    `projects` maps a project id to its organization id (the project rows the real DAO
    joins); `selected` maps an organization secret id to its selected project ids.
    """

    def __init__(self, *, projects: Optional[Dict[UUID, UUID]] = None):
        self.records: Dict[UUID, SecretResponseDTO] = {}
        self.projects: Dict[UUID, UUID] = dict(projects or {})
        self.selected: Dict[UUID, List[UUID]] = {}
        self.calls: List[str] = []

    # helpers ------------------------------------------------------------------------

    def _of(
        self, owner: SecretOwner, shareable: bool = False
    ) -> List[SecretResponseDTO]:
        owner_scope(owner)
        return [
            r
            for r in self.records.values()
            if r.owner == owner
            and (not shareable or r.kind in ORGANIZATION_SECRET_KINDS)
        ]

    def _available(self, secret: SecretResponseDTO, project_id: UUID) -> bool:
        if secret.availability == SecretAvailability.SELECTED_PROJECTS:
            return project_id in self.selected.get(secret.id, [])
        return True

    def _org_rows(self, organization_id: UUID) -> List[SecretResponseDTO]:
        return [
            r
            for r in self.records.values()
            if r.owner
            and r.owner.kind == SecretOwnerKind.ORGANIZATION
            and r.owner.id == organization_id
            and r.kind in ORGANIZATION_SECRET_KINDS
        ]

    def _store(self, record: SecretResponseDTO) -> SecretResponseDTO:
        self.records[record.id] = record
        return record

    def _build(
        self, *, owner, dto: CreateSecretDTO, availability=None, management=None
    ):
        return SecretResponseDTO(
            id=uuid4(),
            slug=dto.slug,
            kind=dto.secret.kind,
            data=dto.secret.data.model_dump(mode="json", exclude_none=True),
            header=dto.header,
            write_only=dto.write_only,
            management=management,
            owner=owner,
            availability=availability,
        )

    def _slug_taken(self, owner: SecretOwner, slug: Optional[str]) -> bool:
        return bool(slug) and any(r.slug == slug for r in self._of(owner))

    # owner-based CRUD ----------------------------------------------------------------

    async def create(
        self,
        *,
        owner,
        create_secret_dto,
        management=None,
        availability=None,
        project_ids=(),
        user_id=None,
    ):
        self.calls.append("create")
        selected = (
            self._check_projects(owner.id, project_ids)
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )
        if self._slug_taken(owner, create_secret_dto.slug):
            raise SecretSlugConflict(slug=create_secret_dto.slug)
        row = self._store(
            self._build(
                owner=owner,
                dto=create_secret_dto,
                availability=availability,
                management=management,
            )
        )
        if selected:
            self.selected[row.id] = selected
        return self._with_selected(row) if availability is not None else row

    def _find(self, owner, secret_id, shareable):
        row = next((r for r in self._of(owner, shareable) if r.id == secret_id), None)
        if row is not None and shareable:
            return self._with_selected(row)
        return row

    async def get_by_id(self, *, owner, secret_id, shareable=False):
        self.calls.append("get_by_id")
        return self._find(owner, secret_id, shareable)

    async def get_by_slug(self, *, owner, secret_slug):
        self.calls.append("get_by_slug")
        return next((r for r in self._of(owner) if r.slug == secret_slug), None)

    async def list(self, *, owner, shareable=False):
        self.calls.append("list")
        rows = self._of(owner, shareable)
        return [self._with_selected(r) for r in rows] if shareable else rows

    async def update(
        self,
        *,
        owner,
        secret_id,
        update_secret_dto,
        user_id=None,
        resolve_update=None,
        shareable=False,
    ):
        self.calls.append("update")
        stored = self._find(owner, secret_id, shareable)
        if stored is None:
            return None
        if resolve_update is not None:
            resolved = resolve_update(stored, update_secret_dto)
            if resolved is None:
                return stored
            update_secret_dto = resolved
        updated = self._store(self._updated(stored, update_secret_dto))
        return self._with_selected(updated) if shareable else updated

    def _updated(self, stored: SecretResponseDTO, update_secret_dto):
        body = stored.model_dump(mode="python")
        if update_secret_dto.header is not None:
            header = dict(body["header"] or {})
            header.update(update_secret_dto.header.model_dump(exclude_none=True))
            body["header"] = header
        if update_secret_dto.secret is not None:
            body["kind"] = update_secret_dto.secret.kind
            body["data"] = update_secret_dto.secret.data.model_dump(
                mode="json", exclude_none=True
            )
        return SecretResponseDTO.model_validate(body)

    async def delete(self, *, owner, secret_id, authorize_delete=None, shareable=False):
        self.calls.append("delete")
        stored = self._find(owner, secret_id, shareable)
        if stored is None:
            return None
        if authorize_delete is not None:
            authorize_delete(stored)
        self.records.pop(secret_id, None)
        self.selected.pop(secret_id, None)
        return stored

    # effective set ----------------------------------------------------------------

    async def load_effective(self, *, project_id):
        self.calls.append("load_effective")
        if project_id not in self.projects:
            return CachedEffectiveSecrets(project_id=project_id)
        organization_id = self.projects[project_id]
        own = self._of(SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id))
        organization = [
            r.model_copy(update={"selected_project_ids": None})
            for r in self._org_rows(organization_id)
            if self._available(r, project_id)
        ]
        return CachedEffectiveSecrets(
            project_id=project_id,
            organization_id=organization_id,
            secrets=own,
            organization=organization,
        )

    # organization operations ------------------------------------------------------

    def _with_selected(self, row: SecretResponseDTO) -> SecretResponseDTO:
        selected = (
            sorted(self.selected.get(row.id, []))
            if row.availability == SecretAvailability.SELECTED_PROJECTS
            else None
        )
        return row.model_copy(update={"selected_project_ids": selected})

    def _check_projects(self, organization_id, project_ids):
        wanted = list(dict.fromkeys(project_ids))
        if any(self.projects.get(p) != organization_id for p in wanted):
            raise ProjectNotInOrganization(project_ids=wanted)
        return wanted

    async def set_availability(
        self, *, owner, secret_id, availability, project_ids, user_id
    ):
        self.calls.append("set_availability")
        stored = self._find(owner, secret_id, True)
        if stored is None:
            return None
        selected = (
            self._check_projects(owner.id, project_ids)
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )
        updated = self._store(stored.model_copy(update={"availability": availability}))
        self.selected[secret_id] = selected
        return self._with_selected(updated)

    async def list_organization_project_ids(self, *, organization_id):
        self.calls.append("list_organization_project_ids")
        return [p for p, o in self.projects.items() if o == organization_id]


class RecordingCacheEngine:
    """An in-memory stand-in for the Redis cache engine behind `oss.src.utils.caching`.

    Install it with `install_cache_engine(monkeypatch)`: the REAL `get_cache`, `set_cache`
    and `invalidate_cache` then run on it, so the lock path and every command are counted
    (`commands`: "GET", "SET NX", "SET", "DEL", "SCAN"). `fail=True` makes every command
    raise, like a Redis that is down.
    """

    def __init__(self, *, fail: bool = False):
        self.store: Dict[str, bytes] = {}
        self.commands: List[str] = []
        self.fail = fail

    @staticmethod
    def _name(name) -> str:
        return name.decode() if isinstance(name, (bytes, bytearray)) else str(name)

    def _record(self, command: str) -> None:
        self.commands.append(command)
        if self.fail:
            raise ConnectionError("redis is down (test)")

    async def get(self, name):
        self._record("GET")
        return self.store.get(self._name(name))

    async def set(self, name, value, nx: bool = False, px=None, **_):
        self._record("SET NX" if nx else "SET")
        name = self._name(name)
        if nx and name in self.store:
            return None
        self.store[name] = value if isinstance(value, bytes) else str(value).encode()
        return True

    async def delete(self, *names):
        self._record("DEL")
        count = 0
        for name in names:
            count += self.store.pop(self._name(name), None) is not None
        return count

    async def scan(self, cursor=0, match=None, count=None):
        from fnmatch import fnmatchcase

        self._record("SCAN")
        return 0, [k for k in self.store if match is None or fnmatchcase(k, match)]

    async def expire(self, name, ttl):
        self._record("EXPIRE")
        return True

    async def mget(self, names):
        self._record("MGET")
        return [self.store.get(self._name(n)) for n in names]


def install_cache_engine(monkeypatch, *, fail: bool = False) -> RecordingCacheEngine:
    """Run the real cache helpers on a `RecordingCacheEngine`, with no early leak."""
    from oss.src.utils import caching
    from oss.src.utils.env import env

    engine = RecordingCacheEngine(fail=fail)
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True)
    monkeypatch.setattr(caching, "_cache_engine", engine)
    monkeypatch.setattr(caching, "random", lambda: 0.99)
    return engine


async def load_effective_from_list(self, *, project_id):
    """`load_effective` for the older in-memory fakes: the project's rows from the fake's
    own `list`, no organization (so no organization connection is available)."""
    secrets = await self.list(
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id)
    )
    return CachedEffectiveSecrets(project_id=project_id, secrets=list(secrets or []))
