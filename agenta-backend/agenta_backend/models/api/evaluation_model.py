from enum import Enum
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union
from agenta_backend.models.api.api_models import Result


class Evaluator(BaseModel):
    name: str
    key: str
    direct_use: bool
    settings_template: dict


class EvaluatorConfig(BaseModel):
    id: str
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class EvaluationTypeSettings(BaseModel):
    similarity_threshold: Optional[float]
    regex_pattern: Optional[str]
    regex_should_match: Optional[bool]
    webhook_url: Optional[str]
    custom_code_evaluation_id: Optional[str]
    llm_app_prompt_template: Optional[str]
    evaluation_prompt_template: Optional[str]


class EvaluationType(str, Enum):
    auto_exact_match = "auto_exact_match"
    auto_similarity_match = "auto_similarity_match"
    auto_regex_test = "auto_regex_test"
    auto_webhook_test = "auto_webhook_test"
    auto_ai_critique = "auto_ai_critique"
    human_a_b_testing = "human_a_b_testing"
    human_scoring = "human_scoring"
    custom_code_run = "custom_code_run"
    single_model_test = "single_model_test"


class EvaluationStatusEnum(str, Enum):
    EVALUATION_INITIALIZED = "EVALUATION_INITIALIZED"
    EVALUATION_STARTED = "EVALUATION_STARTED"
    EVALUATION_FINISHED = "EVALUATION_FINISHED"
    EVALUATION_FAILED = "EVALUATION_FAILED"


class EvaluationScenarioStatusEnum(str, Enum):
    COMPARISON_RUN_STARTED = "COMPARISON_RUN_STARTED"


class AggregatedResult(BaseModel):
    evaluator_config: EvaluatorConfig
    result: Result


class NewHumanEvaluation(BaseModel):
    app_id: str
    variant_ids: List[str]
    evaluation_type: EvaluationType
    evaluation_type_settings: Optional[EvaluationTypeSettings]
    inputs: List[str]
    testset_id: str
    status: str


class Evaluation(BaseModel):
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


class SimpleEvaluationOutput(BaseModel):
    id: str
    variant_ids: List[str]
    app_id: str
    status: str
    evaluation_type: EvaluationType


class HumanEvaluationUpdate(BaseModel):
    status: Optional[EvaluationStatusEnum]
    evaluation_type_settings: Optional[EvaluationTypeSettings]


class EvaluationScenarioResult(BaseModel):
    evaluator_config: str
    result: Result


class EvaluationScenarioInput(BaseModel):
    name: str
    type: str
    value: Any


class EvaluationScenarioOutput(BaseModel):
    type: str
    value: Any


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class HumanEvaluation(BaseModel):
    id: str
    app_id: str
    user_id: str
    user_username: str
    evaluation_type: EvaluationType
    evaluation_type_settings: Optional[EvaluationTypeSettings]
    variant_ids: List[str]
    variant_names: List[str]
    testset_id: str
    testset_name: str
    status: str
    created_at: datetime
    updated_at: datetime


class HumanEvaluationScenario(BaseModel):
    id: Optional[str]
    evaluation_id: str
    inputs: List[HumanEvaluationScenarioInput]
    outputs: List[HumanEvaluationScenarioOutput]
    vote: Optional[str]
    score: Optional[Union[str, int]]
    evaluation: Optional[str]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]


class HumanEvaluationScenarioUpdate(BaseModel):
    vote: Optional[str]
    score: Optional[Union[str, int]]
    correct_answer: Optional[str]  # will be used when running custom code evaluation
    outputs: Optional[List[HumanEvaluationScenarioOutput]]
    inputs: Optional[List[HumanEvaluationScenarioInput]]
    is_pinned: Optional[bool]
    note: Optional[str]


class EvaluationScenario(BaseModel):
    id: Optional[str]
    evaluation_id: str
    inputs: List[EvaluationScenarioInput]
    outputs: List[EvaluationScenarioOutput]
    evaluation: Optional[str]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]
    results: List[EvaluationScenarioResult]


class AICritiqueCreate(BaseModel):
    correct_answer: str
    llm_app_prompt_template: Optional[str]
    inputs: List[EvaluationScenarioInput]
    outputs: List[EvaluationScenarioOutput]
    evaluation_prompt_template: Optional[str]
    open_ai_key: Optional[str]


class EvaluationScenarioUpdate(BaseModel):
    vote: Optional[str]
    score: Optional[Any]
    correct_answer: Optional[str]  # will be used when running custom code evaluation
    outputs: Optional[List[EvaluationScenarioOutput]]
    inputs: Optional[List[EvaluationScenarioInput]]
    is_pinned: Optional[bool]
    note: Optional[str]


class EvaluationScenarioScoreUpdate(BaseModel):
    score: float


class DeleteEvaluation(BaseModel):
    evaluations_ids: List[str]


class CreateCustomEvaluation(BaseModel):
    evaluation_name: str
    python_code: str
    app_id: str


class CustomEvaluationOutput(BaseModel):
    id: str
    app_id: str
    evaluation_name: str
    created_at: datetime


class CustomEvaluationDetail(BaseModel):
    id: str
    app_id: str
    evaluation_name: str
    python_code: str
    created_at: datetime
    updated_at: datetime


class CustomEvaluationNames(BaseModel):
    id: str
    evaluation_name: str


class ExecuteCustomEvaluationCode(BaseModel):
    inputs: List[Dict[str, Any]]
    app_id: str
    variant_id: str
    correct_answer: str
    outputs: List[Dict[str, Any]]


class EvaluationWebhook(BaseModel):
    score: float


class EvaluationSettingsTemplate(BaseModel):
    type: str
    default: str
    description: str


class NewEvaluation(BaseModel):
    app_id: str
    variant_ids: List[str]
    evaluators_configs: List[str]
    testset_id: str


class NewEvaluatorConfig(BaseModel):
    app_id: str
    name: str
    evaluator_key: str
    settings_values: dict


class UpdateEvaluatorConfig(BaseModel):
    name: Optional[str]
    evaluator_key: Optional[str]
    settings_values: Optional[dict]
