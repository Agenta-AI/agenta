from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional


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
    evaluator_config: int
    result: Result

    class Config:
        arbitrary_types_allowed = True


class AggregatedResult(BaseModel):
    evaluator_config: int
    result: Result


class CorrectAnswer(BaseModel):
    key: str
    value: str


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str
