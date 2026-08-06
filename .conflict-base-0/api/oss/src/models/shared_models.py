import enum
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional


class OrganizationFlags(BaseModel):
    is_demo: bool = False


class OrganizationQueryFlags(BaseModel):
    is_demo: Optional[bool] = None


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
    tokens: Optional[float] = None
    latency: Optional[float] = None
    trace_id: Optional[str] = None
    span_id: Optional[str] = None


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
    value: Any


class EvaluationScenarioOutput(BaseModel):
    result: Result
    cost: Optional[float] = None
    latency: Optional[float] = None


class AppType(str, enum.Enum):
    CHAT_TEMPLATE = "TEMPLATE:simple_chat"
    COMPLETION_TEMPLATE = "TEMPLATE:simple_completion"
    CHAT_SERVICE = "SERVICE:chat"
    COMPLETION_SERVICE = "SERVICE:completion"
    CUSTOM = "CUSTOM"
    SDK_CUSTOM = "SDK_CUSTOM"

    @classmethod
    def friendly_tag(cls, app_type: str):
        mappings = {
            cls.CHAT_TEMPLATE: "chat (old)",
            cls.COMPLETION_TEMPLATE: "completion (old)",
            cls.CHAT_SERVICE: "chat",
            cls.COMPLETION_SERVICE: "completion",
            cls.CUSTOM: "custom",
            cls.SDK_CUSTOM: "custom (sdk)",
        }
        return mappings.get(app_type, None)  # type: ignore
