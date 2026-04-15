from datetime import datetime
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Body, HTTPException, Request, status

from oss.src.apis.fastapi.legacy_variants.models import (
    ConfigResponseModel,
    LegacyLifecycleDTO,
    ReferenceRequestModel,
)
from oss.src.core.applications.dtos import ApplicationRevision
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.environments.dtos import EnvironmentRevision
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.shared.dtos import Reference
from oss.src.utils.common import is_ee
from oss.src.utils.exceptions import intercept_exceptions

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import FORBIDDEN_EXCEPTION, check_action_access


def _as_reference(ref: Optional[ReferenceRequestModel]) -> Optional[Reference]:
    if ref is None:
        return None

    return Reference(
        id=ref.id,
        slug=ref.slug,
        version=str(ref.version) if ref.version is not None else None,
    )


def _version_reference(
    ref: Optional[ReferenceRequestModel],
) -> Optional[Reference]:
    if ref is None or ref.version is None:
        return None

    return Reference(version=str(ref.version))


def _timestamp(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _lifecycle_from_revision(revision) -> LegacyLifecycleDTO:
    return LegacyLifecycleDTO(
        created_at=_timestamp(getattr(revision, "created_at", None)),
        updated_at=_timestamp(getattr(revision, "updated_at", None)),
        updated_by_id=(
            str(getattr(revision, "updated_by_id", None))
            if getattr(revision, "updated_by_id", None)
            else None
        ),
        updated_by=getattr(revision, "updated_by", None),
    )


class LegacyVariantsRouter:
    def __init__(
        self,
        *,
        applications_service: ApplicationsService,
        environments_service: EnvironmentsService,
    ):
        self.applications_service = applications_service
        self.environments_service = environments_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/configs/fetch",
            self.configs_fetch,
            methods=["POST"],
            operation_id="configs_fetch",
            status_code=status.HTTP_200_OK,
            response_model=ConfigResponseModel,
        )

    async def _check_view_access(self, request: Request) -> None:
        if is_ee():
            if not await check_action_access(  # type: ignore[name-defined]
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore[name-defined]
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore[name-defined]

    async def _application_slug(
        self,
        *,
        project_id: UUID,
        application_ref: Optional[ReferenceRequestModel],
    ) -> Optional[str]:
        if not application_ref:
            return None
        if application_ref.slug:
            return application_ref.slug
        if not application_ref.id:
            return None

        application = await self.applications_service.fetch_application(
            project_id=project_id,
            application_ref=Reference(id=application_ref.id),
        )
        return application.slug if application else None

    async def _fetch_variant_revision(
        self,
        *,
        project_id: UUID,
        variant_ref: ReferenceRequestModel,
        application_ref: Optional[ReferenceRequestModel],
    ) -> Optional[ApplicationRevision]:
        current_application_ref = _as_reference(application_ref)

        if variant_ref.id:
            revision, _ = await self.applications_service.retrieve_application_revision(
                project_id=project_id,
                application_revision_ref=Reference(id=variant_ref.id),
                resolve=True,
            )
            if revision:
                return revision

            revision, _ = await self.applications_service.retrieve_application_revision(
                project_id=project_id,
                application_ref=current_application_ref,
                application_variant_ref=Reference(id=variant_ref.id),
                application_revision_ref=_version_reference(variant_ref),
                resolve=True,
            )
            return revision

        revision, _ = await self.applications_service.retrieve_application_revision(
            project_id=project_id,
            application_ref=current_application_ref,
            application_variant_ref=Reference(slug=variant_ref.slug),
            application_revision_ref=_version_reference(variant_ref),
            resolve=True,
        )
        return revision

    async def _fetch_environment_revision(
        self,
        *,
        project_id: UUID,
        environment_ref: ReferenceRequestModel,
        application_ref: Optional[ReferenceRequestModel],
    ) -> tuple[Optional[ApplicationRevision], Optional[EnvironmentRevision]]:
        app_slug = await self._application_slug(
            project_id=project_id,
            application_ref=application_ref,
        )
        if not app_slug:
            return None, None

        key = f"{app_slug}.revision"

        if environment_ref.version is not None:
            environment = await self.environments_service.fetch_environment(
                project_id=project_id,
                environment_ref=Reference(
                    id=environment_ref.id,
                    slug=environment_ref.slug,
                ),
            )
            if environment:
                environment_variant = (
                    await self.environments_service.fetch_environment_variant(
                        project_id=project_id,
                        environment_ref=Reference(id=environment.id),
                    )
                )
                if environment_variant:
                    environment_variant_ref = Reference(id=environment_variant.id)
                    environment_revision_ref = Reference(
                        version=str(environment_ref.version)
                    )
                    revision, _ = (
                        await self.applications_service.retrieve_application_revision(
                            project_id=project_id,
                            environment_variant_ref=environment_variant_ref,
                            environment_revision_ref=environment_revision_ref,
                            key=key,
                            resolve=True,
                        )
                    )
                    environment_revision, _ = (
                        await self.environments_service.retrieve_environment_revision(
                            project_id=project_id,
                            environment_variant_ref=environment_variant_ref,
                            environment_revision_ref=environment_revision_ref,
                        )
                    )
                    return revision, environment_revision

        current_environment_ref = _as_reference(environment_ref)

        revision, _ = await self.applications_service.retrieve_application_revision(
            project_id=project_id,
            environment_ref=current_environment_ref,
            key=key,
            resolve=True,
        )
        environment_revision, _ = (
            await self.environments_service.retrieve_environment_revision(
                project_id=project_id,
                environment_ref=current_environment_ref,
            )
        )

        if revision or not environment_ref.id:
            return revision, environment_revision

        environment_revision_ref = Reference(id=environment_ref.id)
        revision, _ = await self.applications_service.retrieve_application_revision(
            project_id=project_id,
            environment_revision_ref=environment_revision_ref,
            key=key,
            resolve=True,
        )
        environment_revision, _ = (
            await self.environments_service.retrieve_environment_revision(
                project_id=project_id,
                environment_revision_ref=environment_revision_ref,
            )
        )

        return revision, environment_revision

    async def _config_from_revision(
        self,
        *,
        project_id: UUID,
        revision: ApplicationRevision,
        environment_ref: Optional[ReferenceRequestModel] = None,
        environment_revision: Optional[EnvironmentRevision] = None,
    ) -> ConfigResponseModel:
        data = revision.data
        params = getattr(data, "parameters", None) or {}
        url = getattr(data, "url", None)

        application_id = revision.application_id or revision.artifact_id
        variant_id = revision.application_variant_id or revision.variant_id

        application = None
        if application_id:
            application = await self.applications_service.fetch_application(
                project_id=project_id,
                application_ref=Reference(id=application_id),
            )

        variant = None
        if variant_id:
            variant = await self.applications_service.fetch_application_variant(
                project_id=project_id,
                application_variant_ref=Reference(id=variant_id),
            )

        legacy_environment_ref = None
        environment_lifecycle = None
        if environment_ref or environment_revision:
            legacy_environment_ref = ReferenceRequestModel(
                slug=environment_ref.slug if environment_ref else None,
                version=(
                    environment_revision.version
                    if environment_revision
                    else environment_ref.version
                    if environment_ref
                    else None
                ),
                id=environment_revision.id if environment_revision else None,
                commit_message=(
                    environment_revision.message if environment_revision else None
                ),
            )
            if environment_revision:
                environment_lifecycle = _lifecycle_from_revision(environment_revision)

        return ConfigResponseModel(
            params=params,
            url=url,
            application_ref=ReferenceRequestModel(
                slug=application.slug if application else None,
                id=application_id,
            ),
            service_ref=None,
            variant_ref=ReferenceRequestModel(
                slug=variant.slug if variant else revision.slug,
                version=revision.version,
                id=variant_id,
                commit_message=revision.message,
            ),
            environment_ref=legacy_environment_ref,
            application_lifecycle=(
                _lifecycle_from_revision(application) if application else None
            ),
            service_lifecycle=None,
            variant_lifecycle=_lifecycle_from_revision(revision),
            environment_lifecycle=environment_lifecycle,
        )

    @intercept_exceptions()
    async def configs_fetch(
        self,
        request: Request,
        variant_ref: Annotated[Optional[ReferenceRequestModel], Body()] = None,
        environment_ref: Annotated[Optional[ReferenceRequestModel], Body()] = None,
        application_ref: Annotated[Optional[ReferenceRequestModel], Body()] = None,
    ) -> ConfigResponseModel:
        await self._check_view_access(request)

        project_id = UUID(request.state.project_id)
        revision = None
        environment_revision = None

        if variant_ref:
            revision = await self._fetch_variant_revision(
                project_id=project_id,
                variant_ref=variant_ref,
                application_ref=application_ref,
            )
        else:
            environment_ref = environment_ref or ReferenceRequestModel(
                slug="production"
            )
            revision, environment_revision = await self._fetch_environment_revision(
                project_id=project_id,
                environment_ref=environment_ref,
                application_ref=application_ref,
            )

        if not revision:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Config not found.",
            )

        return await self._config_from_revision(
            project_id=project_id,
            revision=revision,
            environment_ref=environment_ref if not variant_ref else None,
            environment_revision=environment_revision,
        )
