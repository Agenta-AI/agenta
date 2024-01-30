from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId, iterative_migration


class APIKeyDB(Document):
    prefix: str
    hashed_key: str
    user_id: str
    rate_limit: int = Field(default=0)
    hidden: Optional[bool] = Field(default=False)
    expiration_date: Optional[datetime]
    created_at: Optional[datetime] = datetime.utcnow()
    updated_at: Optional[datetime]

    class Settings:
        name = "api_keys"


class InvitationDB(BaseModel):
    token: str = Field(unique=True)
    email: str
    expiration_date: datetime = Field(default="0")
    used: bool = False


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    invitations: Optional[List[InvitationDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "organizations"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "users"


class ImageDB(Document):
    """Defines the info needed to get an image and connect it to the app variant"""

    type: Optional[str] = Field(default="image")
    template_uri: Optional[str]
    docker_id: Optional[str] = Field(index=True)
    tags: Optional[str]
    deletable: bool = Field(default=True)
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "docker_images"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_db"


class DeploymentDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    container_name: Optional[str]
    container_id: Optional[str]
    uri: Optional[str]
    status: str
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "deployments"


class VariantBaseDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    base_name: str
    image: Link[ImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "bases"


class ConfigDB(BaseModel):
    config_name: str
    parameters: Dict[str, Any] = Field(default=dict)


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    revision: int
    image: Link[ImageDB]
    user: Link[UserDB]
    modified_by: Link[UserDB]
    organization: Link[OrganizationDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[VariantBaseDB]
    config_name: Optional[str]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class AppVariantRevisionsDB(Document):
    variant: Link[AppVariantDB]
    revision: int
    modified_by: Link[UserDB]
    base: Link[VariantBaseDB]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_variant_revisions"


class AppEnvironmentDB(Document):
    app: Link[AppDB]
    name: str
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    deployed_app_variant: Optional[PydanticObjectId]
    deployed_app_variant_revision: Optional[Link[AppVariantRevisionsDB]]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "environments"


class TemplateDB(Document):
    type: Optional[str] = Field(default="image")
    template_uri: Optional[str]
    tag_id: Optional[int]
    name: str = Field(unique=True)  # tag name of image
    repo_name: Optional[str]
    title: str
    description: str
    size: Optional[int]
    digest: Optional[str]  # sha256 hash of image digest
    last_pushed: Optional[datetime]

    class Settings:
        name = "templates"


class TestSetDB(Document):
    name: str
    app: Link[AppDB]
    csvdata: List[Dict[str, str]]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "testsets"


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    name: str
    evaluator_key: str
    settings_values: Dict[str, Any] = Field(default=dict)
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "evaluators_configs"


class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None


class Result(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None


class EvaluationScenarioResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class AggregatedResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class EvaluationScenarioInputDB(BaseModel):
    name: str
    type: str
    value: str


class EvaluationScenarioOutputDB(BaseModel):
    type: str
    value: Any


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class OldHumanEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "human_evaluations"


class HumanEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    variants_revisions: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "human_evaluations"


class OldEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: Result
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluations"


class EvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str = Field(default="EVALUATION_INITIALIZED")
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    variant_revision: Optional[PydanticObjectId]
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluations"


class Forward:
    @iterative_migration(
        document_models=[
            AppDB,
            OrganizationDB,
            UserDB,
            TestSetDB,
            ImageDB,
            VariantBaseDB,
            AppVariantDB,
            AppVariantRevisionsDB,
            OldHumanEvaluationDB,
            HumanEvaluationDB,
        ]
    )
    async def connecting_human_evaluations(
        self, input_document: OldHumanEvaluationDB, output_document: HumanEvaluationDB
    ):
        variants_revisions: List[PydanticObjectId] = []
        for variant in input_document.variants:
            variant_revision = (
                await AppVariantRevisionsDB.find(
                    AppVariantRevisionsDB.variant.id == variant
                )
                .sort(-AppVariantRevisionsDB.created_at)
                .first_or_none()
            )  # fetch app variant revision by the newest date
            if variant_revision is not None:
                variants_revisions.append(variant_revision.id)

        output_document.variants_revisions = variants_revisions

    @iterative_migration(
        document_models=[
            AppDB,
            OrganizationDB,
            UserDB,
            TestSetDB,
            ImageDB,
            VariantBaseDB,
            AppVariantDB,
            AppVariantRevisionsDB,
            OldEvaluationDB,
            EvaluationDB,
        ]
    )
    async def connecting_auto_evaluations(
        self, input_document: OldEvaluationDB, output_document: EvaluationDB
    ):
        variant_revision = (
            await AppVariantRevisionsDB.find(
                AppVariantRevisionsDB.variant.id
                == PydanticObjectId(input_document.variant)
            )
            .sort(-AppVariantRevisionsDB.created_at)
            .first_or_none()
        )  # fetch app variant revision by the newest date
        if variant_revision is not None:
            output_document.variant_revision = variant_revision.id


class Backward:
    pass
