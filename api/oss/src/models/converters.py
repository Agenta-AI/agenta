"""Converts db models to pydantic models"""

import uuid
from typing import List, Tuple, Any

from fastapi import Depends

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import is_ee
from oss.src.models.api.user_models import User
from oss.src.models.shared_models import ConfigDB, AppType
from oss.src.models.api.evaluation_model import (
    EvaluatorConfig,
)

if is_ee():
    from ee.src.models.api.api_models import (
        AppVariant_ as AppVariant,
        AppVariantResponse_ as AppVariantResponse,
        EnvironmentRevision_ as EnvironmentRevision,
        EnvironmentOutput_ as EnvironmentOutput,
        EnvironmentOutputExtended_ as EnvironmentOutputExtended,
    )
else:
    from oss.src.models.api.api_models import (
        AppVariant,
        AppVariantResponse,
        EnvironmentRevision,
        EnvironmentOutput,
        EnvironmentOutputExtended,
    )

from oss.src.models.db_models import (
    AppDB,
    UserDB,
    TestsetDB,
    AppVariantDB,
    VariantBaseDB,
    AppEnvironmentDB,
    EvaluatorConfigDB,
    AppVariantRevisionsDB,
    AppEnvironmentRevisionDB,
)
from oss.src.models.api.api_models import (
    App,
    BaseOutput,
    TestsetOutput,
    AppVariantRevision,
    PaginationParam,
    WithPagination,
)


log = get_module_logger(__name__)


def app_variant_db_to_pydantic(  # TODO: remove me. nobody's using me.
    app_variant_db: AppVariantDB, previous_variant_name: str = None
) -> AppVariant:
    app_variant = AppVariant(
        app_id=str(app_variant_db.app.id),
        app_name=app_variant_db.app.app_name,
        project_id=str(app_variant_db.project_id),
        variant_name=app_variant_db.variant_name,
        previous_variant_name=app_variant_db.previous_variant_name,
        base_name=app_variant_db.base_name,
        config_name=app_variant_db.config_name,
    )
    return app_variant


async def app_variant_db_to_output(app_variant_db: AppVariantDB) -> AppVariantResponse:
    if isinstance(app_variant_db.base_id, uuid.UUID) and isinstance(
        app_variant_db.base.deployment_id, uuid.UUID
    ):
        uri = app_variant_db.base.deployment.uri
    else:
        uri = None

    # Fall back to created_* fields if no update has occurred
    modified_by_id = app_variant_db.modified_by_id or app_variant_db.user_id
    updated_at = app_variant_db.updated_at or app_variant_db.created_at

    variant_response = AppVariantResponse(
        app_id=str(app_variant_db.app_id),
        app_name=str(app_variant_db.app.app_name),
        project_id=str(app_variant_db.project_id),
        variant_name=app_variant_db.variant_name,  # type: ignore
        variant_id=str(app_variant_db.id),
        base_name=app_variant_db.base_name,  # type: ignore
        base_id=str(app_variant_db.base_id),
        config_name=app_variant_db.config_name,  # type: ignore
        uri=uri,  # type: ignore
        revision=app_variant_db.revision,  # type: ignore
        created_at=str(app_variant_db.created_at)
        if app_variant_db.created_at
        else None,
        updated_at=str(updated_at) if updated_at else None,
        modified_by_id=str(modified_by_id) if modified_by_id else None,
    )
    return variant_response


async def app_variant_db_revisions_to_output(
    app_variant_revisions_db: List[AppVariantRevisionsDB],
) -> AppVariantRevision:
    app_variant_revisions = []
    for app_variant_revision_db in app_variant_revisions_db:
        app_variant_revisions.append(
            AppVariantRevision(
                id=str(app_variant_revision_db.id) or None,
                variant_id=str(app_variant_revision_db.variant_id)
                if app_variant_revision_db.variant_id
                else None,
                revision=app_variant_revision_db.revision,
                modified_by=app_variant_revision_db.modified_by.username,
                config={
                    "config_name": app_variant_revision_db.config_name,  # type: ignore
                    "parameters": app_variant_revision_db.config_parameters,  # type: ignore
                },
                commit_message=app_variant_revision_db.commit_message,
                created_at=str(app_variant_revision_db.created_at),
            )
        )
    return app_variant_revisions


async def app_variant_db_revision_to_output(
    app_variant_revision_db: AppVariantRevisionsDB,
) -> AppVariantRevision:
    return AppVariantRevision(
        id=str(app_variant_revision_db.id) or None,
        variant_id=str(app_variant_revision_db.variant_id)
        if app_variant_revision_db.variant_id
        else None,
        revision=app_variant_revision_db.revision,
        modified_by=app_variant_revision_db.modified_by.username,
        config=ConfigDB(
            **{
                "config_name": app_variant_revision_db.config_name,
                "parameters": app_variant_revision_db.config_parameters,
            }
        ),
        created_at=str(app_variant_revision_db.created_at),
    )


