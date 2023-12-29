from pydantic import BaseModel
from typing import List


class Annotation(BaseModel):
    app_id: str
    variants_ids: List[str]
    annotation_key: str
    testset_id: str
    aggregated_results: List


class NewAnnotation(BaseModel):
    app_id: str
    variants_ids: List[str]
    annotation_key: str
    testset_id: str


class AnnotationScenarioUpdate(BaseModel):
    app_id: str
    variants_ids: List[str]
    annotation_key: str
    testset_id: str
