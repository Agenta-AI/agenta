from datetime import datetime
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    Column,
    String,
    Integer,
    DateTime,
    Boolean,
    ForeignKey,
    JSON,
    Text,
    Float,
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class UserDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    uid = Column(String, unique=True, index=True, default="0")
    username = Column(String, default="agenta")
    email = Column(String, unique=True, default="demo@agenta.ai")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "users"


class ImageDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(String, default="image")
    template_uri = Column(String)
    docker_id = Column(String, index=True)
    tags = Column(String)
    deletable = Column(Boolean, default=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "docker_images"


class AppDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_name = Column(String)
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "app_db"


class DeploymentDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    container_name = Column(String)
    container_id = Column(String)
    uri = Column(String)
    status = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "deployments"


class VariantBaseDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    base_name = Column(String)
    image_id = Column(Integer, ForeignKey("docker_images.id"))
    image = relationship("ImageDB")
    deployment_id = Column(Integer)  # reference to deployment, can be nullable
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "bases"


class AppVariantDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    variant_name = Column(String)
    revision = Column(Integer)
    image_id = Column(Integer, ForeignKey("docker_images.id"))
    image = relationship("ImageDB")
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB", foreign_keys=[user_id])
    modified_by_id = Column(Integer, ForeignKey("users.id"))
    modified_by = relationship("UserDB", foreign_keys=[modified_by_id])
    parameters = Column(JSON, default=dict)  # deprecated
    previous_variant_name = Column(String)  # deprecated
    base_name = Column(String)
    base_id = Column(Integer, ForeignKey("bases.id"))
    base = relationship("VariantBaseDB")
    config_name = Column(String)
    config_id = Column(JSON)
    config = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    is_deleted = Column(Boolean, default=False)  # deprecated

    __tablename__ = "app_variants"


class AppVariantRevisionsDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    variant_id = Column(Integer, ForeignKey("app_variants.id"))
    variant = relationship("AppVariantDB")
    revision = Column(Integer)
    modified_by_id = Column(Integer, ForeignKey("users.id"))
    modified_by = relationship("UserDB")
    base_id = Column(Integer, ForeignKey("bases.id"))
    base = relationship("VariantBaseDB")
    config = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "app_variant_revisions"


class AppEnvironmentDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    name = Column(String)
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    revision = Column(Integer)
    deployed_app_variant_id = Column(Integer)  # reference to app_variant
    deployed_app_variant_revision_id = Column(
        Integer, ForeignKey("app_variant_revisions.id")
    )
    deployed_app_variant_revision = relationship("AppVariantRevisionsDB")
    deployment_id = Column(Integer)  # reference to deployment
    created_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "environments"


class AppEnvironmentRevisionDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    environment_id = Column(Integer, ForeignKey("environments.id"))
    environment = relationship("AppEnvironmentDB")
    revision = Column(Integer)
    modified_by_id = Column(Integer, ForeignKey("users.id"))
    modified_by = relationship("UserDB")
    deployed_app_variant_revision_id = Column(
        Integer
    )  # reference to app_variant_revision
    deployment_id = Column(Integer)  # reference to deployment
    created_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "environments_revisions"


class TemplateDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(String, default="image")
    template_uri = Column(String)
    tag_id = Column(Integer)
    name = Column(String, unique=True)
    repo_name = Column(String)
    title = Column(String)
    description = Column(String)
    size = Column(Integer)
    digest = Column(String)  # sha256 hash of image digest
    last_pushed = Column(String)

    __tablename__ = "templates"


class TestSetDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    csvdata = Column(JSON)  # List of dictionaries
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "testsets"


class EvaluatorConfigDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "evaluators_configs"


class HumanEvaluationDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    status = Column(String)
    evaluation_type = Column(String)
    variants = Column(JSON)  # List of PydanticObjectId
    variants_revisions = Column(JSON)  # List of PydanticObjectId
    testset_id = Column(Integer, ForeignKey("testsets.id"))
    testset = relationship("TestSetDB")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "human_evaluations"


class HumanEvaluationScenarioDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    evaluation_id = Column(Integer, ForeignKey("human_evaluations.id"))
    evaluation = relationship("HumanEvaluationDB")
    inputs = Column(JSON)  # List of HumanEvaluationScenarioInput
    outputs = Column(JSON)  # List of HumanEvaluationScenarioOutput
    vote = Column(String)
    score = Column(JSON)  # Any type
    correct_answer = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    is_pinned = Column(Boolean)
    note = Column(String)

    __tablename__ = "human_evaluations_scenarios"


class EvaluationDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    status = Column(JSON)  # Result type
    testset_id = Column(Integer, ForeignKey("testsets.id"))
    testset = relationship("TestSetDB")
    variant = Column(Integer)  # PydanticObjectId
    variant_revision = Column(Integer)  # PydanticObjectId
    evaluators_configs = Column(JSON)  # List of PydanticObjectId
    aggregated_results = Column(JSON)  # List of AggregatedResult
    average_cost = Column(JSON)  # Result type
    total_cost = Column(JSON)  # Result type
    average_latency = Column(JSON)  # Result type
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "new_evaluations"


class EvaluationScenarioDB(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    user = relationship("UserDB")
    evaluation_id = Column(Integer, ForeignKey("new_evaluations.id"))
    evaluation = relationship("EvaluationDB")
    variant_id = Column(Integer)  # PydanticObjectId
    inputs = Column(JSON)  # List of EvaluationScenarioInputDB
    outputs = Column(JSON)  # List of EvaluationScenarioOutputDB
    correct_answers = Column(JSON)  # List of CorrectAnswer
    is_pinned = Column(Boolean)
    note = Column(String)
    evaluators_configs = Column(JSON)  # List of PydanticObjectId
    results = Column(JSON)  # List of EvaluationScenarioResult
    latency = Column(Integer)
    cost = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __tablename__ = "new_evaluation_scenarios"


class ConfigDB(BaseModel):
    config_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        arbitrary_types_allowed = True


class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True


class Result(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None

    class Config:
        arbitrary_types_allowed = True


class InvokationResult(BaseModel):
    result: Result
    cost: Optional[float] = None
    latency: Optional[float] = None

    class Config:
        arbitrary_types_allowed = True


class EvaluationScenarioResult(BaseModel):
    evaluator_config: int  # Assuming this should be an ID reference
    result: Result

    class Config:
        arbitrary_types_allowed = True


class AggregatedResult(BaseModel):
    evaluator_config: int  # Assuming this should be an ID reference
    result: Result

    class Config:
        arbitrary_types_allowed = True


class EvaluationScenarioInputDB(BaseModel):
    name: str
    type: str
    value: str

    class Config:
        arbitrary_types_allowed = True


class EvaluationScenarioOutputDB(BaseModel):
    result: Result
    cost: Optional[float] = None
    latency: Optional[float] = None

    class Config:
        arbitrary_types_allowed = True


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str

    class Config:
        arbitrary_types_allowed = True


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str

    class Config:
        arbitrary_types_allowed = True


class CorrectAnswer(BaseModel):
    key: str
    value: str
