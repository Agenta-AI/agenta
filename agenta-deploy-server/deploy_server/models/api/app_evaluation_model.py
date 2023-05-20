from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class AppEvaluationsExperiment(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime

class AppEvaluationEntryInput(BaseModel):
    input_name: str
    input_value: str

class AppEvaluationEntryOutput(BaseModel):
    variant_name: str
    variant_output: str

class AppEvaluationEntry(BaseModel):
    app_evaluations_experiment_id: str
    inputs: List[AppEvaluationEntryInput]
    outputs: List[AppEvaluationEntryOutput]
    score: str
    id: Optional[str]

class AppEvaluationEntryUpdate(BaseModel):
    score: str

