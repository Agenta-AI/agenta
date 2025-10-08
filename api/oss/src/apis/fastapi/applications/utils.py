from uuid import UUID
from typing import Optional

from oss.src.core.shared.dtos import (
    Reference,
)

from oss.src.apis.fastapi.applications.models import (
    ApplicationRevisionRetrieveRequest,
)


def parse_application_revision_retrieve_request_from_params(
    application_id: Optional[UUID] = None,
    application_slug: Optional[str] = None,
    #
    application_variant_id: Optional[UUID] = None,
    application_variant_slug: Optional[str] = None,
    #
    application_revision_id: Optional[UUID] = None,
    application_revision_slug: Optional[str] = None,
    application_revision_version: Optional[str] = None,
):
    return parse_application_revision_retrieve_request_from_body(
        application_id=application_id,
        application_slug=application_slug,
        #
        application_variant_id=application_variant_id,
        application_variant_slug=application_variant_slug,
        #
        application_revision_id=application_revision_id,
        application_revision_slug=application_revision_slug,
        application_revision_version=application_revision_version,
    )


def parse_application_revision_retrieve_request_from_body(
    application_id: Optional[UUID] = None,
    application_slug: Optional[str] = None,
    #
    application_variant_id: Optional[UUID] = None,
    application_variant_slug: Optional[str] = None,
    #
    application_revision_id: Optional[UUID] = None,
    application_revision_slug: Optional[str] = None,
    application_revision_version: Optional[str] = None,
) -> Optional[ApplicationRevisionRetrieveRequest]:
    return (
        ApplicationRevisionRetrieveRequest(
            application_ref=(
                Reference(
                    id=application_id,
                    slug=application_slug,
                )
                if application_id or application_slug
                else None
            ),
            #
            application_variant_ref=(
                Reference(
                    id=application_variant_id,
                    slug=application_variant_slug,
                )
                if application_variant_id or application_variant_slug
                else None
            ),
            #
            application_revision_ref=(
                Reference(
                    id=application_revision_id,
                    slug=application_revision_slug,
                    version=application_revision_version,
                )
                if application_revision_id
                or application_revision_slug
                or application_revision_version
                else None
            ),
        )
        if (
            application_id
            or application_slug
            or application_variant_id
            or application_variant_slug
            or application_revision_id
            or application_revision_slug
            or application_revision_version
        )
        else None
    )
