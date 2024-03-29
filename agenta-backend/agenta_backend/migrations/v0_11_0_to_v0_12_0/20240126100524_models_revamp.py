from enum import Enum
from uuid import uuid4
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId

from beanie import iterative_migration


# Common Models
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


# Old DB Models
class InvitationDB(BaseModel):
    token: str = Field(unique=True)
    email: str
    expiration_date: datetime = Field(default="0")
    used: bool = False


class OldOrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    invitations: Optional[List[InvitationDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "organizations"


class OldUserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "users"


class OldImageDB(Document):
    """Defines the info needed to get an image and connect it to the app variant"""

    type: Optional[str] = Field(default="image")
    template_uri: Optional[str]
    docker_id: Optional[str] = Field(index=True)
    tags: Optional[str]
    deletable: bool = Field(default=True)
    user: Link[OldUserDB]
    organization: Link[OldOrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "docker_images"


class OldAppDB(Document):
    app_name: str
    organization: Link[OldOrganizationDB]
    user: Link[OldUserDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_db"


class OldDeploymentDB(Document):
    app: Link[OldAppDB]
    organization: Link[OldOrganizationDB]
    user: Link[OldUserDB]
    container_name: Optional[str]
    container_id: Optional[str]
    uri: Optional[str]
    status: str
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "deployments"


class OldVariantBaseDB(Document):
    app: Link[OldAppDB]
    organization: Link[OldOrganizationDB]
    user: Link[OldUserDB]
    base_name: str
    image: Link[OldImageDB]
    deployment: Optional[PydanticObjectId]  # Link to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "bases"


class OldAppVariantDB(Document):
    app: Link[OldAppDB]
    variant_name: str
    revision: int
    image: Link[OldImageDB]
    user: Link[OldUserDB]
    modified_by: Link[OldUserDB]
    organization: Link[OldOrganizationDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[OldVariantBaseDB]
    config_name: Optional[str]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class OldAppVariantRevisionsDB(Document):
    variant: Link[OldAppVariantDB]
    revision: int
    modified_by: Link[OldUserDB]
    base: Link[OldVariantBaseDB]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_variant_revisions"


class OldAppEnvironmentDB(Document):
    app: Link[OldAppDB]
    name: str
    user: Link[OldUserDB]
    organization: Link[OldOrganizationDB]
    deployed_app_variant: Optional[PydanticObjectId]
    deployed_app_variant_revision: Optional[Link[OldAppVariantRevisionsDB]]
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


class OldTestSetDB(Document):
    name: str
    app: Link[OldAppDB]
    csvdata: List[Dict[str, str]]
    user: Link[OldUserDB]
    organization: Link[OldOrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "testsets"


class OldEvaluatorConfigDB(Document):
    app: Link[OldAppDB]
    organization: Link[OldOrganizationDB]
    user: Link[OldUserDB]
    name: str
    evaluator_key: str
    settings_values: Dict[str, Any] = Field(default=dict)
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "evaluators_configs"


class OldHumanEvaluationDB(Document):
    app: Link[OldAppDB]
    organization: Link[OldOrganizationDB]
    user: Link[OldUserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    variants_revisions: List[PydanticObjectId]
    testset: Link[OldTestSetDB]
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "human_evaluations"


class OldHumanEvaluationScenarioDB(Document):
    user: Link[OldUserDB]
    organization: Link[OldOrganizationDB]
    evaluation: Link[OldHumanEvaluationDB]
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


class OldEvaluationDB(Document):
    app: Link[OldAppDB]
    organization: Link[OldOrganizationDB]
    user: Link[OldUserDB]
    status: Result
    testset: Link[OldTestSetDB]
    variant: PydanticObjectId
    variant_revision: Optional[PydanticObjectId] = None
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())

    class Settings:
        name = "new_evaluations"


class OldEvaluationScenarioDB(Document):
    user: Link[OldUserDB]
    organization: Link[OldOrganizationDB]
    evaluation: Link[OldEvaluationDB]
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


# New DB Models
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


class NewAppVariantDB(Document):
    app: Link[NewAppDB]
    variant_name: str
    revision: int
    image: Link[NewImageDB]
    user: Link[NewUserDB]
    modified_by: Link[NewUserDB]
    parameters: Dict[str, Any] = Field(default=dict)  # TODO: deprecated. remove
    previous_variant_name: Optional[str]  # TODO: deprecated. remove
    base_name: Optional[str]
    base: Link[NewVariantBaseDB]
    config_name: Optional[str]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    is_deleted: bool = Field(  # TODO: deprecated. remove
        default=False
    )  # soft deletion for using the template variants

    class Settings:
        name = "app_variants"


class NewAppVariantRevisionsDB(Document):
    variant: Link[NewAppVariantDB]
    revision: int
    modified_by: Link[NewUserDB]
    base: Link[NewVariantBaseDB]
    config: ConfigDB
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "app_variant_revisions"


class NewAppEnvironmentDB(Document):
    app: Link[NewAppDB]
    name: str
    user: Link[NewUserDB]
    deployed_app_variant: Optional[PydanticObjectId]
    deployed_app_variant_revision: Optional[Link[NewAppVariantRevisionsDB]]
    deployment: Optional[PydanticObjectId]  # reference to deployment
    created_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "environments"


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


class NewHumanEvaluationDB(Document):
    app: Link[NewAppDB]
    user: Link[NewUserDB]
    status: str
    evaluation_type: str
    variants: List[PydanticObjectId]
    variants_revisions: List[PydanticObjectId]
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
    status: Result
    testset: Link[NewTestSetDB]
    variant: PydanticObjectId
    variant_revision: Optional[PydanticObjectId] = None
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
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


class Forward:
    @iterative_migration(
        document_models=[
            OldUserDB,
            NewUserDB,
        ]
    )
    async def remove_organization_from_user_model(
        self, input_document: OldUserDB, output_document: NewUserDB
    ):
        input_document.dict(exclude={"organizations"})

    @iterative_migration(
        document_models=[
            OldAppDB,
            NewAppDB,
        ]
    )
    async def remove_organization_from_app_model(
        self, input_document: OldAppDB, output_document: NewAppDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldImageDB,
            NewImageDB,
        ]
    )
    async def remove_organization_from_image_model(
        self, input_document: OldImageDB, output_document: NewImageDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldTestSetDB,
            NewTestSetDB,
        ]
    )
    async def remove_organization_from_testset_model(
        self, input_document: OldTestSetDB, output_document: NewTestSetDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldVariantBaseDB,
            NewVariantBaseDB,
        ]
    )
    async def remove_organization_from_variant_base_model(
        self, input_document: OldVariantBaseDB, output_document: NewVariantBaseDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldAppVariantDB,
            NewVariantBaseDB,
        ]
    )
    async def remove_organization_from_app_variant_model(
        self, input_document: OldAppVariantDB, output_document: NewAppVariantDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldEvaluationDB,
            NewEvaluationDB,
        ]
    )
    async def remove_organization_from_evaluation_model(
        self, input_document: OldEvaluationDB, output_document: NewEvaluationDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldDeploymentDB,
            NewDeploymentDB,
        ]
    )
    async def remove_organization_from_deployment_model(
        self, input_document: OldDeploymentDB, output_document: NewDeploymentDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldAppEnvironmentDB,
            NewAppEnvironmentDB,
        ]
    )
    async def remove_organization_from_app_environment_model(
        self, input_document: OldAppEnvironmentDB, output_document: NewAppEnvironmentDB
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldEvaluatorConfigDB,
            NewEvaluatorConfigDB,
        ]
    )
    async def remove_organization_from_evaluator_config_model(
        self,
        input_document: OldEvaluatorConfigDB,
        output_document: NewEvaluatorConfigDB,
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldHumanEvaluationDB,
            NewHumanEvaluationDB,
        ]
    )
    async def remove_organization_from_human_evaluation_model(
        self,
        input_document: OldHumanEvaluationDB,
        output_document: NewHumanEvaluationDB,
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldEvaluationScenarioDB,
            NewEvaluationScenarioDB,
        ]
    )
    async def remove_organization_from_evaluation_scenario_model(
        self,
        input_document: OldEvaluationScenarioDB,
        output_document: NewEvaluationScenarioDB,
    ):
        input_document.dict(exclude={"organization"})

    @iterative_migration(
        document_models=[
            OldHumanEvaluationScenarioDB,
            NewHumanEvaluationScenarioDB,
        ]
    )
    async def remove_organization_from_app_environment_model(
        self,
        input_document: OldHumanEvaluationScenarioDB,
        output_document: NewHumanEvaluationScenarioDB,
    ):
        input_document.dict(exclude={"organization"})


class Backward:
    pass
