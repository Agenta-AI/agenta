# This file was auto-generated by Fern from our API Definition.

from ..core.pydantic_utilities import UniversalBaseModel
import typing
from .evaluation_scenario_input import EvaluationScenarioInput
from .evaluation_scenario_output import EvaluationScenarioOutput
from .correct_answer import CorrectAnswer
from .evaluation_scenario_result import EvaluationScenarioResult
from ..core.pydantic_utilities import IS_PYDANTIC_V2
import pydantic


class EvaluationScenario(UniversalBaseModel):
    id: typing.Optional[str] = None
    evaluation_id: str
    inputs: typing.List[EvaluationScenarioInput]
    outputs: typing.List[EvaluationScenarioOutput]
    correct_answers: typing.Optional[typing.List[CorrectAnswer]] = None
    is_pinned: typing.Optional[bool] = None
    note: typing.Optional[str] = None
    results: typing.List[EvaluationScenarioResult]

    if IS_PYDANTIC_V2:
        model_config: typing.ClassVar[pydantic.ConfigDict] = pydantic.ConfigDict(
            extra="allow", frozen=True
        )  # type: ignore # Pydantic v2
    else:

        class Config:
            frozen = True
            smart_union = True
            extra = pydantic.Extra.allow