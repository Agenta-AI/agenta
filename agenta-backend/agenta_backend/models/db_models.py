from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from uuid import uuid4

from beanie import Document, Link, PydanticObjectId
from pydantic import BaseModel, Field


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
        collection = "api_keys"

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
        collection = "organizations"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        collection = "users"


class ImageDB(Document):
    """Defines the info needed to get an image and connect it to the app variant"""

    type: Optional[str] = Field(default="image")
    template_uri: Optional[str]
    docker_id: Optional[str] = Field(index=True)
    tags: Optional[str]
    deletable: bool = Field(default=True)
    user: UserDB = UserDB
    organization: OrganizationDB = OrganizationDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    deletable: bool = Field(default=True)

    class Settings:
        collection = "docker_images"


class AppDB(Document):
    app_name: str
    organization: OrganizationDB = OrganizationDB
    user: UserDB = UserDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())


class DeploymentDB(Document):
    app: AppDB = AppDB
    organization: OrganizationDB = OrganizationDB
    user: UserDB = UserDB
    container_name: Optional[str]
    container_id: Optional[str]
    uri: Optional[str]
    status: str
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        collection = "deployments"


class VariantBaseDB(Document):
    app: AppDB = AppDB
    organization: OrganizationDB = OrganizationDB
    user: UserDB = UserDB
    base_name: str
    image: ImageDB = ImageDB
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        collection = "bases"


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
        collection = "configs"


class AppVariantDB(Document):
    app: AppDB = AppDB
    variant_name: str
    image: ImageDB = ImageDB
    user: UserDB = UserDB
    organization: OrganizationDB = OrganizationDB
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: VariantBaseDB = VariantBaseDB
    config_name: Optional[str]
    config: ConfigDB = ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        collection = "app_variants"


class AppEnvironmentDB(Document):
    app: AppDB = AppDB
    name: str
    user: UserDB = UserDB
    organization: OrganizationDB = OrganizationDB
    deployed_app_variant: Optional[PydanticObjectId]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())


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
    app: AppDB = AppDB
    csvdata: List[Dict[str, str]]
    user: UserDB = UserDB
    organization: OrganizationDB = OrganizationDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        collection = "testsets"


class CustomEvaluationDB(Document):
    evaluation_name: str
    python_code: str
    app: AppDB = AppDB
    user: UserDB = UserDB
    organization: OrganizationDB = OrganizationDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        collection = "custom_evaluations"


class EvaluationSettingsTemplate(BaseModel):
    type: str
    default: str
    description: str


class EvaluatorConfigDB(Document):
    app: AppDB = AppDB
    organization: OrganizationDB = OrganizationDB
    user: UserDB = UserDB
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        collection = "evaluators_configs"


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
    app: AppDB = AppDB
    organization: OrganizationDB = OrganizationDB
    user: UserDB = UserDB
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    testset: TestSetDB = TestSetDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        collection = "human_evaluations"


class HumanEvaluationScenarioDB(Document):
    user: UserDB = UserDB
    organization: OrganizationDB = OrganizationDB
    evaluation: HumanEvaluationDB = HumanEvaluationDB
    inputs: List[HumanEvaluationScenarioInput]
    outputs: List[HumanEvaluationScenarioOutput]
    vote: Optional[str]
    score: Optional[Union[str, int]]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    is_pinned: Optional[bool]
    note: Optional[str]

    class Settings:
        collection = "human_evaluations_scenarios"


class EvaluationDB(Document):
    app: AppDB = AppDB
    organization: OrganizationDB = OrganizationDB
    user: UserDB = UserDB
    status: str = Field(default="EVALUATION_INITIALIZED")
    testset: TestSetDB = TestSetDB
    variants: List[PydanticObjectId]
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        collection = "evaluations"


class EvaluationScenarioDB(Document):
    user: UserDB = UserDB
    organization: OrganizationDB = OrganizationDB
    evaluation: EvaluationDB = EvaluationDB
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
        collection = "evaluation_scenarios"


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
        collection = "spans"


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
    user: UserDB = UserDB
    tags: Optional[List[str]]
    feedbacks: Optional[List[Feedback]]

    class Settings:
        collection = "traces"
