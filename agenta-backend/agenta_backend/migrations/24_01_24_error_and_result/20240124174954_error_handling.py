from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel
from beanie import Document, Link, PydanticObjectId

#### Old Schemas ####


class OldResult(BaseModel):
    type: str
    value: Any


class AggregatedResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: OldResult


class OldEvaluation(BaseModel):
    id: str
    app_id: str
    user_id: str
    user_username: str
    variant_ids: List[str]
    variant_names: List[str]
    testset_id: str
    testset_name: str
    status: str
    aggregated_results: List[AggregatedResult]
    created_at: datetime
    updated_at: datetime


class EvaluationScenarioOutputDB(BaseModel):
    type: str
    value: Any


#### New Schemas ####


class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None


class Result(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None


class Evaluation(BaseModel):
    id: str
    app_id: str
    user_id: str
    user_username: str
    variant_ids: List[str]
    variant_names: List[str]
    testset_id: str
    testset_name: str
    status: Result
    aggregated_results: List[AggregatedResult]
    created_at: datetime
    updated_at: datetime


class EvaluationScenarioOutputDB(BaseModel):
    result: Result


class Forward:
    ...


class Backward:
    ...
