from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import enum


class ConfigDB(BaseModel):
    config_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)


class Error(BaseModel):
    message: str
    stacktrace: Optional[str] = None


class Result(BaseModel):
    type: str
    value: Optional[Any] = None
    error: Optional[Error] = None


class InvokationResult(BaseModel):
    result: Result
    cost: Optional[float] = None
    latency: Optional[float] = None


class EvaluationScenarioResult(BaseModel):
    evaluator_config: str
    result: Result


class AggregatedResult(BaseModel):
    evaluator_config: str
    result: Result


class CorrectAnswer(BaseModel):
    key: str
    value: str


class EvaluationScenarioInput(BaseModel):
    name: str
    type: str
    value: str


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


class TemplateType(enum.Enum):
    IMAGE = "image"
    ZIP = "zip"


class AppType(str, enum.Enum):
    CHAT_PROMPT = "TEMPLATE:CONVERSATION:Simple_Chat"
    SINGLE_PROMPT = "TEMPLATE:GENERATION:Simple_Prompt"
    RAG = "TEMPLATE:CHAIN:RAG:Simple_RAG"
    CUSTOM = "CUSTOM"
