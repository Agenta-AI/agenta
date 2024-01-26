from enum import Enum
from uuid import uuid4
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId


class NewUserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "users"


class NewImageDB(Document):
    """Defines the info needed to get an image and connect it to the app variant"""

    type: Optional[str] = Field(default="image")
    template_uri: Optional[str]
    docker_id: Optional[str] = Field(index=True)
    tags: Optional[str]
    deletable: bool = Field(default=True)
    user: Link[NewUserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "docker_images"


class NewAppDB(Document):
    app_name: str
    user: Link[NewUserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_db"


class NewDeploymentDB(Document):
    app: Link[NewAppDB]
    user: Link[NewUserDB]
    container_name: Optional[str]
    container_id: Optional[str]
    uri: Optional[str]
    status: str
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "deployments"


class NewVariantBaseDB(Document):
    app: Link[NewAppDB]
    user: Link[NewUserDB]
    base_name: str
    image: Link[NewImageDB]
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


class NewAppVariantDB(Document):
    app: Link[NewAppDB]
    variant_name: str
    image: Link[NewImageDB]
    user: Link[NewUserDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[NewVariantBaseDB]
    config_name: Optional[str]
    config: Link[ConfigDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class NewAppEnvironmentDB(Document):
    app: Link[NewAppDB]
    name: str
    user: Link[NewUserDB]
    deployed_app_variant: Optional[PydanticObjectId]
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


class NewTestSetDB(Document):
    name: str
    app: Link[NewAppDB]
    csvdata: List[Dict[str, str]]
    user: Link[NewUserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "testsets"


class NewEvaluatorConfigDB(Document):
    app: Link[NewAppDB]
    user: Link[NewUserDB]
    name: str
    evaluator_key: str
    settings_values: Dict[str, Any] = Field(default=dict)
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


class NewAggregatedResult(BaseModel):
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


class NewHumanEvaluationDB(Document):
    app: Link[NewAppDB]
    user: Link[NewUserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    testset: Link[NewTestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "human_evaluations"


class NewHumanEvaluationScenarioDB(Document):
    user: Link[NewUserDB]
    evaluation: Link[NewHumanEvaluationDB]
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


class NewEvaluationDB(Document):
    app: Link[NewAppDB]
    user: Link[NewUserDB]
    status: str = Field(default="EVALUATION_INITIALIZED")
    testset: Link[NewTestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[NewAggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluations"


class NewEvaluationScenarioDB(Document):
    user: Link[NewUserDB]
    evaluation: Link[NewEvaluationDB]
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
    user: Link[NewUserDB]
    tags: Optional[List[str]]
    feedbacks: Optional[List[Feedback]]

    class Settings:
        name = "traces"
