from uuid import UUID, uuid4
from datetime import datetime
from typing import Any, Dict, Optional, Tuple, List

from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress

# New workflow services via adapter
from oss.src.services.legacy_adapter import get_legacy_adapter
from oss.src.core.applications.dtos import (
    Application,
    ApplicationVariant,
    ApplicationRevision,
)

# Old DB function - still needed for user lookup
from oss.src.services.db_manager import (
    get_user_with_id,
)

# New environment adapter
from oss.src.services.legacy_adapter import get_legacy_environments_adapter
from oss.src.core.shared.dtos import Reference, Windowing


log = get_module_logger(__name__)

### POSTGRES ASSUMPTIONS
# UNIQUE: (project_id, {entity}_id) -- PK
# UNIQUE: (project_id, application_id, {entity}_slug, {entity}_version)


class ReferenceDTO(BaseModel):
    slug: Optional[str] = None  # shared across versions
    version: Optional[int] = None
    commit_message: Optional[str] = None
    # ---
    id: Optional[UUID]  # unique per version

    class Config:
        json_encoders = {UUID: str}

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email


# DIFFERENT FROM A configuration IN THE SENSE OF Application Structure
# HERE IT IS A PROXY FOR A variant
class ConfigDTO(BaseModel):
    params: Dict[str, Any]
    url: Optional[str] = None
    # ---
    application_ref: Optional[ReferenceDTO] = None
    service_ref: Optional[ReferenceDTO] = None
    variant_ref: Optional[ReferenceDTO] = None
    environment_ref: Optional[ReferenceDTO] = None
    # ----
    application_lifecycle: Optional[LegacyLifecycleDTO] = None
    service_lifecycle: Optional[LegacyLifecycleDTO] = None
    variant_lifecycle: Optional[LegacyLifecycleDTO] = None
    environment_lifecycle: Optional[LegacyLifecycleDTO] = None


# - HELPERS


async def _fetch_app(
    project_id: str,
    app_id: Optional[UUID] = None,
    app_name: Optional[str] = None,
) -> Optional[Application]:
    """Fetch an app using the new ApplicationsService via adapter."""
    adapter = get_legacy_adapter()
    app = None

    with suppress():
        if app_id:
            app = await adapter.fetch_app_by_id(
                project_id=UUID(project_id),
                app_id=app_id,
            )
        elif app_name:
            app = await adapter.fetch_app_by_name(
                project_id=UUID(project_id),
                app_name=app_name,
            )

    return app


async def _fetch_variant(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
) -> Tuple[Optional[ApplicationVariant], Optional[ApplicationRevision]]:
    """Fetch variant and revision using the new ApplicationsService via adapter."""
    adapter = get_legacy_adapter()
    app_variant_revision = None
    app_variant = None

    with suppress():
        # by variant_id (could be variant ID or revision ID)
        if variant_ref.id:
            # First try as revision ID
            app_variant_revision = await adapter.fetch_revision_by_id(
                project_id=UUID(project_id),
                revision_id=variant_ref.id,
            )
            if not app_variant_revision:
                # Try as variant ID
                app_variant = await adapter.fetch_variant_by_id(
                    project_id=UUID(project_id),
                    variant_id=variant_ref.id,
                )
                if app_variant:
                    # Get specific version or latest
                    if variant_ref.version:
                        app_variant_revision = await adapter.fetch_revision_by_version(
                            project_id=UUID(project_id),
                            variant_id=app_variant.id,
                            version=variant_ref.version,
                        )
                    else:
                        app_variant_revision = await adapter.fetch_latest_revision(
                            project_id=UUID(project_id),
                            variant_id=app_variant.id,
                        )

        # by application_id, variant_slug, and ...
        elif (
            application_ref
            and (application_ref.id or application_ref.slug)
            and variant_ref.slug
        ):
            if not application_ref.id and application_ref.slug:
                app = await adapter.fetch_app_by_name(
                    project_id=UUID(project_id),
                    app_name=application_ref.slug,
                )
                if app:
                    application_ref.id = app.id

            if not application_ref.id:
                return None, None

            # Fetch variant by slug (config_name)
            app_variant = await adapter.fetch_variant_by_slug(
                project_id=UUID(project_id),
                app_id=application_ref.id,
                variant_slug=variant_ref.slug,
            )
            if not app_variant:
                return None, None

            # Get specific version or latest
            if variant_ref.version:
                app_variant_revision = await adapter.fetch_revision_by_version(
                    project_id=UUID(project_id),
                    variant_id=app_variant.id,
                    version=variant_ref.version,
                )
            else:
                app_variant_revision = await adapter.fetch_latest_revision(
                    project_id=UUID(project_id),
                    variant_id=app_variant.id,
                )

        if not app_variant_revision:
            return None, None

        # If we have revision but not variant, fetch the variant
        if not app_variant and app_variant_revision:
            app_variant = await adapter.fetch_variant_by_id(
                project_id=UUID(project_id),
                variant_id=app_variant_revision.application_variant_id,
            )

    if not (app_variant_revision and app_variant):
        return None, None

    return app_variant, app_variant_revision


