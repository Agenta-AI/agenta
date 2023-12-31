from pydantic import BaseModel
from typing import Optional, List, Any
from enum import Enum
from agenta_backend.models.api.api_models import Result


class AnnotationStatusEnum(str, Enum):
    ANNOTATION_INITIALIZED = "ANNOTATION_INITIALIZED"
    ANNOTATION_STARTED = "ANNOTATION_STARTED"
    ANNOTATION_FINISHED = "ANNOTATION_FINISHED"
    ANNOTATION_ERROR = "ANNOTATION_ERROR"


class Annotation(BaseModel):
    id: str
    app_id: str
    variants_ids: List[str]
    annotation_name: str
    testset_id: str
    aggregated_results: List


class NewAnnotation(BaseModel):
    app_id: str
    variants_ids: List[str]
    annotation_name: str
    testset_id: str


class AnnotationScenarioUpdate(BaseModel):
    result: Result


class AnnotationScenarioInput(BaseModel):
    name: str
    type: str
    value: Any


class AnnotationScenarioOutput(BaseModel):
    type: str
    value: Any


class AnnoatationScenarioResult(BaseModel):
    variant_id: str
    result: Result


class AnnotationScenario(BaseModel):
    id: Optional[str]
    annotation_id: str
    inputs: List[AnnotationScenarioInput]
    outputs: List[AnnotationScenarioOutput]
    is_pinned: Optional[bool]
    note: Optional[str]
    result: AnnoatationScenarioResult


class AnnotationScenarioInput(BaseModel):
    name: str
    type: str
    value: Any
