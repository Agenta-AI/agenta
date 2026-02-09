from typing import Any, Dict, List, Literal, Optional


from pydantic import BaseModel, ConfigDict, Field


TOOL_REFINE_PROMPT = "tools.agenta.api.refine_prompt"


class ToolDefinition(BaseModel):
    name: str
    title: str
    description: str
    inputSchema: Dict[str, Any]
    outputSchema: Dict[str, Any]


class AIServicesStatus(BaseModel):
    enabled: bool
    tools: List[ToolDefinition] = Field(default_factory=list)


class ToolCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


class ToolCallTextContent(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ToolCallMeta(BaseModel):
    trace_id: Optional[str] = None


class ToolCallResponse(BaseModel):
    content: List[ToolCallTextContent] = Field(default_factory=list)
    structuredContent: Optional[Dict[str, Any]] = None
    isError: bool = False
    meta: Optional[ToolCallMeta] = None


class RefinePromptArguments(BaseModel):
    prompt_template_json: str = Field(min_length=1, max_length=100_000)
    guidelines: Optional[str] = Field(default=None, max_length=10_000)
    context: Optional[str] = Field(default=None, max_length=10_000)

    model_config = ConfigDict(extra="forbid")