async def _fetch_variants(
    project_id: str,
    application_ref: ReferenceDTO,
) -> List[ApplicationVariant]:
    """Fetch all variants for an app using the new ApplicationsService via adapter."""
    adapter = get_legacy_adapter()
    app_variants: List[ApplicationVariant] = []

    with suppress():
        app_id = application_ref.id
        if not app_id and application_ref.slug:
            app = await adapter.fetch_app_by_name(
                project_id=UUID(project_id),
                app_name=application_ref.slug,
            )
            if app:
                app_id = app.id

        if app_id:
            app_variants = await adapter.query_variants_for_app(
                project_id=UUID(project_id),
                app_id=app_id,
            )

    return app_variants


async def _fetch_variant_versions(
    project_id: str,
    application_ref: Optional[ReferenceDTO],
    variant_ref: ReferenceDTO,
) -> Optional[List[ApplicationRevision]]:
    """Fetch all revisions for a variant using the new ApplicationsService via adapter."""
    adapter = get_legacy_adapter()
    variant_revisions: List[ApplicationRevision] = []

    with suppress():
        app_variant = None

        if variant_ref.id:
            app_variant = await adapter.fetch_variant_by_id(
                project_id=UUID(project_id),
                variant_id=variant_ref.id,
            )

        elif variant_ref.slug and application_ref is not None:
            app = await _fetch_app(
                project_id=project_id,
                app_name=application_ref.slug,
                app_id=application_ref.id,
            )

            if not app:
                return None

            application_ref.id = app.id

            app_variant = await adapter.fetch_variant_by_slug(
                project_id=UUID(project_id),
                app_id=application_ref.id,
                variant_slug=variant_ref.slug,
            )

        if not app_variant:
            return None

        variant_revisions = await adapter.query_revisions_for_variant(
            project_id=UUID(project_id),
            variant_id=app_variant.id,
        )

    return variant_revisions


def _extract_deployed_revision_id(
    references: Optional[Dict],
    app_slug: Optional[str],
) -> Optional[UUID]:
    """Extract the application_revision.id from the nested references dict.

    Each entry in ``references`` maps an app-scoped key
    (e.g. ``"my-app.revision"``) to a dict with keys
    ``"application"``, ``"application_variant"``, ``"application_revision"``,
    whose values are ``Reference`` objects (or raw dicts when Pydantic
    deserialization was skipped).
    """
    if not references or not app_slug:
        return None
    app_refs = references.get(f"{app_slug}.revision")
    if not app_refs or not isinstance(app_refs, dict):
        return None
    revision_ref = app_refs.get("application_revision")
    if revision_ref is None:
        return None
    # Reference object (normal path)
    if hasattr(revision_ref, "id") and revision_ref.id:
        return revision_ref.id
    # Raw dict fallback (e.g. un-hydrated JSON from DB)
    if isinstance(revision_ref, dict):
        rev_id = revision_ref.get("id")
        if isinstance(rev_id, UUID):
            return rev_id
        if isinstance(rev_id, str):
            with suppress(Exception):
                return UUID(rev_id)
    return None


