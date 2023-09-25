from bson import ObjectId
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from odmantic import Field, Model, Reference, EmbeddedModel


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

    class Config:
        collection = "organizations"


class UserDB(Model):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[ObjectId]] = []

    class Config:
        collection = "users"


class ImageDB(Model):
    """Defines the info needed to get an image and connect it to the app variant"""

    docker_id: str = Field(index=True)
    tags: str
    user_id: UserDB = Reference(key_name="user")
    organization_id: OrganizationDB = Reference(key_name="organization")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "docker_images"


class AppDB(Model):
    app_name: str
    organization_id: OrganizationDB = Reference(key_name="organization")
    user_id: UserDB = Reference(key_name="user")


class BaseDB(Model):  # not used
    base_name: str
    image_id: ImageDB = Reference(key_name="image")

    class Config:
        collection = "bases"


class ConfigDB(Model):  # not used
    config_name: str
    parameters: Dict[str, Any] = Field(default=dict)

    class Config:
        collection = "configs"


class AppVariantDB(Model):
    app_id: AppDB = Reference(key_name="app")
    variant_name: str
    image_id: ImageDB = Reference(key_name="image")
    user_id: UserDB = Reference(key_name="user")
    organization_id: OrganizationDB = Reference(key_name="organization")
    parameters: Dict[str, Any] = Field(default=dict)
    previous_variant_name: Optional[str]
    base_name: Optional[str]
    base_id: Optional[BaseDB] = Reference(key_name="bases")
    config_name: Optional[str]
    config_id: Optional[ConfigDB] = Reference(key_name="configs")

    is_deleted: bool = Field(
        default=False
    )  # soft deletion for using the template variants

    class Config:
        collection = "app_variants"


class EnvironmentDB(Model):
    app_id: AppDB = Reference(key_name="app")
    name: str
    user_id: UserDB = Reference(key_name="user")
    organization_id: OrganizationDB = Reference(key_name="organization")
    deployed_app_variant: Optional[str]
    deployed_base_name: Optional[str]
    deployed_config_name: Optional[str]

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
    variant_id: AppVariantDB = Reference(key_name="app_variants")
    variant_output: str


class EvaluationDB(Model):
    status: str
    evaluation_type: str
    custom_code_evaluation_id: Optional[str]
    evaluation_type_settings: EvaluationTypeSettings
    llm_app_prompt_template: str
    variant_ids: List[AppVariantDB] = Reference(key_name="app_variants")
    app_id: AppDB = Reference(key_name="app")
    testset: Dict[str, str]
    user: UserDB = Reference(key_name="user")
    organization_id: Optional[OrganizationDB] = Reference(key_name="organization")
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
    evaluation_id: EvaluationDB = Reference(key_name="evaluations")
    user: UserDB = Reference(key_name="user")
    organization_id: OrganizationDB = Reference(key_name="organization")
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "evaluation_scenarios"


class CustomEvaluationDB(Model):
    evaluation_id: EvaluationDB = Reference(key_name="evaluations")
    python_code: str
    app_id: AppDB = Reference(key_name="app")
    user: UserDB = Reference(key_name="user")
    organization_id: OrganizationDB = Reference(key_name="organization")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "custom_evaluations"


class TestSetDB(Model):
    name: str
    app_id: AppDB = Reference(key_name="app")
    csvdata: List[Dict[str, str]]
    user: UserDB = Reference(key_name="user")
    organization_id: OrganizationDB = Reference(key_name="organization")
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Config:
        collection = "testsets"
