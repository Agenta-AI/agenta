from datetime import datetime
from typing import List, Optional, Dict, Any

from pydantic import BaseModel


class Span(BaseModel):
    span_id: str
    parent_span_id: Optional[str]
    meta: Optional[Dict[str, Any]]
    event_name: str
    event_type: Optional[str]
    start_time: datetime
    duration: Optional[int]
    status: str
    end_time: datetime
    inputs: Optional[List[str]]
    outputs: Optional[List[str]]
    prompt_template: Optional[str]
    tokens_input: Optional[int]
    tokens_output: Optional[int]
    token_total: Optional[int]
    cost: Optional[float]
    tags: Optional[List[str]]
    

class CreateFeedback(BaseModel):
    feedback: str
    trace_id: str
    score: Optional[float]
    
    
class Feedback(CreateFeedback):
    feedback_id: str
    created_at: Optional[datetime]
    
    
class UpdateFeedback(BaseModel):
    feedback:str
    score: Optional[float]
    
    
class Trace(BaseModel):
    trace_id: str
    app_name: Optional[str]
    variant_name: Optional[str]
    cost: Optional[float]
    latency: float
    status: str
    token_consumption: Optional[int]
    tags: Optional[List[str]]
    start_time: datetime
    end_time: datetime
    spans: Optional[List[Span]]
    
    
class CreateTrace(Trace):
    pass
    

class UpdateTrace(BaseModel):
    status: str


class SpanInputs(BaseModel):
    span_id: str
    inputs: List[str]
    
    
class SpanOutputs(BaseModel):
    span_id: str
    outputs: List[str]


class TraceInputs(BaseModel):
    trace_id: str
    inputs: List[SpanInputs]


class TraceOutputs(BaseModel):
    trace_id: str
    outputs: List[SpanOutputs]
    