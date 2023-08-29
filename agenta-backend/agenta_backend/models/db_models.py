from datetime import datetime
from typing import Optional, Dict, Any, List
from odmantic import Field, Model, Reference, EmbeddedModel


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


class EvaluationScenarioInput(EmbeddedModel):
    input_name: str
    input_value: str


class EvaluationScenarioOutput(EmbeddedModel):
    variant_name: str
    variant_output: str


class EvaluationDB(Model):
    status: str
    evaluation_type: str
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


class TestSetDB(Model):
    name: str
    app_name: str
    csvdata: List[Dict[str, str]]
    user: UserDB = Reference(key_name="user")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "testsets"
