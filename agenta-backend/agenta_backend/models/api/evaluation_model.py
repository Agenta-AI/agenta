from enum import Enum
from datetime import datetime
from typing import Optional, List, Dict, Any, Union

from pydantic import BaseModel, Field, model_validator, field_validator

from agenta_backend.utils import traces
from agenta_backend.models.api.api_models import Result


class Evaluator(BaseModel):
    name: str
    key: str
    direct_use: bool
    settings_template: dict
    description: Optional[str] = None
    oss: Optional[bool] = False
    requires_llm_api_keys: Optional[bool] = False
    tags: List[str]


class EvaluatorConfig(BaseModel):
    id: str
    name: str
    project_id: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str


class EvaluationType(str, Enum):
    human_a_b_testing = "human_a_b_testing"
    single_model_test = "single_model_test"


class EvaluationStatusEnum(str, Enum):
    EVALUATION_INITIALIZED = "EVALUATION_INITIALIZED"
    EVALUATION_STARTED = "EVALUATION_STARTED"
    EVALUATION_FINISHED = "EVALUATION_FINISHED"
    EVALUATION_FINISHED_WITH_ERRORS = "EVALUATION_FINISHED_WITH_ERRORS"
    EVALUATION_FAILED = "EVALUATION_FAILED"
    EVALUATION_AGGREGATION_FAILED = "EVALUATION_AGGREGATION_FAILED"


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
    project_id: str
    variant_ids: List[str]
    variant_names: List[str]
    variant_revision_ids: List[str]
    revisions: List[str]
    testset_id: Optional[str] = None
    testset_name: Optional[str] = None
    status: Result
    aggregated_results: List[AggregatedResult]
    average_cost: Optional[Result] = None
    total_cost: Optional[Result] = None
    average_latency: Optional[Result] = None
    created_at: datetime
    updated_at: datetime


class EvaluatorInputInterface(BaseModel):
    inputs: Dict[str, Any] = Field(default_factory=dict)
    settings: Optional[Dict[str, Any]] = None
    credentials: Optional[Dict[str, Any]] = None


class EvaluatorOutputInterface(BaseModel):
    outputs: Dict[str, Any]


class EvaluatorMappingInputInterface(BaseModel):
    inputs: Dict[str, Any]
    mapping: Dict[str, Any]

    @model_validator(mode="before")
    def remove_trace_prefix(cls, values: Dict) -> Dict:
        mapping = values.get("mapping", {})
        updated_mapping = traces.remove_trace_prefix(mapping_dict=mapping)

        # Set the modified mapping back to the values
        values["mapping"] = updated_mapping
        return values


class EvaluatorMappingOutputInterface(BaseModel):
    outputs: Dict[str, Any]


class SimpleEvaluationOutput(BaseModel):
    id: str
    variant_ids: List[str]
    app_id: str
    status: str
    evaluation_type: EvaluationType


class HumanEvaluationUpdate(BaseModel):
    status: Optional[EvaluationStatusEnum] = None


class EvaluationScenarioResult(BaseModel):
    evaluator_config: str
    result: Result


class EvaluationScenarioInput(BaseModel):
    name: str
    type: str
    value: Any


class EvaluationScenarioOutput(BaseModel):
    result: Result
    cost: Optional[float] = None
    latency: Optional[float] = None


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class HumanEvaluation(BaseModel):
    id: str
    app_id: str
    project_id: str
    evaluation_type: str
    variant_ids: List[str]
    variant_names: List[str]
    variants_revision_ids: List[str]
    revisions: List[str]  # the revision / version of each of the variants
    testset_id: str
    testset_name: str
    status: str
    created_at: str
    updated_at: str


class HumanEvaluationScenario(BaseModel):
    id: Optional[str] = None
    evaluation_id: str
    inputs: List[HumanEvaluationScenarioInput]
    outputs: List[HumanEvaluationScenarioOutput]
    vote: Optional[str] = None
    score: Optional[Union[str, int]] = None
    correct_answer: Optional[str] = None
    is_pinned: Optional[bool] = None
    note: Optional[str] = None


class HumanEvaluationScenarioUpdate(BaseModel):
    vote: Optional[str] = None
    score: Optional[Union[str, int]] = None
    # will be used when running custom code evaluation
    correct_answer: Optional[str] = None
    outputs: Optional[List[HumanEvaluationScenarioOutput]] = None
    inputs: Optional[List[HumanEvaluationScenarioInput]] = None
    is_pinned: Optional[bool] = None
    note: Optional[str] = None


class CorrectAnswer(BaseModel):
    key: str
    value: str


class EvaluationScenario(BaseModel):
    id: Optional[str] = None
    evaluation_id: str
    inputs: List[EvaluationScenarioInput]
    outputs: List[EvaluationScenarioOutput]
    correct_answers: Optional[List[CorrectAnswer]] = None
    is_pinned: Optional[bool] = None
    note: Optional[str] = None
    results: List[EvaluationScenarioResult]


class EvaluationScenarioUpdate(BaseModel):
    vote: Optional[str] = None
    score: Optional[Any] = None
    # will be used when running custom code evaluation
    correct_answer: Optional[str] = None
    outputs: Optional[List[EvaluationScenarioOutput]] = None
    inputs: Optional[List[EvaluationScenarioInput]] = None
    is_pinned: Optional[bool] = None
    note: Optional[str] = None


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
    mistral = "MISTRAL_API_KEY"
    cohere = "COHERE_API_KEY"
    anthropic = "ANTHROPIC_API_KEY"
    anyscale = "ANYSCALE_API_KEY"
    perplexityai = "PERPLEXITYAI_API_KEY"
    deepinfra = "DEEPINFRA_API_KEY"
    togetherai = "TOGETHERAI_API_KEY"
    alephalpha = "ALEPHALPHA_API_KEY"
    openrouter = "OPENROUTER_API_KEY"
    groq = "GROQ_API_KEY"
    gemini = "GEMINI_API_KEY"


class NewEvaluation(BaseModel):
    app_id: str
    variant_ids: List[str]
    evaluators_configs: List[str]
    testset_id: str
    rate_limit: LLMRunRateLimit
    lm_providers_keys: Optional[Dict[str, str]] = None
    correct_answer_column: Optional[str] = None

    @field_validator("lm_providers_keys", mode="after")
    def validate_lm_providers_keys(cls, value):
        if value is not None:
            return {LMProvidersEnum(key): v for key, v in value.items()}
        return value


class NewEvaluatorConfig(BaseModel):
    app_id: str
    name: str
    evaluator_key: str
    settings_values: dict


class UpdateEvaluatorConfig(BaseModel):
    name: Optional[str] = None
    evaluator_key: Optional[str] = None
    settings_values: Optional[dict]