class _EnvironmentShim:
    """Lightweight shim mimicking old AppEnvironmentDB attributes."""

    def __init__(self, *, name: str, id: Optional[UUID] = None):
        self.name = name
        self.id = id


class _EnvironmentRevisionShim:
    """Lightweight shim mimicking old AppEnvironmentRevisionDB attributes."""

    def __init__(
        self,
        *,
        id: Optional[UUID] = None,
        revision: Optional[int] = None,
        deployed_app_variant_revision_id: Optional[UUID] = None,
        environment_id: Optional[UUID] = None,
        commit_message: Optional[str] = None,
        created_at: Optional[datetime] = None,
        project_id: Optional[str] = None,
    ):
        self.id = id
        self.revision = revision
        self.deployed_app_variant_revision_id = deployed_app_variant_revision_id
        self.environment_id = environment_id
        self.commit_message = commit_message
        self.created_at = created_at
        self.project_id = project_id


async def _fetch_environment(
    project_id: str,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
) -> Tuple[Optional[_EnvironmentShim], Optional[_EnvironmentRevisionShim]]:
    """Fetch environment and revision from the new git-based environment tables.

    Returns shim objects that provide the same attributes as the old
    AppEnvironmentDB / AppEnvironmentRevisionDB so that callers don't
    need to change.
    """

    env_adapter = get_legacy_environments_adapter()

    with suppress():
        # Resolve the application slug (needed for reading revision data)
        app_slug: Optional[str] = None
        if application_ref and (application_ref.id or application_ref.slug):
            if application_ref.slug:
                app_slug = application_ref.slug
            if application_ref.id and not app_slug:
                app_slug = await env_adapter._resolve_app_slug(
                    project_id=UUID(project_id),
                    app_id=application_ref.id,
                )
            # Resolve id from slug if needed
            if not application_ref.id and application_ref.slug:
                adapter = get_legacy_adapter()
                app = await adapter.fetch_app_by_name(
                    project_id=UUID(project_id),
                    app_name=application_ref.slug,
                )
                if app:
                    application_ref.id = app.id
                    if not app_slug:
                        app_slug = app.slug

        # -----------------------------------------------------------
        # CASE 1: lookup by environment revision id
        # -----------------------------------------------------------
        if environment_ref.id:
            # The id here is an *environment revision* id.
            env_revisions = (
                env_adapter.environments_service.query_environment_revisions(
                    project_id=UUID(project_id),
                    environment_revision_refs=[Reference(id=environment_ref.id)],
                    windowing=Windowing(limit=1),
                )
            )
            env_revisions = await env_revisions
            if not env_revisions:
                return None, None

            env_rev = env_revisions[0]

            # Resolve the environment artifact from the revision
            env_id = env_rev.environment_id or env_rev.artifact_id
            if not env_id:
                return None, None

            env = await env_adapter.environments_service.fetch_environment(
                project_id=UUID(project_id),
                environment_ref=Reference(id=env_id),
            )
            if not env:
                return None, None

            # Extract deployed_app_variant_revision_id from revision data
            deployed_variant_revision_id = _extract_deployed_revision_id(
                env_rev.data.references if env_rev.data else None,
                app_slug,
            )

            env_shim = _EnvironmentShim(name=env.slug, id=env.id)
            rev_shim = _EnvironmentRevisionShim(
                id=env_rev.id,
                revision=None,
                deployed_app_variant_revision_id=deployed_variant_revision_id,
                environment_id=env.id,
                commit_message=env_rev.message,
                created_at=env_rev.created_at,
                project_id=project_id,
            )
            return env_shim, rev_shim

        # -----------------------------------------------------------
        # CASE 2: lookup by environment slug + application ref
        # -----------------------------------------------------------
        if environment_ref.slug:
            env = await env_adapter.environments_service.fetch_environment(
                project_id=UUID(project_id),
                environment_ref=Reference(slug=environment_ref.slug),
            )
            if not env:
                return None, None

            env_shim = _EnvironmentShim(name=env.slug, id=env.id)

            # Fetch variant + revisions for this environment
            env_variant = (
                await env_adapter.environments_service.fetch_environment_variant(
                    project_id=UUID(project_id),
                    environment_ref=Reference(id=env.id),
                )
            )
            if not env_variant:
                return env_shim, None

            # Fetch all revisions (ordered latest-first via descending UUID7)
            env_revisions = (
                await env_adapter.environments_service.query_environment_revisions(
                    project_id=UUID(project_id),
                    environment_variant_refs=[Reference(id=env_variant.id)],
                    windowing=Windowing(),
                )
            )
            if not env_revisions:
                return env_shim, None

            # Resolve version: None or 0 means latest, positive means offset
            target_rev = None
            version = None
            ref_key = f"{app_slug}.revision" if app_slug else None

            if environment_ref.version is None or environment_ref.version == 0:
                # Latest: find the most recent revision that has data for
                # the requested app.  Revisions are returned latest-first
                # (descending id via default windowing).
                for rev in env_revisions:
                    if (
                        ref_key
                        and rev.data
                        and rev.data.references
                        and ref_key in rev.data.references
                    ):
                        target_rev = rev
                        version = rev.version
                        break
                # If no revision has the app key, fall back to the first
                # revision overall (mirrors the old behaviour).
                if target_rev is None and env_revisions:
                    target_rev = env_revisions[0]
                    version = target_rev.version if target_rev else None
            else:
                # Specific version
                version_str = str(environment_ref.version)
                for rev in env_revisions:
                    if str(rev.version) == version_str:
                        target_rev = rev
                        version = rev.version
                        break

            if not target_rev:
                return env_shim, None

            # Extract deployed_app_variant_revision_id from revision data
            deployed_variant_revision_id = _extract_deployed_revision_id(
                target_rev.data.references if target_rev.data else None,
                app_slug,
            )

            rev_shim = _EnvironmentRevisionShim(
                id=target_rev.id,
                revision=version,
                deployed_app_variant_revision_id=deployed_variant_revision_id,
                environment_id=env.id,
                commit_message=target_rev.message,
                created_at=target_rev.created_at,
                project_id=project_id,
            )
            return env_shim, rev_shim

    return None, None


