from datetime import datetime
from typing import List, Optional, Dict, Any, Union

from pydantic import BaseModel


class BaseSpan(BaseModel):
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


class CreateSpan(BaseSpan):
    pass


class Span(BaseSpan):
    span_id: str


class CreateFeedback(BaseModel):
    feedback: Optional[str]
    score: Optional[float]
    meta: Optional[Dict]


class Feedback(CreateFeedback):
    feedback_id: str
    created_at: Optional[datetime]


class UpdateFeedback(BaseModel):
    feedback: str
    score: Optional[float]
    meta: Optional[Dict]


class BaseTrace(BaseModel):
    app_name: Optional[str]
    variant_name: Optional[str]
    cost: Optional[float]
    latency: float
    status: str
    token_consumption: Optional[int]
    tags: Optional[List[str]]
    start_time: datetime
    end_time: datetime


class Trace(BaseTrace):
    trace_id: str
    spans: List[str]
    feedbacks: Optional[List[Feedback]]


class CreateTrace(BaseTrace):
    spans: List[str]


class UpdateTrace(BaseModel):
    status: str
