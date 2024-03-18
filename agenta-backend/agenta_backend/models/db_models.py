from enum import Enum
from uuid import uuid4
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "docker_images"


class AppDB(Document):
    app_name: str
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "app_db"


class DeploymentDB(Document):
    app: Link[AppDB]
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
    user: Link[UserDB]
    base_name: str
    image: Link[ImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "bases"


class ConfigDB(BaseModel):
    config_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    revision: int
    image: Link[ImageDB]
    user: Link[UserDB]
    modified_by: Link[UserDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[VariantBaseDB]
    config_name: Optional[str]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "app_variant_revisions"


class AppEnvironmentDB(Document):
    app: Link[AppDB]
    name: str
    user: Link[UserDB]
    revision: int
    deployed_app_variant: Optional[PydanticObjectId]
    deployed_app_variant_revision: Optional[Link[AppVariantRevisionsDB]]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "environments"


class AppEnvironmentRevisionDB(Document):
    environment: Link[AppEnvironmentDB]
    revision: int
    modified_by: Link[UserDB]
    deployed_app_variant_revision: Optional[PydanticObjectId]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "environments_revisions"


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
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "testsets"


class EvaluatorConfigDB(Document):
    app: Link[AppDB]
    user: Link[UserDB]
    name: str
    evaluator_key: str
    settings_values: Dict[str, Any] = Field(default=dict)
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "evaluators_configs"


class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None


class Result(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None


class InvokationResult(BaseModel):
    result: Result


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


class HumanEvaluationDB(Document):
    app: Link[AppDB]
    user: Link[UserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    variants_revisions: List[PydanticObjectId]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "human_evaluations"


class HumanEvaluationScenarioDB(Document):
    user: Link[UserDB]
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
    user: Link[UserDB]
    status: Result
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    variant_revision: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "new_evaluations"


class EvaluationScenarioDB(Document):
    user: Link[UserDB]
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
        name = "new_evaluation_scenarios"


class SpanEnumStatus(str, Enum):
    INITIATED = "INITIATED"
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class SpanStatus(BaseModel):
    value: Optional[SpanEnumStatus]
    error: Optional[Error]


class Feedback(BaseModel):
    uid: str = Field(default=str(uuid4()))
    user_id: str
    feedback: Optional[str]
    score: Optional[float]
    meta: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime = Field(default=datetime.now())


class LLMTokens(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class TracingEventTypes(BaseModel):
    LLM_REQUEST = "llm_request"
    EMBEDDING = "embedding"


class TraceDB(Document):
    app_id: str
    base_id: str
    config_name: str
    trace_name: Optional[str]
    meta: Optional[Dict[str, Any]]
    start_time: datetime
    end_time: datetime = Field(default=datetime.now())
    cost: Optional[float]
    inputs: Optional[Dict[str, Any]]
    outputs: Optional[List[str]]
    variant_config: Dict[str, Any]
    environment: Optional[str]  # request source -> playground, development, etc
    status: str  # initiated, completed, stopped, canceled, failed
    user: Optional[str]
    tags: Optional[List[str]]
    token_consumption: Optional[int]
    feedbacks: Optional[List[Feedback]]
    created_at: datetime = Field(default=datetime.now())

    @lru_cache()
    def get_latency(cls) -> float:
        return (cls.end_time - cls.start_time).total_seconds()

    class Settings:
        name = "traces"


class SpanDB(Document):
    trace: Link[TraceDB]
    parent_span_id: Optional[str]  # parent observability of span
    meta: Optional[Dict[str, Any]]
    event_name: str  # Function or execution name
    event_type: Optional[TracingEventTypes]
    status: SpanStatus
    input: Optional[str]
    output: Optional[str]
    model: str
    user: Optional[str]
    environment: Optional[str]  # request source -> playground, development, etc
    start_time: datetime
    end_time: datetime = Field(default=datetime.now())
    tokens: Optional[LLMTokens]
    created_at: datetime = Field(default=datetime.now())

    @lru_cache()
    def get_latency(cls) -> float:
        return (cls.end_time - cls.start_time).total_seconds()

    class Settings:
        name = "spans"
        # use_cache = True  # Important for link indexing performance
        indexes = []  # TODO: how to index trace given that it's a linked document?
