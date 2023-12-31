from pydantic import BaseModel
from typing import List, Any
from enum import Enum


class AnnotationStatusEnum(str, Enum):
    ANNOTATION_INITIALIZED = "ANNOTATION_INITIALIZED"
    ANNOTATION_STARTED = "ANNOTATION_STARTED"
    ANNOTATION_FINISHED = "ANNOTATION_FINISHED"
    ANNOTATION_ERROR = "ANNOTATION_ERROR"


class Annotation(BaseModel):
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
    app_id: str
    variants_ids: List[str]
    annotation_name: str
    testset_id: str


class AnnotationScenario(BaseModel):
    annotation: str


class AnnotationScenarioInput(BaseModel):
    name: str
    type: str
    value: Any
