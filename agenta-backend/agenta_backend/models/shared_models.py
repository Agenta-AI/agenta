import enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, RootModel, Field


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


class EvaluationScenarioListResults(RootModel[List[EvaluationScenarioResult]]):
    # we are enforcing that the top-level structure of this model is a list, \
    # and each item must conform to the structure of EvaluationScenarioResult.
    # example: [{'evaluator_config': 1, 'result': {'type': 'string', 'value': 'string'}}, ...]
    pass


class AggregatedResult(BaseModel):
    evaluator_config: int
    result: Result


class AggregatedListResults(RootModel[List[AggregatedResult]]):
    # we are enforcing that the top-level structure of this model is a list, \
    # and each item must conform to the structure of AggregatedResult.
    # example: [{'evaluator_config': 1, 'result': {'type': 'string', 'value': 'string'}}, ...]
    pass


class CorrectAnswer(BaseModel):
    key: str
    value: str


class CorrectListAnswers(RootModel[List[CorrectAnswer]]):
    # we are enforcing that the top-level structure of this model is a list, \
    # and each item must conform to the structure of CorrectAnswer.
    # example: [{'key': 'key', 'value': 'value'}, ...]
    pass


class EvaluationScenarioInput(BaseModel):
    name: str
    type: str
    value: str


class EvaluationScenarioOutput(BaseModel):
    result: Result
    cost: Optional[float] = None
    latency: Optional[float] = None


class EvaluationScenarioListInputs(RootModel[List[EvaluationScenarioInput]]):
    # we are enforcing that the top-level structure of this model is a list, \
    # and each item must conform to the structure of EvaluationScenarioInput.
    # example: [{'name': 'name', 'type': 'value', 'value': 'value'}, ...]
    pass


class EvaluationScenarioListOutputs(RootModel[List[EvaluationScenarioOutput]]):
    # we are enforcing that the top-level structure of this model is a list, \
    # and each item must conform to the structure of EvaluationScenarioOutput.
    # example: [{'result': {'type': 'string', 'value': 'string'}, 'cost': 1 | None, 'latency': 1 | None}, ...]
    pass


class HumanEvaluationScenarioInput(BaseModel):
    input_name: str
    input_value: str


class HumanEvaluationScenarioOutput(BaseModel):
    variant_id: str
    variant_output: str


class HumanEvaluationScenarioListInputs(RootModel[List[HumanEvaluationScenarioInput]]):
    # we are enforcing that the top-level structure of this model is a list, \
    # and each item must conform to the structure of HumanEvaluationScenarioInput.
    # example: [{'input_name': 'name', 'input_value': 'value'}, ...]
    pass


class HumanEvaluationScenarioListOutputs(
    RootModel[List[HumanEvaluationScenarioOutput]]
):
    # we are enforcing that the top-level structure of this model is a list, \
    # and each item must conform to the structure of HumanEvaluationScenarioOutput.
    # example: [{'variant_id': 'id', 'variant_output': 'output'}, ...]
    pass


class TemplateType(enum.Enum):
    IMAGE = "image"
    ZIP = "zip"
