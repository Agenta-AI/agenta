from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict, Any


class AppVariant(BaseModel):
    app_name: str
    variant_name: str
    parameters: Optional[Dict[str, Any]]
    previous_variant_name: Optional[str]


class RestartAppContainer(BaseModel):
    app_name: str
    variant_name: str


class Image(BaseModel):
    docker_id: str
    tags: str


class ImageExtended(Image):
    # includes the mongodb image id
    id: str


class TemplateImageInfo(BaseModel):
    name: str
    size: int
    digest: str
    status: str
    architecture: str
    title: str
    description: str
    last_pushed: datetime
    repo_name: str
    media_type: str


class Template(BaseModel):
    id: int
    image: TemplateImageInfo


class URI(BaseModel):
    uri: str


class App(BaseModel):
    app_name: str


class DockerEnvVars(BaseModel):
    env_vars: Dict[str, str]


class CreateAppVariant(BaseModel):
    app_name: str
    image_id: str
    image_tag: str
    env_vars: Dict[str, str]


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
    