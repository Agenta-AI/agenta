from typing import List, Dict, Any
from pydantic import BaseModel


class EvaluationSettingsTemplate(BaseModel):
    type: str
    default: str
    description: str


class Evaluator(BaseModel):
    key: str
    settings_template: Dict[str, EvaluationSettingsTemplate]


class EvaluatorConfig:
    evaluator: Evaluator
    settings_value: Dict[str, Any]


class NewEvaluation(BaseModel):
    app_id: str
    variant_ids: List[str]
    evaluators_configs: List[EvaluatorConfig]
    testset_id: str
