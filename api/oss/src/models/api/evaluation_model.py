from enum import Enum
from datetime import datetime
from typing import Optional, List, Dict, Any, Union

from pydantic import BaseModel, Field, model_validator, ConfigDict

from oss.src.utils import traces
from oss.src.models.api.api_models import Result


class LegacyEvaluator(BaseModel):
    name: str
    key: str
    direct_use: bool
    settings_presets: Optional[list[dict]] = None
    settings_template: dict
    outputs_schema: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    oss: Optional[bool] = False
    requires_llm_api_keys: Optional[bool] = False
    tags: List[str]
    archived: Optional[bool] = False


class EvaluatorConfig(BaseModel):
    id: str
    name: str
    project_id: str
    evaluator_key: str
    settings_values: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str


class EvaluationStatusEnum(str, Enum):
    EVALUATION_INITIALIZED = "EVALUATION_INITIALIZED"
    EVALUATION_STARTED = "EVALUATION_STARTED"
    EVALUATION_FINISHED = "EVALUATION_FINISHED"
    EVALUATION_FINISHED_WITH_ERRORS = "EVALUATION_FINISHED_WITH_ERRORS"
    EVALUATION_FAILED = "EVALUATION_FAILED"
    EVALUATION_AGGREGATION_FAILED = "EVALUATION_AGGREGATION_FAILED"


class AggregatedResult(BaseModel):
    evaluator_config: Union[EvaluatorConfig, Dict[str, Any]]
    result: Result


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

    model_config = ConfigDict(title="LegacyEvaluationScenario")


class EvaluationScenarioUpdate(BaseModel):
    vote: Optional[str] = None
    score: Optional[Any] = None
    # will be used when running custom code evaluation
    correct_answer: Optional[str] = None
    outputs: Optional[List[EvaluationScenarioOutput]] = None
    inputs: Optional[List[EvaluationScenarioInput]] = None
    is_pinned: Optional[bool] = None
    note: Optional[str] = None


class DeleteEvaluation(BaseModel):
    evaluations_ids: List[str]


class LLMRunRateLimit(BaseModel):
    batch_size: int
    max_retries: int
    retry_delay: int
    delay_between_batches: int


class LMProvidersEnum(str, Enum):
    openai = "OPENAI_API_KEY"
    mistral = "MISTRAL_API_KEY"
    mistralai = "MISTRALAI_API_KEY"
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
    name: Optional[str] = None
    revisions_ids: List[str]
    evaluator_ids: List[str]
    testset_revision_id: str
    rate_limit: LLMRunRateLimit
    correct_answer_column: Optional[str] = None


class NewEvaluatorConfig(BaseModel):
    name: str
    evaluator_key: str
    settings_values: dict


class UpdateEvaluatorConfig(BaseModel):
    name: Optional[str] = None
    evaluator_key: Optional[str] = None
    settings_values: Optional[dict] = None
