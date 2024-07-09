from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from beanie import iterative_migration, Link
from beanie import Document, Link, PydanticObjectId


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "organizations"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

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
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "docker_images"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "app_db"


class VariantBaseDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    base_name: str
    image: Link[ImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "bases"


class ConfigVersionDB(BaseModel):
    version: int
    parameters: Dict[str, Any]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))


class ConfigDB(Document):
    config_name: str
    current_version: int = Field(default=1)
    parameters: Dict[str, Any] = Field(default=dict)
    version_history: List[ConfigVersionDB] = Field(default=[])
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "configs"


class AppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    image: Link[ImageDB]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    parameters: Dict[str, Any] = Field(default=dict)
    previous_variant_name: Optional[str]
    base_name: Optional[str]
    base: Link[VariantBaseDB]
    config_name: Optional[str]
    config: Link[ConfigDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class OldAppVariantDB(Document):
    app: Link[AppDB]
    variant_name: str
    image: Link[ImageDB]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    bases: Link[VariantBaseDB]
    config_name: Optional[str]
    configs: Link[ConfigDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class TestSetDB(Document):
    name: str
    app: Link[AppDB]
    csvdata: List[Dict[str, str]]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "testsets"


class OldEvaluationTypeSettings(BaseModel):
    similarity_threshold: Optional[float]
    regex_pattern: Optional[str]
    regex_should_match: Optional[bool]
    webhook_url: Optional[str]
    llm_app_prompt_template: Optional[str]
    custom_code_evaluation_id: Optional[str]
    evaluation_prompt_template: Optional[str]


class OldEvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: Optional[str]
    evaluation_type_settings: Optional[OldEvaluationTypeSettings]
    variants: Optional[List[PydanticObjectId]]
    testsets: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "evaluations"


class EvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str
    evaluation_type: Optional[str]
    evaluation_type_settings: Optional[OldEvaluationTypeSettings]
    variants: Optional[List[PydanticObjectId]]
    testset: Link[TestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))

    class Settings:
        name = "evaluations"


class OldEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class OldEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class OldEvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluations: Link[EvaluationDB]
    inputs: List[OldEvaluationScenarioInput]
    outputs: List[OldEvaluationScenarioOutput]  # EvaluationScenarioOutput
    vote: Optional[str]
    score: Optional[Any]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    is_pinned: Optional[bool]
    note: Optional[str]

    class Settings:
        name = "evaluation_scenarios"


class EvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[EvaluationDB]
    inputs: List[OldEvaluationScenarioInput]
    outputs: List[OldEvaluationScenarioOutput]  # EvaluationScenarioOutput
    vote: Optional[str]
    score: Optional[Any]
    correct_answer: Optional[str]
    created_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(default=datetime.now(timezone.utc))
    is_pinned: Optional[bool]
    note: Optional[str]

    class Settings:
        name = "evaluation_scenarios"


class Forward:
    @iterative_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            ImageDB,
            AppDB,
            VariantBaseDB,
            ConfigDB,
            AppVariantDB,
            OldAppVariantDB,
        ]
    )
    async def change_app_variant_fields(
        self, input_document: OldAppVariantDB, output_document: AppVariantDB
    ):
        output_document.base = input_document.bases
        output_document.config = input_document.configs

    @iterative_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            AppDB,
            TestSetDB,
            EvaluationDB,
            OldEvaluationDB,
        ]
    )
    async def rename_evaluation_fields(
        self, input_document: OldEvaluationDB, output_document: EvaluationDB
    ):
        output_document.testset = input_document.testsets

    @iterative_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            AppDB,
            TestSetDB,
            EvaluationDB,
            OldEvaluationDB,
            EvaluationScenarioDB,
            OldEvaluationScenarioDB,
        ]
    )
    async def rename_evaluation_scenarios_fields(
        self,
        input_document: OldEvaluationScenarioDB,
        output_document: EvaluationScenarioDB,
    ):
        output_document.evaluation = input_document.evaluations


class Backward:
    @iterative_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            ImageDB,
            VariantBaseDB,
            ConfigDB,
            AppVariantDB,
            OldAppVariantDB,
        ]
    )
    async def change_app_variant_fields(
        self, input_document: AppVariantDB, output_document: OldAppVariantDB
    ):
        output_document.bases = input_document.base
        output_document.configs = input_document.config

    @iterative_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            AppDB,
            TestSetDB,
            EvaluationDB,
            OldEvaluationDB,
        ]
    )
    async def rename_evaluation_fields(
        self, input_document: EvaluationDB, output_document: OldEvaluationDB
    ):
        output_document.testsets = input_document.testset

    @iterative_migration(
        document_models=[
            OrganizationDB,
            UserDB,
            AppDB,
            TestSetDB,
            EvaluationDB,
            OldEvaluationDB,
            EvaluationScenarioDB,
            OldEvaluationScenarioDB,
        ]
    )
    async def rename_evaluation_scenarios_fields(
        self,
        input_document: EvaluationScenarioDB,
        output_document: OldEvaluationScenarioDB,
    ):
        output_document.evaluations = input_document.evaluation
