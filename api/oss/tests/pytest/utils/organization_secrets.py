"""Test helpers for organization credentials (M5).

- `owner_scope(owner)`: the (project_id, organization_id) pair an owner names, for the
  older in-memory fakes that still keep records by that pair.
- `InMemorySecretsDAO`: an owner-based `SecretsDAOInterface` with the organization
  operations, `load_effective` and the shadow rule, counting every call.
- `make_auth_scope(...)`: the one place tests build an `AuthScope`.
- `org_secret_payload(...)`: a create body for an organization credential.
- `SENTINEL_KEY`: a credential value that log and response sweeps search for.
"""

from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID, uuid4

from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    OrganizationSecretDeleted,
    CreateSecretDTO,
    SecretOwner,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import (
    INHERITABLE_KINDS,
    SecretAvailability,
    SecretKind,
    SecretOwnerKind,
)
from oss.src.core.secrets.types import (
    ProjectNotInOrganization,
    SecretShadowConflict,
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


def _family(secret) -> Optional[str]:
    kind = getattr(secret.data, "kind", None)
    return None if kind is None else str(getattr(kind, "value", kind))


def _same_identity(a_kind, a_family, b_kind, b_family) -> bool:
    if a_kind != b_kind:
        return False
    if a_kind == SecretKind.PROVIDER_KEY:
        return a_family == b_family
    return True


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

    def _of(self, owner: SecretOwner) -> List[SecretResponseDTO]:
        owner_scope(owner)
        return [r for r in self.records.values() if r.owner == owner]

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
            and r.kind in INHERITABLE_KINDS
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
        check_shadow=False,
    ):
        self.calls.append("create")
        if self._slug_taken(owner, create_secret_dto.slug):
            raise SecretSlugConflict(slug=create_secret_dto.slug)
        if check_shadow and owner.kind == SecretOwnerKind.PROJECT:
            organization_id = self.projects.get(owner.id)
            for row in self._org_rows(organization_id) if organization_id else []:
                if (
                    row.slug == create_secret_dto.slug
                    and self._available(row, owner.id)
                    and not _same_identity(
                        row.kind,
                        _family(row),
                        create_secret_dto.secret.kind,
                        _family(create_secret_dto.secret),
                    )
                ):
                    raise SecretShadowConflict(slug=create_secret_dto.slug)
        return self._store(
            self._build(owner=owner, dto=create_secret_dto, management=management)
        )

    async def get_by_id(self, *, owner, secret_id):
        self.calls.append("get_by_id")
        return next((r for r in self._of(owner) if r.id == secret_id), None)

    async def get_by_slug(self, *, owner, secret_slug):
        self.calls.append("get_by_slug")
        return next((r for r in self._of(owner) if r.slug == secret_slug), None)

    async def list(self, *, owner):
        self.calls.append("list")
        return list(self._of(owner))

    async def update(
        self,
        *,
        owner,
        secret_id,
        update_secret_dto,
        user_id=None,
        resolve_update=None,
        check_shadow=False,
    ):
        self.calls.append("update")
        stored = next((r for r in self._of(owner) if r.id == secret_id), None)
        if stored is None:
            return None
        if resolve_update is not None:
            resolved = resolve_update(stored, update_secret_dto)
            if resolved is None:
                return stored
            update_secret_dto = resolved
        if check_shadow and update_secret_dto.secret is not None:
            organization_id = self.projects.get(owner.id)
            for row in self._org_rows(organization_id) if organization_id else []:
                if (
                    row.slug == stored.slug
                    and self._available(row, owner.id)
                    and not _same_identity(
                        row.kind,
                        _family(row),
                        update_secret_dto.secret.kind,
                        _family(update_secret_dto.secret),
                    )
                ):
                    raise SecretShadowConflict(slug=stored.slug or "")
        return self._store(self._updated(stored, update_secret_dto))

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

    async def delete(self, *, owner, secret_id, authorize_delete=None):
        self.calls.append("delete")
        stored = next((r for r in self._of(owner) if r.id == secret_id), None)
        if stored is None:
            return
        if authorize_delete is not None:
            authorize_delete(stored)
        self.records.pop(secret_id, None)

    # effective set ----------------------------------------------------------------

    async def load_effective(self, *, project_id):
        self.calls.append("load_effective")
        if project_id not in self.projects:
            return CachedEffectiveSecrets(project_id=project_id)
        organization_id = self.projects[project_id]
        own = self._of(SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id))
        inherited = [
            r.model_copy(update={"selected_project_ids": None})
            for r in self._org_rows(organization_id)
            if self._available(r, project_id)
        ]
        return CachedEffectiveSecrets(
            project_id=project_id,
            organization_id=organization_id,
            secrets=own,
            inherited=inherited,
        )

    # organization operations ------------------------------------------------------

    def _with_selected(self, row: SecretResponseDTO) -> SecretResponseDTO:
        selected = (
            sorted(self.selected.get(row.id, []))
            if row.availability == SecretAvailability.SELECTED_PROJECTS
            else None
        )
        return row.model_copy(update={"selected_project_ids": selected})

    def _check_org_conflicts(
        self, *, organization_id, slug, kind, family, availability, project_ids
    ):
        if not slug:
            return
        for project_id, project_organization in self.projects.items():
            if project_organization != organization_id:
                continue
            if (
                availability == SecretAvailability.SELECTED_PROJECTS
                and project_id not in project_ids
            ):
                continue
            for row in self._of(
                SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id)
            ):
                if row.slug == slug and not _same_identity(
                    row.kind, _family(row), kind, family
                ):
                    raise SecretShadowConflict(slug=slug)

    def _check_projects(self, organization_id, project_ids):
        wanted = list(dict.fromkeys(project_ids))
        if any(self.projects.get(p) != organization_id for p in wanted):
            raise ProjectNotInOrganization(project_ids=wanted)
        return wanted

    async def list_organization_secrets(self, *, organization_id):
        self.calls.append("list_organization_secrets")
        return [self._with_selected(r) for r in self._org_rows(organization_id)]

    async def fetch_organization_secret(self, *, organization_id, secret_id):
        self.calls.append("fetch_organization_secret")
        row = next(
            (r for r in self._org_rows(organization_id) if r.id == secret_id), None
        )
        return self._with_selected(row) if row else None

    async def create_organization_secret(
        self, *, organization_id, create_secret_dto, availability, project_ids, user_id
    ):
        self.calls.append("create_organization_secret")
        owner = SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=organization_id)
        selected = (
            self._check_projects(organization_id, project_ids)
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )
        self._check_org_conflicts(
            organization_id=organization_id,
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            family=_family(create_secret_dto.secret),
            availability=availability,
            project_ids=selected,
        )
        if self._slug_taken(owner, create_secret_dto.slug):
            raise SecretSlugConflict(slug=create_secret_dto.slug)
        row = self._store(
            self._build(owner=owner, dto=create_secret_dto, availability=availability)
        )
        if selected:
            self.selected[row.id] = selected
        return self._with_selected(row)

    async def update_organization_secret(
        self, *, organization_id, secret_id, update_secret_dto, user_id, resolve_update
    ):
        self.calls.append("update_organization_secret")
        stored = next(
            (r for r in self._org_rows(organization_id) if r.id == secret_id), None
        )
        if stored is None:
            return None
        resolved = resolve_update(self._with_selected(stored), update_secret_dto)
        if resolved is None:
            return self._with_selected(stored)
        updated = self._updated(stored, resolved)
        self._check_org_conflicts(
            organization_id=organization_id,
            slug=stored.slug,
            kind=updated.kind,
            family=_family(updated),
            availability=stored.availability,
            project_ids=self.selected.get(secret_id, []),
        )
        return self._with_selected(self._store(updated))

    async def delete_organization_secret(self, *, organization_id, secret_id):
        self.calls.append("delete_organization_secret")
        row = next(
            (r for r in self._org_rows(organization_id) if r.id == secret_id), None
        )
        if row is None:
            return None
        self.records.pop(secret_id)
        selected = self.selected.pop(secret_id, None) or []
        return OrganizationSecretDeleted(
            secret_id=row.id,
            kind=row.kind,
            availability=row.availability or SecretAvailability.ALL_PROJECTS,
            selected_count=len(selected),
        )

    async def set_organization_secret_availability(
        self, *, organization_id, secret_id, availability, project_ids, user_id
    ):
        self.calls.append("set_organization_secret_availability")
        stored = next(
            (r for r in self._org_rows(organization_id) if r.id == secret_id), None
        )
        if stored is None:
            return None
        selected = (
            self._check_projects(organization_id, project_ids)
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )
        self._check_org_conflicts(
            organization_id=organization_id,
            slug=stored.slug,
            kind=stored.kind,
            family=_family(stored),
            availability=availability,
            project_ids=selected,
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
    own `list`, no organization (so nothing is inherited)."""
    secrets = await self.list(
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id)
    )
    return CachedEffectiveSecrets(project_id=project_id, secrets=list(secrets or []))


async def retry_write_conflict(make_call, *, attempts: int = 5):
    """Run a fixture write again when it answers `SecretWriteConflict`.

    On a small test database Postgres scans `secrets` and `projects` whole, so its
    serializable reads lock the whole table and parallel tests abort one another more
    often than a real deployment does. Setup writes retry here; measured calls never do.
    """
    import asyncio

    from oss.src.core.secrets.types import SecretWriteConflict

    for attempt in range(1, attempts + 1):
        try:
            return await make_call()
        except SecretWriteConflict:
            if attempt == attempts:
                raise
            await asyncio.sleep(0.05 * attempt)
