from uuid import uuid4
from bson import ObjectId
from datetime import datetime
from typing import Any, Dict, List, Optional

from odmantic import EmbeddedModel, Field, Model, Reference


class OrganizationDB(Model):
    name: str = Field(default="agenta")
    description: str = Field(default="")

    class Config:
        collection = "organizations"


class UserDB(Model):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organization_id: OrganizationDB = Reference(key_name="org")

    class Config:
        collection = "users"


class ImageDB(Model):
    """Defines the info needed to get an image and connect it to the app variant"""

    docker_id: str = Field(index=True)
    tags: str
    user_id: UserDB = Reference(key_name="user")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "docker_images"


class AppVariantDB(Model):
    app_name: str
    variant_name: str
    image_id: ImageDB = Reference(key_name="image")
    user_id: UserDB = Reference(key_name="user")
    parameters: Dict[str, Any] = Field(default=dict)
    previous_variant_name: Optional[str]
    is_deleted: bool = Field(
        default=False
    )  # soft deletion for using the template variants

    class Config:
        collection = "app_variants"


class EnvironmentDB(Model):
    name: str
    user_id: UserDB = Reference(key_name="user")
    app_name: str
    deployed_app_variant: Optional[str]

    class Config:
        collection = "environments"


class TemplateDB(Model):
    template_id: int
    name: str
    repo_name: str
    architecture: str
    title: str
    description: str
    size: int
    digest: str
    status: str
    media_type: str
    last_pushed: datetime

    class Config:
        collection = "templates"


class EvaluationTypeSettings(EmbeddedModel):
    similarity_threshold: Optional[float]
    regex_pattern: Optional[str]
    regex_should_match: Optional[bool]
    webhook_url: Optional[str]


class EvaluationScenarioInput(EmbeddedModel):
    input_name: str
    input_value: str


class EvaluationScenarioOutput(EmbeddedModel):
    variant_name: str
    variant_output: str


class EvaluationDB(Model):
    status: str
    evaluation_type: str
    custom_code_evaluation_id: Optional[str]
    evaluation_type_settings: EvaluationTypeSettings
    llm_app_prompt_template: str
    variants: List[str]
    app_name: str
    testset: Dict[str, str]
    user: UserDB = Reference(key_name="user")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "evaluations"


class EvaluationScenarioDB(Model):
    inputs: List[EvaluationScenarioInput]
    outputs: List[EvaluationScenarioOutput]
    vote: Optional[str]
    score: Optional[str]
    evaluation: Optional[str]
    evaluation_id: str
    user: UserDB = Reference(key_name="user")
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "evaluation_scenarios"


class CustomEvaluationDB(Model):
    evaluation_name: str
    python_code: str
    app_name: str
    user: UserDB = Reference()
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "custom_evaluations"


class TestSetDB(Model):
    name: str
    app_name: str
    csvdata: List[Dict[str, str]]
    user: UserDB = Reference(key_name="user")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "testsets"


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
    spans: List[ObjectId]
    start_time: datetime
    end_time: datetime = Field(default=datetime.utcnow())
    app_name: Optional[str]
    variant_name: Optional[str]
    cost: Optional[float]
    latency: float
    status: str  # initiated, completed, stopped, cancelled, failed
    token_consumption: Optional[int]
    user: UserDB = Reference()
    tags: Optional[List[str]]
    feedbacks: Optional[List[Feedback]]

    class Config:
        collection = "traces"


class DeploymentDB(Model):
    deploy_id: str = Field(unique=True, index=True)  # 6 characters from the SHA256 sum of the app_variant_id_str
    domain: str
    environment_id: EnvironmentDB = Reference(key_name="environment")
    variant_id: AppVariantDB = Reference(key_name="variant")  
    organization_id: OrganizationDB = Reference(key_name="org")
    user_id: UserDB = Reference(key_name="user")

    class Config:
        collection = "deployments"