async def _create_variant(
    project_id: str,
    user_id: str,
    slug: str,
    params: Dict[str, Any],
    app_id: UUID,
    commit_message: Optional[str] = None,
) -> Tuple[Optional[str], Optional[int]]:
    """Create a new variant using the new ApplicationsService via adapter."""
    adapter = get_legacy_adapter()

    result = await adapter.create_variant_with_revision(
        project_id=UUID(project_id),
        user_id=UUID(user_id),
        app_id=app_id,
        variant_slug=slug,
        parameters=params,
        commit_message=commit_message,
    )

    if not result:
        return None, None

    variant, revision = result
    return variant.slug, revision.version


async def _update_variant(
    project_id: str,
    user_id: str,
    variant_id: UUID,
    params: Dict[str, Any],
    commit_message: Optional[str] = None,
) -> Tuple[Optional[str], Optional[int], Optional[datetime]]:
    """Update a variant by committing a new revision with updated parameters."""
    adapter = get_legacy_adapter()

    revision = await adapter.commit_variant_revision(
        project_id=UUID(project_id),
        user_id=UUID(user_id),
        variant_id=variant_id,
        parameters=params,
        commit_message=commit_message,
    )

    if not revision:
        return None, None, None

    # Get variant to return the slug
    variant = await adapter.fetch_variant_by_id(
        project_id=UUID(project_id),
        variant_id=variant_id,
    )

    if not variant:
        return None, None, None

    return variant.slug, revision.version, revision.updated_at


async def _update_environment(
    project_id: UUID,
    user_id: UUID,
    environment_name: str,
    variant_id: UUID,
    variant_revision_id: Optional[UUID] = None,
    commit_message: Optional[str] = None,
):
    """Update environment deployment - uses new git-based environment tables."""
    with suppress():
        env_adapter = get_legacy_environments_adapter()
        await env_adapter.deploy_to_environment(
            project_id=project_id,
            user_id=user_id,
            variant_id=variant_id,
            environment_name=environment_name,
            revision_id=variant_revision_id,
            commit_message=commit_message,
        )


# - CREATE


