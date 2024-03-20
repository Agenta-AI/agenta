from enum import Enum
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union
from agenta_backend.models.api.api_models import Result


class Evaluator(BaseModel):
    name: str
    key: str
    direct_use: bool
    settings_template: dict
    description: Optional[str]


class EvaluatorConfig(BaseModel):
    id: str
    name: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class EvaluationType(str, Enum):
    human_a_b_testing = "human_a_b_testing"
    single_model_test = "single_model_test"


class EvaluationStatusEnum(str, Enum):
    EVALUATION_INITIALIZED = "EVALUATION_INITIALIZED"
    EVALUATION_STARTED = "EVALUATION_STARTED"
    EVALUATION_FINISHED = "EVALUATION_FINISHED"
    EVALUATION_FINISHED_WITH_ERRORS = "EVALUATION_FINISHED_WITH_ERRORS"
    EVALUATION_FAILED = "EVALUATION_FAILED"


class EvaluationScenarioStatusEnum(str, Enum):
    COMPARISON_RUN_STARTED = "COMPARISON_RUN_STARTED"


class AggregatedResult(BaseModel):
    evaluator_config: Union[EvaluatorConfig, Dict[str, Any]]
    result: Result


class NewHumanEvaluation(BaseModel):
    app_id: str
    variant_ids: List[str]
    evaluation_type: EvaluationType
    inputs: List[str]
    testset_id: str
    status: str


class AppOutput(BaseModel):
    output: Any
    status: str


class Evaluation(BaseModel):
    id: str
    app_id: str
    user_id: str
    user_username: str
    variant_ids: List[str]
    variant_names: List[str]
    variant_revision_ids: List[str]
    revisions: List[str]
    testset_id: Optional[str]
    testset_name: Optional[str]
    status: Result
    aggregated_results: List[AggregatedResult]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
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


class EvaluationScenarioResult(BaseModel):
    evaluator_config: str
    result: Result


class EvaluationScenarioInput(BaseModel):
    name: str
    type: str
    value: Any


class EvaluationScenarioOutput(BaseModel):
    result: Result


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
    evaluation_type: str
    variant_ids: List[str]
    variant_names: List[str]
    variants_revision_ids: List[str]
    revisions: List[str]  # the revision / version of each of the variants
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


class LLMRunRateLimit(BaseModel):
    batch_size: int
    max_retries: int
    retry_delay: int
    delay_between_batches: int


class LMProvidersEnum(str, Enum):
    openai = "OPENAI_API_KEY"
    replicate = "REPLICATE_API_KEY"
    cohere = "COHERE_API_KEY"
    hugging_face = "HUGGING_FACE_API_KEY"
    anthropic = "ANTHROPIC_API_KEY"
    azure_base = "AZURE_API_BASE"
    azure_key = "AZURE_API_KEY"
    togetherai = "TOGETHERAI_API_KEY"


class NewEvaluation(BaseModel):
    app_id: str
    variant_ids: List[str]
    evaluators_configs: List[str]
    testset_id: str
    rate_limit: LLMRunRateLimit
    lm_providers_keys: Optional[Dict[LMProvidersEnum, str]]
    correct_answer_column: Optional[str]


class RerunEvaluation(BaseModel):
    # rate_limit: LLMRunRateLimit
    lm_providers_keys: Optional[Dict[LMProvidersEnum, str]]
    # correct_answer_column: Optional[str]


class NewEvaluatorConfig(BaseModel):
    app_id: str
    name: str
    evaluator_key: str
    settings_values: dict


class UpdateEvaluatorConfig(BaseModel):
    name: Optional[str]
    evaluator_key: Optional[str]
    settings_values: Optional[dict]
