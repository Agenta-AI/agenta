from beanie import iterative_migration, Document, Link

from uuid import uuid4
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId


class APIKeyDB(Document):
    prefix: str
    hashed_key: str
    user_id: str
    rate_limit: int = Field(default=0)
    hidden: Optional[bool] = Field(default=False)
    expiration_date: Optional[datetime]
    created_at: Optional[datetime] = datetime.now()
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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "organizations"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "docker_images"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "deployments"


class VariantBaseDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    base_name: str
    image: Link[ImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "bases"


class ConfigVersionDB(BaseModel):
    version: int
    parameters: Dict[str, Any]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())


class ConfigDB(Document):
    config_name: str
    current_version: int = Field(default=1)
    parameters: Dict[str, Any] = Field(default=dict)
    version_history: List[ConfigVersionDB] = Field(default=[])
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "configs"


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    image: Link[ImageDB]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[VariantBaseDB]
    config_name: Optional[str]
    config: Link[ConfigDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class AppEnvironmentDB(Document):
    app: Link[AppDB]
    name: str
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    deployed_app_variant: Optional[PydanticObjectId]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.now())

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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "testsets"


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "evaluators_configs"


class Result(BaseModel):
    type: str
    value: Any


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


class HumanEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "human_evaluations"


class HumanEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[HumanEvaluationDB]
    inputs: List[HumanEvaluationScenarioInput]
    outputs: List[HumanEvaluationScenarioOutput]
    vote: Optional[str]
    score: Optional[Any]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())
    is_pinned: Optional[bool]
    note: Optional[str]

    class Settings:
        name = "human_evaluations_scenarios"


class EvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str = Field(default="EVALUATION_INITIALIZED")
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "evaluations"


class EvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[EvaluationDB]
    variant_id: PydanticObjectId
    inputs: List[EvaluationScenarioInputDB]
    outputs: List[EvaluationScenarioOutputDB]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]
    evaluators_configs: List[PydanticObjectId]
    results: List[EvaluationScenarioResult]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "evaluation_scenarios"


class Forward:
    @iterative_migration(document_models=[OrganizationDB, UserDB, ImageDB])
    async def rename_image_db_reference_to_link(
        self, input_document: ImageDB, output_document: ImageDB
    ):
        output_document.user = input_document.user

    @iterative_migration(document_models=[OrganizationDB, UserDB, AppDB])
    async def rename_app_db_reference_to_link(
        self, input_document: AppDB, output_document: AppDB
    ):
        output_document.user = input_document.user
        output_document.organization = input_document.organization

    @iterative_migration(document_models=[OrganizationDB, UserDB, AppDB, DeploymentDB])
    async def rename_deployment_db_reference_to_link(
        self, input_document: DeploymentDB, output_document: DeploymentDB
    ):
        output_document.app = input_document.app
        output_document.user = input_document.user
        output_document.organization = input_document.organization

    @iterative_migration(
        document_models=[OrganizationDB, UserDB, AppDB, ImageDB, VariantBaseDB]
    )
    async def rename_variant_base_db_reference_to_link(
        self, input_document: VariantBaseDB, output_document: VariantBaseDB
    ):
        output_document.app = input_document.app
        output_document.user = input_document.user
        output_document.organization = input_document.organization
        output_document.image = input_document.image

    @iterative_migration(
        document_models=[OrganizationDB, UserDB, AppDB, AppEnvironmentDB]
    )
    async def rename_app_environment_db_reference_to_link(
        self, input_document: AppEnvironmentDB, output_document: AppEnvironmentDB
    ):
        output_document.app = input_document.app
        output_document.user = input_document.user
        output_document.organization = input_document.organization

    @iterative_migration(document_models=[OrganizationDB, UserDB, AppDB, TestSetDB])
    async def rename_testset_db_reference_to_link(
        self, input_document: TestSetDB, output_document: TestSetDB
    ):
        output_document.app = input_document.app
        output_document.user = input_document.user
        output_document.organization = input_document.organization

    @iterative_migration(
        document_models=[OrganizationDB, UserDB, AppDB, EvaluatorConfigDB]
    )
    async def rename_evaluator_config_db_reference_to_link(
        self, input_document: EvaluatorConfigDB, output_document: EvaluatorConfigDB
    ):
        output_document.app = input_document.app
        output_document.user = input_document.user
        output_document.organization = input_document.organization


class Backward:
    pass