async def add_config(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: ReferenceDTO,
    user_id: str,
) -> Optional[ConfigDTO]:
    """Create a new config (variant) using the new ApplicationsService."""
    if not variant_ref.slug:
        log.error("Variant slug is required for creating a config")
        return None

    if not project_id or not user_id:
        log.error("Project ID and user ID are required for creating a config")
        return None

    app = await _fetch_app(
        project_id=project_id,
        app_id=application_ref.id,
        app_name=application_ref.slug,
    )

    if not app:
        log.error(f"App not found for application_ref: {application_ref}")
        return None

    # Create variant with compound slug: {app_slug}.{variant_name}
    compound_slug = f"{app.slug}.{variant_ref.slug}"
    variant_slug, variant_version = await _create_variant(
        project_id=project_id,
        user_id=user_id,
        slug=compound_slug,
        params={},
        app_id=app.id,
        commit_message=variant_ref.commit_message,
    )

    if variant_slug is None or variant_version is None:
        log.error("Failed to create variant - variant_slug or variant_version is None")
        return None

    variant_ref = ReferenceDTO(
        slug=variant_slug,
        version=variant_version,
        id=None,
        commit_message=variant_ref.commit_message,
    )

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )
    return config


# - FETCH


async def fetch_configs_by_application_ref(
    project_id: str,
    application_ref: ReferenceDTO,
) -> List[ConfigDTO]:
    """Fetch all configs for an app using the new ApplicationsService."""
    adapter = get_legacy_adapter()
    configs_list = []

    app = await _fetch_app(
        project_id=project_id,
        app_id=application_ref.id,
        app_name=application_ref.slug,
    )

    if not app:
        return configs_list

    variants = await _fetch_variants(
        project_id=project_id,
        application_ref=application_ref,
    )

    if not variants:
        return configs_list

    for variant in variants:
        # Get latest revision for this variant
        latest_revision = await adapter.fetch_latest_revision(
            project_id=UUID(project_id),
            variant_id=variant.id,
        )

        if not latest_revision:
            continue

        # Extract parameters from revision data
        params = {}
        url = None
        if latest_revision.data:
            params = latest_revision.data.parameters or {}
            url = latest_revision.data.url

        config = ConfigDTO(
            params=params,
            url=url,
            #
            application_ref=ReferenceDTO(
                slug=app.slug,
                version=None,
                id=app.id,
            ),
            service_ref=None,
            variant_ref=ReferenceDTO(
                slug=variant.slug,
                version=latest_revision.version,
                id=variant.id,
                commit_message=latest_revision.message,
            ),
            environment_ref=None,
            #
            variant_lifecycle=LegacyLifecycleDTO(
                created_at=(
                    latest_revision.created_at.isoformat()
                    if latest_revision.created_at
                    else None
                ),
                updated_at=(
                    latest_revision.updated_at.isoformat()
                    if latest_revision.updated_at
                    else None
                ),
                updated_by_id=(
                    str(latest_revision.updated_by_id)
                    if latest_revision.updated_by_id
                    else None
                ),
                updated_by=None,  # Not available in new system
            ),
        )

        configs_list.append(config)

    return configs_list


