from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from uuid import uuid4

from bson import ObjectId
from odmantic import EmbeddedModel, Field, Model, Reference


class APIKeyDB(Model):
    prefix: str
    hashed_key: str
    user_id: str
    rate_limit: int = Field(default=0)
    hidden: Optional[bool] = Field(default=False)
    expiration_date: Optional[datetime]
    created_at: Optional[datetime] = datetime.utcnow()
    updated_at: Optional[datetime]

    class Config:
        collection = "api_keys"


class InvitationDB(EmbeddedModel):
    token: str = Field(unique=True)
    email: str
    expiration_date: datetime = Field(default="0")
    used: bool = False


class OrganizationDB(Model):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[ObjectId]]
    invitations: Optional[List[InvitationDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "organizations"


class UserDB(Model):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[ObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "users"


class ImageDB(Model):
    """Defines the info needed to get an image and connect it to the app variant"""

    type: Optional[str] = Field(default="image")
    template_uri: Optional[str]
    docker_id: Optional[str] = Field(index=True)
    tags: Optional[str]
    deletable: bool = Field(default=True)
    user: UserDB = Reference(key_name="user")
    organization: OrganizationDB = Reference(key_name="organization")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())
    deletable: bool = Field(default=True)

    class Config:
        collection = "docker_images"


class AppDB(Model):
    app_name: str
    organization: OrganizationDB = Reference(key_name="organization")
    user: UserDB = Reference(key_name="user")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())


class DeploymentDB(Model):
    app: AppDB = Reference(key_name="app")
    organization: OrganizationDB = Reference(key_name="organization")
    user: UserDB = Reference(key_name="user")
    container_name: Optional[str]
    container_id: Optional[str]
    uri: Optional[str]
    status: str
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "deployments"


class VariantBaseDB(Model):
    app: AppDB = Reference(key_name="app")
    organization: OrganizationDB = Reference(key_name="organization")
    user: UserDB = Reference(key_name="user")
    base_name: str
    image: ImageDB = Reference(key_name="image")
    deployment: Optional[ObjectId]  # Reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "bases"


class ConfigVersionDB(EmbeddedModel):
    version: int
    parameters: Dict[str, Any]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())


class ConfigDB(Model):
    config_name: str
    current_version: int = Field(default=1)
    parameters: Dict[str, Any] = Field(default=dict)
    version_history: List[ConfigVersionDB] = Field(default=[])
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "configs"


class AppVariantDB(Model):
    app: AppDB = Reference()
    variant_name: str
    image: ImageDB = Reference()
    user: UserDB = Reference()
    organization: OrganizationDB = Reference()
    base_name: Optional[str]
    base: VariantBaseDB = Reference(key_name="bases")
    config_name: Optional[str]
    config: ConfigDB = Reference(key_name="configs")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "app_variants"


class AppEnvironmentDB(Model):
    app: AppDB = Reference()
    name: str
    user: UserDB = Reference()
    organization: OrganizationDB = Reference()
    deployed_app_variant: Optional[ObjectId]
    deployment: Optional[ObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "environments"


class TemplateDB(Model):
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

    class Config:
        collection = "templates"


class TestSetDB(Model):
    name: str
    app: AppDB = Reference(key_name="app")
    csvdata: List[Dict[str, str]]
    user: UserDB = Reference(key_name="user")
    organization: OrganizationDB = Reference(key_name="organization")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "testsets"


class CustomEvaluationDB(Model):
    evaluation_name: str
    python_code: str
    app: AppDB = Reference(key_name="app")
    user: UserDB = Reference(key_name="user")
    organization: OrganizationDB = Reference(key_name="organization")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "custom_evaluations"


class EvalSettingsTemplate(EmbeddedModel):
    type: str
    default: str
    description: str


class EvaluatorDB(Model):
    name: str = Field(required=True)
    settings_template: Dict[str, EvalSettingsTemplate]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Config:
        collection = "evaluators"


class EvalSettingsValue(EmbeddedModel):
    parameter: str
    threshold_value: float = Field(min_value=0.0, max_value=1.0)


class EvaluatorConfigDB(Model):
    evaluator: EvaluatorDB = Reference()
    settings_value: EvalSettingsValue
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Config:
        collection = "evaluator_config"


class EvaluationScenarioResult(EmbeddedModel):
    evaluator: EvaluatorDB = Reference()
    result: Any


class EvaluationScenarioInput(EmbeddedModel):
    name: str
    type: str
    value: str


class EvaluationScenarioOutput(EmbeddedModel):
    type: str
    value: str


class EvaluationDB(Model):
    app: AppDB = Reference(key_name="app")
    organization: OrganizationDB = Reference(key_name="organization")
    user: UserDB = Reference(key_name="user")
    testset: TestSetDB = Reference()
    variants: List[AppVariantDB]
    evaluators: List[EvaluatorConfigDB]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Config:
        collection = "evaluations"


class EvaluationScenarioDB(Model):
    user: UserDB = Reference()
    organization: OrganizationDB = Reference()
    evaluation: EvaluationDB = Reference()
    inputs: List[EvaluationScenarioInput]
    outputs: List[EvaluationScenarioOutput]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]
    evaluators: List[EvaluatorConfigDB]
    results: List[EvaluationScenarioResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Config:
        collection = "evaluation_scenarios"


class SpanDB(Model):
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

    class Config:
        collection = "spans"


class Feedback(EmbeddedModel):
    uid: str = Field(default=str(uuid4()))
    user_id: str
    feedback: Optional[str]
    score: Optional[float]
    meta: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime = Field(default=datetime.utcnow())


class TraceDB(Model):
    app_id: Optional[str]
    variant_id: str
    spans: List[ObjectId]
    start_time: datetime
    end_time: datetime = Field(default=datetime.utcnow())
    cost: Optional[float]
    latency: float
    status: str  # initiated, completed, stopped, cancelled, failed
    token_consumption: Optional[int]
    user: UserDB = Reference()
    tags: Optional[List[str]]
    feedbacks: Optional[List[Feedback]]

    class Config:
        collection = "traces"
