from typing import Any, Dict, List, Literal, Optional


from pydantic import BaseModel, ConfigDict, Field


TOOL_REFINE_PROMPT = "tools.agenta.api.refine_prompt"


# ---------------------------------------------------------------------------
# Domain exceptions
# ---------------------------------------------------------------------------


class AIServicesError(Exception):
    """Base exception for AI services domain errors."""

    def __init__(
        self,
        message: str = "AI services error.",
        status_code: Optional[int] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AIServicesUpstreamError(AIServicesError):
    """Upstream call returned a non-2xx status."""

    def __init__(
        self,
        message: str = "Upstream service returned an error.",
        status_code: Optional[int] = None,
        detail: Any = None,
    ):
        super().__init__(message=message, status_code=status_code)
        self.detail = detail


class AIServicesTimeoutError(AIServicesError):
    """Upstream call timed out."""

    def __init__(self, message: str = "Upstream service timed out."):
        super().__init__(message=message, status_code=504)


class AIServicesConnectionError(AIServicesError):
    """Upstream call failed to connect or encountered a transport error."""

    def __init__(self, message: str = "Failed to connect to upstream service."):
        super().__init__(message=message, status_code=502)


class AIServicesUnknownToolError(AIServicesError):
    """Raised when a requested tool name is not recognized by the dispatcher."""

    def __init__(self, tool_name: str):
        super().__init__(message=f"Unknown tool: {tool_name}", status_code=400)
        self.tool_name = tool_name


# ---------------------------------------------------------------------------
# Client response DTO
# ---------------------------------------------------------------------------


class InvokeResponse(BaseModel):
    """Typed response from the AI services HTTP client."""

    data: Any = None
    trace_id: Optional[str] = None


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
