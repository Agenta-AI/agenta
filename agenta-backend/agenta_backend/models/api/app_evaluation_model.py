from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime


class ComparisonTable(BaseModel):
    id: str
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
    vote: str
    id: Optional[str]


class EvaluationRowUpdate(BaseModel):
    vote: str
    outputs: List[EvaluationRowOutput]


class NewComparisonTable(BaseModel):
    app_name: str
    variants: List[str]
    inputs: List[str]
    dataset: Dict[str, str] = Field(...)
    status: str = Field(...)


class DeleteComparisonTable(BaseModel):
    comparison_tables_ids: List[str]
