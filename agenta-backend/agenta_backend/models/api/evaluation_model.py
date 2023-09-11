from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class EvaluationTypeSettings(BaseModel):
    similarity_threshold: Optional[float]


class EvaluationType(str, Enum):
    auto_exact_match = "auto_exact_match"
    auto_similarity_match = "auto_similarity_match"
    auto_ai_critique = "auto_ai_critique"
    human_a_b_testing = "human_a_b_testing"
    human_scoring = "human_scoring"


class EvaluationStatusEnum(str, Enum):
    EVALUATION_INITIALIZED = "EVALUATION_INITIALIZED"
    EVALUATION_STARTED = "EVALUATION_STARTED"
    COMPARISON_RUN_STARTED = "COMPARISON_RUN_STARTED"
    EVALUATION_FINISHED = "EVALUATION_FINISHED"


class EvaluationStatus(BaseModel):
    status: EvaluationStatusEnum


class Evaluation(BaseModel):
    id: str
    status: str
    evaluation_type: EvaluationType
    evaluation_type_settings: Optional[EvaluationTypeSettings]
    llm_app_prompt_template: Optional[str]
    variants: Optional[List[str]]
    app_name: str
    testset: Dict[str, str] = Field(...)
    created_at: datetime
    updated_at: datetime


class EvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class EvaluationScenarioOutput(BaseModel):
    variant_name: str
    variant_output: str


class EvaluationScenario(BaseModel):
    evaluation_id: str
    inputs: List[EvaluationScenarioInput]
    outputs: List[EvaluationScenarioOutput]
    vote: Optional[str]
    score: Optional[str]
    evaluation: Optional[str]
    correct_answer: Optional[str]
    id: Optional[str]


class EvaluationScenarioUpdate(BaseModel):
    vote: Optional[str]
    score: Optional[str]
    outputs: List[EvaluationScenarioOutput]
    evaluation_prompt_template: Optional[str]
    open_ai_key: Optional[str]


class NewEvaluation(BaseModel):
    evaluation_type: EvaluationType
    evaluation_type_settings: Optional[EvaluationTypeSettings]
    app_name: str
    variants: List[str]
    inputs: List[str]
    testset: Dict[str, str] = Field(...)
    status: str = Field(...)
    llm_app_prompt_template: Optional[str]


class DeleteEvaluation(BaseModel):
    evaluations_ids: List[str]


class CustomEvaluationTarget(BaseModel):
    inputs: Dict[str, Any]
    output: float
    target: float
    

class StoreCustomEvaluation(BaseModel):
    evaluation_name: str
    python_code: str
    app_name: str
    parameters: CustomEvaluationTarget
    allowed_imports: List[str]
    