async def environment_db_to_output(
    environment_db: AppEnvironmentDB,
) -> EnvironmentOutput:
    deployed_app_variant_id = (
        str(environment_db.deployed_app_variant_id)
        if environment_db.deployed_app_variant_id
        and isinstance(environment_db.deployed_app_variant_id, uuid.UUID)  # type: ignore
        else None
    )
    if deployed_app_variant_id:
        deployed_app_variant = await db_manager.get_app_variant_instance_by_id(
            deployed_app_variant_id, str(environment_db.project_id)
        )
        deployed_variant_name = deployed_app_variant.variant_name
    else:
        deployed_variant_name = None

    environment_output = EnvironmentOutput(
        name=environment_db.name,
        app_id=str(environment_db.app_id),
        project_id=str(environment_db.project_id),
        deployed_app_variant_id=deployed_app_variant_id,
        deployed_variant_name=deployed_variant_name,
        deployed_app_variant_revision_id=str(
            environment_db.deployed_app_variant_revision_id
        ),
        revision=environment_db.revision,
    )
    return environment_output


async def environment_db_and_revision_to_extended_output(
    environment_db: AppEnvironmentDB,
    app_environment_revisions_db: List[AppEnvironmentRevisionDB],
) -> EnvironmentOutput:
    deployed_app_variant_id = (
        str(environment_db.deployed_app_variant_id)
        if isinstance(environment_db.deployed_app_variant_id, uuid.UUID)
        else None
    )
    if deployed_app_variant_id:
        deployed_app_variant = await db_manager.get_app_variant_instance_by_id(
            deployed_app_variant_id, str(environment_db.project_id)
        )
        deployed_variant_name = deployed_app_variant.variant_name
    else:
        deployed_variant_name = None

    app_environment_revisions = []
    for app_environment_revision in app_environment_revisions_db:
        app_environment_revisions.append(
            EnvironmentRevision(
                id=str(app_environment_revision.id),
                revision=app_environment_revision.revision,
                modified_by=app_environment_revision.modified_by.username,
                deployed_app_variant_revision=str(
                    app_environment_revision.deployed_app_variant_revision_id
                ),
                deployment=str(app_environment_revision.deployment_id),
                commit_message=app_environment_revision.commit_message,
                created_at=str(app_environment_revision.created_at),
                deployed_variant_name=deployed_variant_name,
            )
        )
    environment_output_extended = EnvironmentOutputExtended(
        name=environment_db.name,
        app_id=str(environment_db.app_id),
        project_id=str(environment_db.project_id),
        deployed_app_variant_id=deployed_app_variant_id,
        deployed_variant_name=deployed_variant_name,
        deployed_app_variant_revision_id=str(
            environment_db.deployed_app_variant_revision_id
        ),
        revision=environment_db.revision,
        revisions=app_environment_revisions,
    )
    return environment_output_extended


def base_db_to_pydantic(base_db: VariantBaseDB) -> BaseOutput:
    return BaseOutput(base_id=str(base_db.id), base_name=base_db.base_name)


def app_db_to_pydantic(app_db: AppDB) -> App:
    # Fall back to created_at if no update has occurred
    updated_at = app_db.updated_at or app_db.created_at

    return App(
        app_name=app_db.app_name,
        app_id=str(app_db.id),
        app_type=AppType.friendly_tag(app_db.app_type),
        folder_id=str(app_db.folder_id) if app_db.folder_id else None,
        updated_at=str(updated_at) if updated_at else None,
    )


def _extract_columns_from_csvdata(csvdata: Any) -> List[str]:
    if not isinstance(csvdata, list) or len(csvdata) == 0:
        return []

    first_row = csvdata[0]
    if not isinstance(first_row, dict):
        return []

    data_section = first_row.get("data")
    if isinstance(data_section, dict):
        return [str(key) for key in data_section.keys()]

    return [str(key) for key in first_row.keys()]


def testset_db_to_pydantic(testset_db: TestsetDB) -> TestsetOutput:
    """
    Convert a TestsetDB object to a TestsetAPI object.

    Args:
        testset_db (Dict): The TestsetDB object to be converted.

    Returns:
        TestsetAPI: The converted TestsetAPI object.
    """
    # Fall back to created_at if no update has occurred
    updated_at = testset_db.updated_at or testset_db.created_at

    return TestsetOutput(
        name=testset_db.name,
        csvdata=testset_db.csvdata,
        created_at=str(testset_db.created_at) if testset_db.created_at else None,
        updated_at=str(updated_at) if updated_at else None,
        id=str(testset_db.id),
        columns=_extract_columns_from_csvdata(testset_db.csvdata),
    )


def user_db_to_pydantic(user_db: UserDB) -> User:
    return User(
        id=str(user_db.id),
        uid=user_db.uid,
        username=user_db.username,
        email=user_db.email,
    ).model_dump(exclude_unset=True)


def evaluator_config_db_to_pydantic(evaluator_config: EvaluatorConfigDB):
    # Fall back to created_at if no update has occurred
    updated_at = evaluator_config.updated_at or evaluator_config.created_at

    return EvaluatorConfig(
        id=str(evaluator_config.id),
        project_id=str(evaluator_config.project_id),
        name=evaluator_config.name,
        evaluator_key=evaluator_config.evaluator_key,
        settings_values=evaluator_config.settings_values,
        created_at=str(evaluator_config.created_at)
        if evaluator_config.created_at
        else None,
        updated_at=str(updated_at) if updated_at else None,
    )


def get_paginated_data(
    data: List[Any], data_count: int, query: PaginationParam = Depends()
):
    return WithPagination(
        data=data, total=data_count, page=query.page, pageSize=query.pageSize
    )


def get_pagination_skip_limit(pagination: PaginationParam) -> Tuple[int, int]:
    skip = (pagination.page - 1) * pagination.pageSize
    limit = pagination.pageSize
    return skip, limit