async def fetch_configs_by_variant_ref(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO],
) -> List[ConfigDTO]:
    """Fetch all revisions for a variant as configs using the new ApplicationsService."""
    adapter = get_legacy_adapter()
    configs_list: List[ConfigDTO] = []

    variant_versions = await _fetch_variant_versions(
        project_id=project_id,
        application_ref=application_ref,
        variant_ref=variant_ref,
    )
    if not variant_versions:
        return configs_list

    # Get the variant to access app info
    variant = None
    if variant_ref.id:
        variant = await adapter.fetch_variant_by_id(
            project_id=UUID(project_id),
            variant_id=variant_ref.id,
        )
    elif variant_versions:
        # Get variant from first revision's variant_id
        first_rev = variant_versions[0]
        if first_rev.application_variant_id:
            variant = await adapter.fetch_variant_by_id(
                project_id=UUID(project_id),
                variant_id=first_rev.application_variant_id,
            )

    # Get app info
    app = None
    if variant and variant.application_id:
        app = await adapter.fetch_app_by_id(
            project_id=UUID(project_id),
            app_id=variant.application_id,
        )

    for revision in variant_versions:
        # Extract parameters from revision data
        params = {}
        url = None
        if revision.data:
            params = revision.data.parameters or {}
            url = revision.data.url

        config = ConfigDTO(
            params=params,
            url=url,
            #
            application_ref=ReferenceDTO(
                slug=app.slug if app else None,
                version=None,
                id=app.id if app else None,
            ),
            service_ref=None,
            variant_ref=ReferenceDTO(
                slug=variant.slug if variant else revision.slug,
                version=revision.version,
                id=(
                    variant.id
                    if variant and variant.id
                    else revision.application_variant_id
                ),
                commit_message=revision.message,
            ),
            environment_ref=None,
            #
            variant_lifecycle=LegacyLifecycleDTO(
                created_at=(
                    revision.created_at.isoformat() if revision.created_at else None
                ),
                updated_at=(
                    revision.updated_at.isoformat() if revision.updated_at else None
                ),
                updated_by_id=(
                    str(revision.updated_by_id) if revision.updated_by_id else None
                ),
                updated_by=None,  # Not available in new system
            ),
        )
        configs_list.append(config)

    return configs_list


async def fetch_config_by_variant_ref(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    """Fetch a single config by variant ref using the new ApplicationsService."""
    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    # Extract URL from revision data (no more deployments)
    url = None
    params = {}
    if app_variant_revision.data:
        url = app_variant_revision.data.url
        params = app_variant_revision.data.parameters or {}

    app = await _fetch_app(
        project_id=project_id,
        app_id=app_variant.application_id,
    )

    if not app:
        return None

    _user_id = None
    _user_email = None

    if user_id:
        with suppress():
            user = await get_user_with_id(user_id=user_id)
            _user_id = str(user.id)
            _user_email = user.email

    config = ConfigDTO(
        params=params,
        url=url,
        #
        application_ref=ReferenceDTO(
            slug=app.slug,
            version=None,
            id=app.id,
        ),
        variant_ref=ReferenceDTO(
            slug=app_variant.slug,
            version=app_variant_revision.version,
            id=app_variant.id,
            commit_message=app_variant_revision.message,
        ),
        environment_ref=None,
        #
        variant_lifecycle=LegacyLifecycleDTO(
            created_at=(
                app_variant_revision.created_at.isoformat()
                if app_variant_revision.created_at
                else None
            ),
            updated_at=(
                app_variant.updated_at.isoformat() if app_variant.updated_at else None
            ),
            updated_by_id=_user_id,
            # DEPRECATING
            updated_by=_user_email,
        ),
    )
    return config


async def fetch_config_by_environment_ref(
    project_id: str,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    app_environment, app_environment_revision = await _fetch_environment(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
    )

    if not (app_environment and app_environment_revision):
        return None

    environment_ref = ReferenceDTO(
        slug=app_environment.name,
        version=app_environment_revision.revision,
        id=app_environment_revision.id,
        commit_message=app_environment_revision.commit_message,
    )

    variant_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=app_environment_revision.deployed_app_variant_revision_id,
    )

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )
    if not config:
        return None

    config.environment_ref = environment_ref

    _user_id = None
    _user_email = None

    if user_id:
        with suppress():
            user = await get_user_with_id(user_id=user_id)
            _user_id = str(user.id)
            _user_email = user.email

    config.environment_lifecycle = LegacyLifecycleDTO(
        created_at=app_environment_revision.created_at.isoformat(),
        updated_at=app_environment_revision.created_at.isoformat(),
        updated_by_id=_user_id,
        # DEPRECATING
        updated_by=_user_email,
    )
    return config


# - FORK


