from enum import Enum
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId

from beanie import free_fall_migration


# Base Models
class ConfigDB(BaseModel):
    config_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)


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
    result: Result


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class WorkspaceRole(str, Enum):
    OWNER = "owner"
    VIEWER = "viewer"
    EDITOR = "editor"
    EVALUATOR = "evaluator"
    WORKSPACE_ADMIN = "workspace_admin"
    DEPLOYMENT_MANAGER = "deployment_manager"

    @classmethod
    def get_description(cls, role):
        descriptions = {
            cls.OWNER: "Can fully manage the workspace, including adding and removing members.",
            cls.VIEWER: "Can view the workspace content but cannot make changes.",
            cls.EDITOR: "Can edit workspace content, but cannot manage members or roles.",
            cls.EVALUATOR: "Can evaluate models and provide feedback within the workspace.",
            cls.WORKSPACE_ADMIN: "Can manage workspace settings and members but cannot delete the workspace.",
            cls.DEPLOYMENT_MANAGER: "Can manage model deployments within the workspace.",
        }
        return descriptions.get(role, "Description not available, Role not found")


# Document Models
class InvitationDB(BaseModel):
    token: str = Field(unique=True)
    email: str
    organization_id: str
    workspace_id: str
    workspace_roles: Optional[List[WorkspaceRole]]
    expiration_date: datetime = Field(default="0")
    used: bool = False
    created_at: Optional[datetime] = datetime.utcnow()


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: Optional[str] = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    invitations: Optional[List[InvitationDB]] = []
    workspaces: Optional[List[PydanticObjectId]] = []
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
    organization: Optional[Link[OrganizationDB]]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "docker_images"


class AppDB(Document):
    app_name: str
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_db"


class DeploymentDB(Document):
    app: Link[AppDB]
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
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
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    base_name: str
    image: Link[ImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "bases"


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    revision: int
    image: Link[ImageDB]
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    modified_by: Link[UserDB]
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
    organization: Optional[Link[OrganizationDB]]
    deployed_app_variant: Optional[PydanticObjectId]
    deployed_app_variant_revision: Optional[Link[AppVariantRevisionsDB]]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "environments"


class TestSetDB(Document):
    name: str
    app: Link[AppDB]
    csvdata: List[Dict[str, str]]
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "testsets"


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    name: str
    evaluator_key: str
    settings_values: Dict[str, Any] = Field(default=dict)
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "evaluators_configs"


class HumanEvaluationDB(Document):
    app: Link[AppDB]
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    variants_revisions: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "human_evaluations"


class HumanEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    evaluation: Link[HumanEvaluationDB]
    inputs: List[HumanEvaluationScenarioInput]
    outputs: List[HumanEvaluationScenarioOutput]
    vote: Optional[str]
    score: Optional[Any]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    is_pinned: Optional[bool]
    note: Optional[str]

    class Settings:
        name = "human_evaluations_scenarios"


class EvaluationDB(Document):
    app: Link[AppDB]
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    status: Result
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    variant_revision: Optional[PydanticObjectId] = None
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluations"


class EvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Optional[Link[OrganizationDB]]
    evaluation: Link[EvaluationDB]
    variant_id: PydanticObjectId
    inputs: List[EvaluationScenarioInputDB]
    outputs: List[EvaluationScenarioOutputDB]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]
    evaluators_configs: List[PydanticObjectId]
    results: List[EvaluationScenarioResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluation_scenarios"


class Forward:

    @free_fall_migration(document_models=[UserDB])
    async def add_workspaces_field_to_user_db(self, session):
        async for user in UserDB.find_all():
            user.workspaces = []
            await user.save()

    @free_fall_migration(document_models=[ImageDB])
    async def add_workspace_field_to_image_db(self, session):
        async for image in ImageDB.find_all():
            image.workspace = None
            await image.save()

    @free_fall_migration(document_models=[AppDB])
    async def add_workspace_field_to_app_db(self, session):
        async for app in AppDB.find_all():
            app.workspace = None
            await app.save()

    @free_fall_migration(document_models=[DeploymentDB])
    async def add_workspace_field_to_deployment_db(self, session):
        async for deployment in DeploymentDB.find_all():
            deployment.workspace = None
            await deployment.save()

    @free_fall_migration(document_models=[VariantBaseDB])
    async def add_workspace_field_to_variant_base_db(self, session):
        async for base in VariantBaseDB.find_all():
            base.workspace = None
            await base.save()

    @free_fall_migration(document_models=[AppVariantDB])
    async def add_workspace_field_to_app_variant_db(self, session):
        async for variant in AppVariantDB.find_all():
            variant.workspace = None
            await variant.save()

    @free_fall_migration(document_models=[AppEnvironmentDB])
    async def add_workspace_field_to_app_environment_db(self, session):
        async for environment in AppEnvironmentDB.find_all():
            environment.workspace = None
            await environment.save()

    @free_fall_migration(document_models=[TestSetDB])
    async def add_workspace_field_to_testset_db(self, session):
        async for testset in TestSetDB.find_all():
            testset.workspace = None
            await testset.save()

    @free_fall_migration(document_models=[EvaluatorConfigDB])
    async def add_workspace_field_to_evaluator_config_db(self, session):
        async for evaluator_config in EvaluatorConfigDB.find_all():
            evaluator_config.workspace = None
            await evaluator_config.save()

    @free_fall_migration(document_models=[HumanEvaluationDB])
    async def add_workspace_field_to_human_evaluation_db(self, session):
        async for human_evaluation in HumanEvaluationDB.find_all():
            human_evaluation.workspace = None
            await human_evaluation.save()

    @free_fall_migration(document_models=[HumanEvaluationScenarioDB])
    async def add_workspace_field_to_human_evaluation_scenario_db(self, session):
        async for human_evaluation_scenario in HumanEvaluationScenarioDB.find_all():
            human_evaluation_scenario.workspace = None
            await human_evaluation_scenario.save()

    @free_fall_migration(document_models=[EvaluationDB])
    async def add_workspace_field_to_evaluation_db(self, session):
        async for evaluation in EvaluationDB.find_all():
            evaluation.workspace = None
            await evaluation.save()

    @free_fall_migration(document_models=[EvaluationScenarioDB])
    async def add_workspace_field_to_evaluation_scenario_db(self, session):
        async for evaluation_scenario in EvaluationScenarioDB.find_all():
            evaluation_scenario.workspace = None
            await evaluation_scenario.save()


class Backward:
    pass
