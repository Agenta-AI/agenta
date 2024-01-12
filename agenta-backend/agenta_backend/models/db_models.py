from enum import Enum
from uuid import uuid4
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId


class WorkspaceRole(str, Enum):
    OWNER = "owner"
    MEMBER = "member"
    WORKSPACE_ADMIN = "workspace_admin"


class Permission(str, Enum):
    # general
    MODIFY_CONFIGURATIONS = "modify_configurations"
    CHANGE_USER_ROLES = "change_user_roles"
    READ_SYSTEM = "read_system"
    
    VIEW_APPLICATION = "view_application"
    CREATE_APPLICATION = "create_application"
    EDIT_APPLICATION = "edit_application"
    DELETE_APPLICATION = "delete_application"
    
    # Testset
    VIEW_TESTSET = "view_testset"
    CREATE_TESTSET = "create_testset"
    EDIT_TESTSET = "edit_testset"
    DELETE_TESTSET = "delete_testset"
    
    # Evaluation
    VIEW_EVALUATION = "view_evaluation"
    CREATE_EVALUATION = "create_evaluation"
    RUN_EVALUATIONS = "run_evaluations"
    EDIT_EVALUATION = "edit_evaluation"
    DELETE_EVALUATION = "delete_evaluation"
    
    # Deployment
    DEPLOY_APPLICATION = "deploy_application"
    
    # Workspace
    VIEW_WORKSPACE = "view_workspace"
    CREATE_WORKSPACE = "create_workspace"
    EDIT_WORKSPACE = "edit_workspace"
    DELETE_WORKSPACE = "delete_workspace"
    MODIFY_USER_ROLES = "modify_user_roles"
    ADD_NEW_USER_TO_WORKSPACE = "add_new_user_to_workspace"
    
    # Organization
    ADD_NEW_USER_TO_ORGANIZATION = "add_new_user_to_organization"
    EDIT_ORGANIZATION = "edit_organizayion"
    
    

class WorkspacePermissionDB(BaseModel):
    role_name: WorkspaceRole
    permissions: List[Permission]


class WorkspaceMemberDB(BaseModel):
    user_id: PydanticObjectId
    roles: List[WorkspacePermissionDB]


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


class WorkspaceDB(Document):
    name: str
    type: Optional[str]
    description: Optional[str] = Field(default="")
    organization: Link[OrganizationDB]
    members: Optional[List[WorkspaceMemberDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    def get_member_roles(self, user_id: PydanticObjectId) -> Optional[List[WorkspacePermissionDB]]:
        for member in self.members:
            if member.user_id == user_id:
                return member.roles
        return None

    def get_member_role_names(self, user_id: PydanticObjectId) -> List[str]:
        roles = self.get_member_roles(user_id)
        return [role.role_name for role in roles] if roles else []
    
    def get_all_members(self) -> List[PydanticObjectId]:
        return [member.user_id for member in self.members]

    def has_permission(self, user_id: PydanticObjectId, permission: Permission) -> bool:
        roles = self.get_member_roles(user_id)
        if roles:
            for role in roles:
                if permission in role.permissions:
                    return True
        return False
    
    def has_role(self, user_id: PydanticObjectId, role_to_check: WorkspaceRole) -> bool:
        roles = self.get_member_roles(user_id)
        if roles:
            for role in roles:
                if role.role_name == role_to_check:
                    return True
        return False    

    def is_owner(self, user_id: PydanticObjectId) -> bool:
        for member in self.members:
            if member.user_id == user_id and WorkspaceRole.OWNER in self.get_member_role_names(user_id):
                return True
        return False

    class Settings:
        name = "workspaces"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    workspaces: Optional[List[PydanticObjectId]] = []
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
    workspace: Link[WorkspaceDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    deletable: bool = Field(default=True)

    class Settings:
        name = "docker_images"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    workspace: Link[WorkspaceDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_db"


class DeploymentDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    workspace: Link[WorkspaceDB]
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
    workspace: Link[WorkspaceDB]
    user: Link[UserDB]
    base_name: str
    image: Link[ImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "bases"


class ConfigVersionDB(BaseModel):
    version: int
    parameters: Dict[str, Any]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())


class ConfigDB(Document):
    config_name: str
    current_version: int = Field(default=1)
    parameters: Dict[str, Any] = Field(default=dict)
    version_history: List[ConfigVersionDB] = Field(default=[])
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "configs"


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    image: Link[ImageDB]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    workspace: Link[WorkspaceDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[VariantBaseDB]
    config_name: Optional[str]
    config: Link[ConfigDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

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
    workspace: Link[WorkspaceDB]
    deployed_app_variant: Optional[PydanticObjectId]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_environment_db"


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
    workspace: Link[WorkspaceDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "testsets"


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    workspace: Link[WorkspaceDB]
    user: Link[UserDB]
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

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
    workspace: Link[WorkspaceDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "human_evaluations"


class HumanEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    workspace: Link[WorkspaceDB]
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
    organization: Link[OrganizationDB]
    workspace: Link[WorkspaceDB]
    user: Link[UserDB]
    status: str = Field(default="EVALUATION_INITIALIZED")
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "evaluations"


class EvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    workspace: Link[WorkspaceDB]
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
        name = "evaluation_scenarios"


class SpanDB(Document):
    parent_span_id: Optional[str]
    meta: Optional[Dict[str, Any]]
    event_name: str  # Function or execution name
    event_type: Optional[str]
    start_time: datetime
    duration: Optional[int]
    status: str  # initiated, completed, stopped, cancelled
    end_time: datetime = Field(default=datetime.utcnow())
    inputs: Optional[List[str]]
    outputs: Optional[List[str]]
    prompt_template: Optional[str]
    tokens_input: Optional[int]
    tokens_output: Optional[int]
    token_total: Optional[int]
    cost: Optional[float]
    tags: Optional[List[str]]

    class Settings:
        name = "spans"


class Feedback(BaseModel):
    uid: str = Field(default=str(uuid4()))
    user_id: str
    feedback: Optional[str]
    score: Optional[float]
    meta: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime = Field(default=datetime.utcnow())


class TraceDB(Document):
    app_id: Optional[str]
    variant_id: str
    spans: List[PydanticObjectId]
    start_time: datetime
    end_time: datetime = Field(default=datetime.utcnow())
    cost: Optional[float]
    latency: float
    status: str  # initiated, completed, stopped, cancelled, failed
    token_consumption: Optional[int]
    user: Link[UserDB]
    tags: Optional[List[str]]
    feedbacks: Optional[List[Feedback]]

    class Settings:
        name = "traces"