async def fork_config_by_variant_ref(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    """Fork a variant to create a new config using the new ApplicationsService."""
    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    if not user_id:
        return None

    # Extract parameters from revision data
    params = {}
    if app_variant_revision.data:
        params = app_variant_revision.data.parameters or {}

    # Build compound slug for the forked variant (always unique)
    unique_suffix = uuid4().hex[-12:]
    if variant_ref.slug:
        # Fetch app to construct compound slug: {app_slug}.{variant_name}_{suffix}
        app = await _fetch_app(
            project_id=project_id,
            app_id=app_variant.application_id,
        )
        if not app:
            log.error(f"App not found for application_id: {app_variant.application_id}")
            return None
        fork_slug = f"{app.slug}.{variant_ref.slug}_{unique_suffix}"
    else:
        # app_variant.slug is already compound; append a unique suffix
        fork_slug = app_variant.slug + "_" + unique_suffix

    variant_slug, variant_version = await _create_variant(
        project_id=project_id,
        user_id=user_id,
        slug=fork_slug,
        params=params,
        app_id=app_variant.application_id,
        commit_message=variant_ref.commit_message,
    )

    if not (variant_slug and variant_version):
        return None

    application_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=app_variant.application_id,
    )

    variant_ref = ReferenceDTO(
        slug=variant_slug,
        version=variant_version,
        commit_message=variant_ref.commit_message,
        id=None,
    )

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )
    return config


async def fork_config_by_environment_ref(
    project_id: str,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    # --> FETCHING: environment
    app_environment, app_environment_revision = await _fetch_environment(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
    )

    if not (app_environment and app_environment_revision):
        return None
    # <-- FETCHING: environment

    environment_ref = ReferenceDTO(
        slug=app_environment.name,
        version=app_environment_revision.revision,
        id=app_environment_revision.id,
        commit_message=app_environment_revision.commit_message,
    )

    variant_ref = ReferenceDTO(
        slug=None,
        version=None,
        commit_message=app_environment_revision.commit_message,
        id=app_environment_revision.deployed_app_variant_revision_id,
    )

    config = await fork_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )

    if not config:
        return None

    config.environment_ref = environment_ref

    return config


# - COMMIT


async def commit_config(
    project_id: str,
    config: ConfigDTO,
    user_id: str,
) -> Optional[ConfigDTO]:
    if not config.variant_ref:
        return None

    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=config.variant_ref,
        application_ref=config.application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    variant_slug, variant_version, variant_updated_at = await _update_variant(
        project_id=project_id,
        user_id=user_id,
        variant_id=app_variant.id,
        params=config.params,
        commit_message=(
            config.variant_ref.commit_message if config.variant_ref else None
        ),
    )

    application_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=app_variant.application_id,
    )
    variant_ref = ReferenceDTO(
        slug=variant_slug,
        version=variant_version,
        commit_message=(
            config.variant_ref.commit_message if config.variant_ref else None
        ),
        id=None,
    )

    config = await fetch_config_by_variant_ref(  # type: ignore
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )

    return config


# - DEPLOY


async def deploy_config(
    project_id: str,
    variant_ref: ReferenceDTO,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    environment_ref.version = None

    app_environment, _ = await _fetch_environment(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
    )

    if not app_environment:
        return None

    if not user_id:
        log.error("User ID is required for deploying a config")
        return None

    await _update_environment(
        project_id=UUID(project_id),
        user_id=UUID(user_id),
        environment_name=app_environment.name,
        variant_id=app_variant.id,
        variant_revision_id=app_variant_revision.id,
        commit_message=environment_ref.commit_message,
    )

    config = await fetch_config_by_environment_ref(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
        user_id=user_id,
    )

    return config


# - LIST


async def list_configs(
    project_id: str,
    application_ref: ReferenceDTO,
    user_id: Optional[str] = None,
) -> Optional[List[ConfigDTO]]:
    configs = await fetch_configs_by_application_ref(
        project_id=project_id,
        application_ref=application_ref,
    )

    return configs


async def history_configs(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> List[ConfigDTO]:
    configs = await fetch_configs_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    return configs


# DELETE


async def delete_config(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> None:
    """Delete (archive) a config using the new ApplicationsService."""
    adapter = get_legacy_adapter()

    variant, _ = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )
    if not variant:
        return None

    if not user_id:
        log.error("User ID is required for deleting a config")
        return None

    await adapter.mark_variant_hidden(
        project_id=UUID(project_id),
        user_id=UUID(user_id),
        variant_id=variant.id,
    )
