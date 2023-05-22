from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ComparisonTable(BaseModel):
    id: str
    variants: Optional[List[str]]
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
    vote: str
    id: Optional[str]


class EvaluationRowUpdate(BaseModel):
    vote: str


class ComparisonTableUpdate(BaseModel):
    variants: List[str]
