from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime
from enum import Enum

# ComparisonTableTypes = ["app_evaluation"]

class EvaluationType(str, Enum):
    auto_exact_match = "auto_exact_match"
    auto_ai_critique = "auto_ai_critique"
    human_a_b_testing = "human_a_b_testing"
    human_scoring = "human_scoring"

class ComparisonTable(BaseModel):
    id: str
    evaluation_type: EvaluationType
    variants: Optional[List[str]]
    app_name: str
    dataset: Dict[str, str] = Field(...)
    created_at: datetime
    updated_at: datetime


class EvaluationRowInput(BaseModel):
    input_name: str
    input_value: str


class EvaluationRowOutput(BaseModel):
    variant_name: str
    variant_output: str


class EvaluationRow(BaseModel):
    comparison_table_id: str
    inputs: List[EvaluationRowInput]
    outputs: List[EvaluationRowOutput]
    vote: Optional[str]
    score: Optional[str]
    correct_answer: Optional[str]
    id: Optional[str]


class EvaluationRowUpdate(BaseModel):
    vote: Optional[str]
    score: Optional[str]
    outputs: List[EvaluationRowOutput]


class NewComparisonTable(BaseModel):
    evaluation_type: EvaluationType
    app_name: str
    variants: List[str]
    inputs: List[str]
    dataset: Dict[str, str] = Field(...)
    status: str = Field(...)


class DeleteComparisonTable(BaseModel):
    comparison_tables_ids: List[str]
