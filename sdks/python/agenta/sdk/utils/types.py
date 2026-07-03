import json
from copy import deepcopy
from dataclasses import dataclass
from enum import Enum
from typing import Annotated, ClassVar, List, Union, Optional, Dict, Literal, Any

from pydantic import ConfigDict, BaseModel, HttpUrl, RootModel
from pydantic import Field, model_validator, AliasChoices


from agenta.sdk.agents.dtos import HARNESS_IDENTITIES, SandboxPermission
from agenta.sdk.agents.mcp import MCPServerConfig
from agenta.sdk.agents.tools import ToolConfig
from agenta.sdk.agents.wire_models import run_contract_schemas
from agenta.sdk.utils.assets import supported_llm_models, model_metadata
from agenta.sdk.utils.helpers import _PLACEHOLDER_RE
from agenta.sdk.utils.rendering import (
    StructuredRenderingError,
    render_json_like,
    render_messages,
)
from agenta.sdk.utils.templating import UnresolvedVariablesError, render_template


class AgSchemaMixin(BaseModel):
    __ag_type__: ClassVar[Optional[str]] = None
    __ag_type_ref__: ClassVar[Optional[Union[str, Dict[str, Any]]]] = None

    @classmethod
    def ag_type(cls) -> str:
        if cls.__ag_type__ is None:
            raise ValueError(f"{cls.__name__} does not define __ag_type__")
        return cls.__ag_type__

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema, handler):
        schema = handler(core_schema)
        if cls.__ag_type__ is not None:
            schema["x-ag-type"] = cls.__ag_type__
        if cls.__ag_type_ref__ is not None:
            schema["x-ag-type-ref"] = deepcopy(cls.__ag_type_ref__)
        return schema


@dataclass
class MultipleChoice:
    choices: Union[List[str], Dict[str, List[str]]]


def MCField(  # pylint: disable=invalid-name
    default: str,
    choices: Union[List[str], Dict[str, List[str]]],
) -> Field:
    # Pydantic 2.12+ no longer allows post-creation mutation of field properties
    if isinstance(choices, dict):
        json_extra = {
            "choices": choices,
            "x-ag-type": "grouped_choice",
            "x-ag-metadata": model_metadata,
        }
    elif isinstance(choices, list):
        json_extra = {"choices": choices, "x-ag-type": "choice"}
    else:
        json_extra = {}

    return Field(
        default=default,
        description="ID of the model to use",
        json_schema_extra=json_extra,
    )


class LLMTokenUsage(BaseModel):
    completion_tokens: int
    prompt_tokens: int
    total_tokens: int


class DictInput(dict):
    def __new__(cls, default_keys: Optional[List[str]] = None):
        instance = super().__new__(cls, default_keys)
        if default_keys is None:
            default_keys = []
        instance.data = [key for key in default_keys]  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-ag-type": "dict"}


class TextParam(str):
    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-ag-type": "text", "type": "string"}


class BinaryParam(int):
    def __new__(cls, value: bool = False):
        instance = super().__new__(cls, int(value))
        instance.default = value  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {
            "x-ag-type": "bool",
            "type": "boolean",
        }


class IntParam(int):
    def __new__(cls, default: int = 6, minval: float = 1, maxval: float = 10):
        instance = super().__new__(cls, default)
        instance.minval = minval  # type: ignore
        instance.maxval = maxval  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-ag-type": "int", "type": "integer"}


class FloatParam(float):
    def __new__(cls, default: float = 0.5, minval: float = 0.0, maxval: float = 1.0):
        instance = super().__new__(cls, default)
        instance.default = default  # type: ignore
        instance.minval = minval  # type: ignore
        instance.maxval = maxval  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-ag-type": "float", "type": "number"}


class MultipleChoiceParam(str):
    def __new__(
        cls, default: Optional[str] = None, choices: Optional[List[str]] = None
    ):
        if default is not None and type(default) is list:
            raise ValueError(
                "The order of the parameters for MultipleChoiceParam is wrong! It's MultipleChoiceParam(default, choices) and not the opposite"
            )

        if not default and choices is not None:
            # if a default value is not provided,
            # set the first value in the choices list
            default = choices[0]

        if default is None and not choices:
            # raise error if no default value or choices is provided
            raise ValueError("You must provide either a default value or choices")

        instance = super().__new__(cls, default)
        instance.choices = choices  # type: ignore
        instance.default = default  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-ag-type": "choice", "type": "string", "enum": []}


class GroupedMultipleChoiceParam(str):
    def __new__(
        cls,
        default: Optional[str] = None,
        choices: Optional[Dict[str, List[str]]] = None,
    ):
        if choices is None:
            choices = {}
        if default and not any(
            default in choice_list for choice_list in choices.values()
        ):
            if not choices:
                print(
                    f"Warning: Default value {default} provided but choices are empty."
                )
            else:
                raise ValueError(
                    f"Default value {default} is not in the provided choices"
                )

        if not default:
            default_selected_choice = next(
                (choices for choices in choices.values()), None
            )
            if default_selected_choice:
                default = default_selected_choice[0]

        instance = super().__new__(cls, default)
        instance.choices = choices  # type: ignore
        instance.default = default  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {
            "x-ag-type": "grouped_choice",
            "type": "string",
        }


class FileInputURL(HttpUrl):
    def __new__(cls, url: str):
        instance = super().__new__(cls, url)
        instance.default = url  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-ag-type": "file_url", "type": "string"}


class Context(BaseModel):
    model_config = ConfigDict(extra="allow")

    def to_json(self):
        return self.model_dump()

    @classmethod
    def from_json(cls, json_str: str):
        data = json.loads(json_str)
        return cls(**data)


class ReferencesResponse(BaseModel):
    app_id: Optional[str] = None
    app_slug: Optional[str] = None
    variant_id: Optional[str] = None
    variant_slug: Optional[str] = None
    variant_version: Optional[int] = None
    environment_id: Optional[str] = None
    environment_slug: Optional[str] = None
    environment_version: Optional[int] = None

    def __str__(self):
        return str(self.model_dump(exclude_none=True))


class LifecyclesResponse(ReferencesResponse):
    committed_at: Optional[str] = None
    committed_by: Optional[str] = None
    committed_by_id: Optional[str] = None
    deployed_at: Optional[str] = None
    deployed_by: Optional[str] = None
    deployed_by_id: Optional[str] = None

    def __str__(self):
        return self.model_dump_json(indent=4)

    def __repr__(self):
        return self.__str__()


class ConfigurationResponse(LifecyclesResponse):
    params: Dict[str, Any]


class DeploymentResponse(LifecyclesResponse):
    pass


class Prompt(BaseModel):
    temperature: float
    model: str
    max_tokens: int
    prompt_system: str
    prompt_user: str
    top_p: float
    frequency_penalty: float
    presence_penalty: float


# -----------------------------------------------------
# New Prompt model
# -----------------------------------------------------


class ToolFunction(BaseModel):
    name: str
    arguments: str  # JSON string


class ToolCall(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: ToolFunction


class ImageURL(BaseModel):
    url: str
    detail: Optional[Literal["auto", "low", "high"]] = None


class ContentPartText(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ContentPartImage(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: ImageURL


class FileInput(BaseModel):
    file_id: Optional[str] = Field(
        default=None,
        alias="file_id",
        validation_alias=AliasChoices("file_id", "fileId"),
    )
    file_data: Optional[str] = Field(
        default=None,
        alias="file_data",
        validation_alias=AliasChoices("file_data", "fileData"),
    )
    file_url: Optional[str] = Field(
        default=None,
        alias="file_url",
        validation_alias=AliasChoices("file_url", "fileUrl"),
    )
    file_name: Optional[str] = Field(
        default=None,
        alias="file_name",
        validation_alias=AliasChoices("file_name", "fileName", "filename"),
    )

    format: Optional[str] = None

    mime_type: Optional[str] = None

    model_config = {"populate_by_name": True}


class ContentPartFile(BaseModel):
    type: Literal["file"] = "file"
    file: FileInput


ContentPart = Annotated[
    Union[
        ContentPartText,
        ContentPartImage,
        ContentPartFile,
    ],
    Field(discriminator="type"),
]


class Message(AgSchemaMixin):
    __ag_type__ = "message"

    role: Literal["developer", "system", "user", "assistant", "tool", "function"]
    content: Optional[Union[str, List[ContentPart]]] = None
    name: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    tool_call_id: Optional[str] = None


class Messages(AgSchemaMixin, RootModel[List[Message]]):
    __ag_type__ = "messages"

    root: List[Message] = Field(default_factory=list)

    def __iter__(self):
        return iter(self.root)

    def __len__(self):
        return len(self.root)

    def __getitem__(self, item):
        return self.root[item]


class ResponseFormatText(BaseModel):
    type: Literal["text"]
    """The type of response format being defined: `text`"""


class ResponseFormatJSONObject(BaseModel):
    type: Literal["json_object"]
    """The type of response format being defined: `json_object`"""


class JSONSchema(BaseModel):
    name: str
    """The name of the response format."""
    description: Optional[str] = None
    """A description of what the response format is for."""
    schema_: Optional[Dict[str, object]] = Field(alias="schema", default=None)
    """The schema for the response format, described as a JSON Schema object."""
    strict: Optional[bool] = None
    """Whether to enable strict schema adherence."""

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {"required": ["name", "schema"]},
    }


class ResponseFormatJSONSchema(BaseModel):
    type: Literal["json_schema"]
    """The type of response format being defined: `json_schema`"""
    json_schema: JSONSchema


ResponseFormat = Union[
    ResponseFormatText, ResponseFormatJSONObject, ResponseFormatJSONSchema
]


class ModelConfig(BaseModel):
    """Configuration for model parameters"""

    model: str = Field(
        default="gpt-4o-mini",
        description="Model identifier to use for execution.",
        json_schema_extra={"x-ag-type-ref": "model"},
    )

    temperature: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=2.0,
        description="What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic",
    )
    max_tokens: Optional[int] = Field(
        default=None,
        ge=0,
        le=64000,
        description="The maximum number of tokens that can be generated in the chat completion",
    )
    top_p: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass",
    )
    frequency_penalty: Optional[float] = Field(
        default=None,
        ge=-2.0,
        le=2.0,
        description="Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far",
    )
    presence_penalty: Optional[float] = Field(
        default=None,
        ge=-2.0,
        le=2.0,
        description="Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far",
    )
    reasoning_effort: Optional[Literal["none", "low", "medium", "high"]] = Field(
        default=None,
        description="Controls the reasoning effort for thinking models. Options: 'none' (cost-optimized, 0 tokens), 'low' (1024 tokens), 'medium' (2048 tokens), 'high' (4096 tokens)",
        json_schema_extra={
            "x-ag-type": "choice",
            "enum": ["none", "low", "medium", "high"],
        },
    )
    chat_template_kwargs: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Provider-specific chat template options passed through unchanged.",
    )
    response_format: Optional[ResponseFormat] = Field(
        default=None,
        description="An object specifying the format that the model must output",
    )
    stream: Optional[bool] = Field(
        default=None, description="If set, partial message deltas will be sent"
    )
    tools: Optional[List[Dict]] = Field(
        default=None,
        description="A list of tools the model may call. Currently, only functions are supported as a tool",
    )
    tool_choice: Optional[Union[Literal["none", "auto"], Dict]] = Field(
        default=None, description="Controls which (if any) tool is called by the model"
    )


class PromptTemplateError(Exception):
    """Base exception for all PromptTemplate errors"""

    pass


class InputValidationError(PromptTemplateError):
    """Raised when input validation fails"""

    def __init__(
        self, message: str, missing: Optional[set] = None, extra: Optional[set] = None
    ):
        self.missing = missing
        self.extra = extra
        super().__init__(message)


class TemplateFormatError(PromptTemplateError):
    """Raised when template formatting fails"""

    def __init__(self, message: str, error: Optional[Exception] = None):
        self.error = error
        super().__init__(message)


from typing import Iterable, Tuple  # noqa: E402

from agenta.sdk.utils.lazy import _load_jinja2, _load_jsonpath  # noqa: E402

# Resolvers live in utils/resolvers.py (API-side code imports them without
# pulling in the full agenta init chain). Re-exported here so existing
# callers of agenta.sdk.utils.types keep working.
from agenta.sdk.utils.resolvers import (  # noqa: E402, F401
    detect_scheme,
    resolve_dot_notation,
    resolve_json_path,
    resolve_json_pointer,
    resolve_json_selector,
    resolve_any,
)


# ========= Placeholder & coercion helpers =========


def extract_placeholders(template: str) -> Iterable[str]:
    """Yield the inner text of all {{ ... }} occurrences (trimmed)."""
    for m in _PLACEHOLDER_RE.finditer(template):
        yield m.group(1).strip()


def coerce_to_str(value: Any) -> str:
    """Pretty stringify values for embedding into templates."""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def build_replacements(
    placeholders: Iterable[str], data: Dict[str, Any]
) -> Tuple[Dict[str, str], set]:
    """
    Resolve all placeholders against data.
    Returns (replacements, unresolved_placeholders).
    """
    replacements: Dict[str, str] = {}
    unresolved: set = set()
    for expr in set(placeholders):
        try:
            val = resolve_any(expr, data)
            # Escape backslashes to avoid regex replacement surprises
            replacements[expr] = coerce_to_str(val).replace("\\", "\\\\")
        except Exception:
            unresolved.add(expr)
    return replacements, unresolved


def missing_lib_hints(unreplaced: set) -> Optional[str]:
    """Suggest installing python-jsonpath if placeholders indicate json-path or json-pointer usage."""
    if any(expr.startswith("$") or expr.startswith("/") for expr in unreplaced):
        json_path, json_pointer = _load_jsonpath()
        if json_path is None or json_pointer is None:
            return "Install python-jsonpath to enable json-path ($...) and json-pointer (/...)"
    return None


class AgLLM(AgSchemaMixin):
    __ag_type__ = "llm"

    model: str = Field(
        default="gpt-4o-mini",
        description="Model identifier to use for execution.",
        json_schema_extra={"x-ag-type-ref": "model"},
    )
    temperature: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=2.0,
    )
    max_tokens: Optional[int] = Field(
        default=None,
        ge=0,
    )
    top_p: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )
    frequency_penalty: Optional[float] = Field(
        default=None,
        ge=-2.0,
        le=2.0,
    )
    presence_penalty: Optional[float] = Field(
        default=None,
        ge=-2.0,
        le=2.0,
    )
    reasoning_effort: Optional[Literal["none", "low", "medium", "high"]] = Field(
        default=None,
        json_schema_extra={"x-ag-type": "choice"},
    )
    chat_template_kwargs: Optional[Dict[str, Any]] = Field(default=None)
    tool_choice: Optional[Union[Literal["none", "auto"], Dict]] = Field(
        default=None,
    )
    template_format: Literal["mustache", "curly", "fstring", "jinja2"] = Field(
        default="curly",
    )


class AgLLMs(AgSchemaMixin, RootModel[List[AgLLM]]):
    __ag_type__ = "llms"

    root: List[AgLLM] = Field(default_factory=list)

    def __iter__(self):
        return iter(self.root)

    def __len__(self):
        return len(self.root)

    def __getitem__(self, item):
        return self.root[item]


class RetryPolicy(str, Enum):
    OFF = "off"
    AVAILABILITY = "availability"
    CAPACITY = "capacity"
    TRANSIENT = "transient"
    ANY = "any"


class RetryConfig(BaseModel):
    max_retries: Optional[int] = Field(default=None, ge=0, le=5)
    base_delay: Optional[int] = Field(default=None, ge=100, le=1000)


class FallbackPolicy(str, Enum):
    OFF = "off"
    AVAILABILITY = "availability"
    CAPACITY = "capacity"
    ACCESS = "access"
    CONTEXT = "context"
    ANY = "any"


class AgLoop(AgSchemaMixin):
    __ag_type__ = "loop"

    max_iterations: Optional[int] = Field(default=None, ge=1)
    max_internal_tool_calls: Optional[int] = Field(default=None, ge=0)
    max_consecutive_errors: Optional[int] = Field(default=None, ge=0)
    allow_implicit_stop: Optional[bool] = None
    require_terminate_tool: Optional[bool] = None


class AgTool(AgSchemaMixin):
    __ag_type__ = "tool"

    name: str
    type: Literal["internal", "external"] = "internal"
    definition: Optional[Dict[str, Any]] = Field(
        default=None,
        description="OpenAI-compatible tool definition. Required for external tools.",
    )


class AgTools(AgSchemaMixin):
    __ag_type__ = "tools"

    internal: Optional[List[str]] = None
    external: Optional[List[Dict[str, Any]]] = None


class AgContext(AgSchemaMixin):
    __ag_type__ = "context"

    model_config = ConfigDict(extra="allow")


class AgPermissions(AgSchemaMixin):
    __ag_type__ = "permissions"

    model_config = ConfigDict(extra="allow")


class AgResponse(AgSchemaMixin):
    __ag_type__ = "response"

    stream: Optional[bool] = Field(default=False)
    format: Optional[Literal["messages", "message", "text", "json"]] = Field(
        default="messages",
    )
    schema_: Optional[Dict[str, Any]] = Field(default=None, alias="schema")

    model_config = ConfigDict(populate_by_name=True)


class PromptTemplate(AgSchemaMixin):
    __ag_type__ = "prompt-template"

    """A template for generating prompts with formatting capabilities"""

    messages: Messages = Field(
        default_factory=lambda: Messages(
            [Message(role="system", content=""), Message(role="user", content="")]
        )
    )
    template_format: Literal["mustache", "fstring", "jinja2", "curly"] = Field(
        default="curly",
        description="Format type for template variables: mustache {{var}}, fstring {var}, jinja2 {{ var }}, or curly {{var}}. This model defaults to `curly` for legacy compatibility; app-creation flows and engine interfaces set `mustache` explicitly for new apps.",
    )
    input_keys: Optional[List[str]] = Field(
        default=None,
        description="Optional list of input keys for validation. If not provided, any inputs will be accepted",
    )
    llm_config: ModelConfig = Field(
        default_factory=ModelConfig,
        description="Configuration for the model parameters",
    )
    fallback_configs: Optional[List[ModelConfig]] = Field(
        default=None,
        description="Ordered fallback LLM configs. Runtime default is no fallback configs.",
    )
    fallback_policy: Optional[FallbackPolicy] = Field(
        default=None,
        description="Controls which provider-call errors can move execution to the next fallback config.",
        json_schema_extra={
            "x-ag-type": "choice",
            "enum": ["off", "availability", "capacity", "access", "context", "any"],
            "x-ag-metadata": {
                "off": {
                    "description": "disable fallbacks",
                },
                "availability": {
                    "description": "fall back on provider-side issues (or 5xx)",
                },
                "capacity": {
                    "description": "availability + fall back on rate/quota limits (or 429)",
                },
                "access": {
                    "description": "capacity + fall back on auth errors (or 401/403)",
                },
                "context": {
                    "description": "access + fall back on context-window errors",
                },
                "any": {
                    "description": "context + fall back on any provider-call error (or 4xx)",
                },
            },
        },
    )
    retry_config: Optional[RetryConfig] = Field(
        default=None,
        description="Retry count and delay applied to each attempted LLM config.",
    )
    retry_policy: Optional[RetryPolicy] = Field(
        default=None,
        description="Controls which errors can retry the same LLM config.",
        json_schema_extra={
            "x-ag-type": "choice",
            "enum": ["off", "availability", "capacity", "transient", "any"],
            "x-ag-metadata": {
                "off": {
                    "description": "disable retries",
                },
                "availability": {
                    "description": "retry provider-side availability issues (or 5xx)",
                },
                "capacity": {
                    "description": "availability + retry rate/capacity limits (or 429)",
                },
                "transient": {
                    "description": "capacity + retry temporary upstream/resource errors",
                },
                "any": {
                    "description": "retry any provider-call error",
                },
            },
        },
    )

    @model_validator(mode="before")
    def init_messages(cls, values):
        if not isinstance(values, dict):
            return values
        if "messages" not in values:
            messages = []
            if "system_prompt" in values and values["system_prompt"]:
                messages.append(Message(role="system", content=values["system_prompt"]))
            if "user_prompt" in values and values["user_prompt"]:
                messages.append(Message(role="user", content=values["user_prompt"]))
            if messages:
                values["messages"] = messages
        return values

    def _format_with_template(self, content: str, kwargs: Dict[str, Any]) -> str:
        """Format content via the shared rendering helper.

        Preserves the chat/completion contract: rendering failures (missing
        variables, Jinja errors, unsupported formats) raise ``TemplateFormatError``
        with stable, caller-facing messages.
        """

        if self.template_format not in ("mustache", "curly", "fstring", "jinja2"):
            raise TemplateFormatError(
                f"Unknown template format: {self.template_format}"
            )

        try:
            return render_template(
                template=content,
                mode=self.template_format,
                context=kwargs,
            )
        except UnresolvedVariablesError as e:
            suffix = f" Hint: {e.hint}" if e.hint else ""
            raise TemplateFormatError(
                f"Unreplaced variables in {self.template_format} template: "
                f"{sorted(e.unresolved)}.{suffix}"
            )
        except KeyError as e:
            key = str(e).strip("'")
            raise TemplateFormatError(
                f"Missing required variable '{key}' in template: '{content}'"
            )
        except Exception as e:
            try:
                _, TemplateError = _load_jinja2()
            except ImportError:
                TemplateError = None
            if TemplateError is not None and isinstance(e, TemplateError):
                raise TemplateFormatError(
                    f"Jinja2 template error in content: '{content}'. Error: {str(e)}",
                    error=e,
                )
            raise TemplateFormatError(
                f"Error formatting template '{content}': {str(e)}",
                error=e,
            )

    def _template_error_from_structured_error(
        self,
        error: Exception,
    ) -> TemplateFormatError:
        """Convert structured renderer failures to the public prompt error type.

        ``PromptTemplate`` has long exposed ``TemplateFormatError`` with specific
        messages for missing variables and Jinja failures. The structured
        renderer reports better locations, but this class still owns the legacy
        error contract.
        """

        if not isinstance(error, StructuredRenderingError):
            return TemplateFormatError(str(error), error=error)

        renderer_error = error.error
        template = error.template or ""

        if isinstance(renderer_error, UnresolvedVariablesError):
            suffix = f" Hint: {renderer_error.hint}" if renderer_error.hint else ""
            return TemplateFormatError(
                f"Unreplaced variables in {self.template_format} template: "
                f"{sorted(renderer_error.unresolved)}.{suffix}",
                error=renderer_error,
            )

        if isinstance(renderer_error, KeyError):
            key = str(renderer_error).strip("'")
            return TemplateFormatError(
                f"Missing required variable '{key}' in template: '{template}'",
                error=renderer_error,
            )

        try:
            _, TemplateError = _load_jinja2()
        except ImportError:
            TemplateError = None
        if TemplateError is not None and isinstance(renderer_error, TemplateError):
            return TemplateFormatError(
                f"Jinja2 template error in content: '{template}'. "
                f"Error: {str(renderer_error)}",
                error=renderer_error,
            )

        return TemplateFormatError(
            f"Error formatting template '{template}': {str(error)}",
            error=renderer_error or error,
        )

    def _substitute_variables(self, obj: Any, kwargs: Dict[str, Any]) -> Any:
        """Render template strings inside response-format configuration.

        Response-format schemas may contain placeholders in keys and values.
        This helper renders both while preserving non-string leaves.
        """
        try:
            return render_json_like(
                json_like=obj,
                mode=self.template_format,
                context=kwargs,
                location="llm_config.response_format",
            )
        except Exception as e:
            raise self._template_error_from_structured_error(e) from e

    def format(self, **kwargs) -> "PromptTemplate":
        """
        Format the template with provided inputs.
        Only validates against input_keys if they are specified.

        Raises:
            InputValidationError: If input validation fails
            TemplateFormatError: If template formatting fails
        """
        # Validate inputs if input_keys is set
        if self.input_keys is not None:
            missing = set(self.input_keys) - set(kwargs.keys())
            extra = set(kwargs.keys()) - set(self.input_keys)

            error_parts = []
            if missing:
                error_parts.append(
                    f"Missing required inputs: {', '.join(sorted(missing))}"
                )
            if extra:
                error_parts.append(f"Unexpected inputs: {', '.join(sorted(extra))}")

            if error_parts:
                raise InputValidationError(
                    " | ".join(error_parts),
                    missing=missing if missing else None,
                    extra=extra if extra else None,
                )

        try:
            new_messages = render_messages(
                messages=list(self.messages),
                mode=self.template_format,
                context=kwargs,
            )
        except Exception as e:
            template_error = self._template_error_from_structured_error(e)
            raise TemplateFormatError(
                f"Error in {getattr(e, 'location', 'messages')}: {str(template_error)}",
                error=template_error.error,
            ) from e

        new_llm_config = self._format_llm_config(self.llm_config, kwargs)
        new_fallback_configs = None
        if self.fallback_configs is not None:
            new_fallback_configs = [
                self._format_llm_config(fallback_config, kwargs)
                for fallback_config in self.fallback_configs
            ]

        return PromptTemplate(
            messages=new_messages,
            template_format=self.template_format,
            llm_config=new_llm_config,
            fallback_configs=new_fallback_configs,
            retry_policy=self.retry_policy,
            retry_config=self.retry_config,
            fallback_policy=self.fallback_policy,
            input_keys=self.input_keys,
        )

    def _format_llm_config(
        self, llm_config: ModelConfig, kwargs: Dict[str, Any]
    ) -> ModelConfig:
        new_llm_config = llm_config.model_copy(deep=True)
        if new_llm_config.response_format is not None:
            rf_dict = new_llm_config.response_format.model_dump(by_alias=True)
            substituted = self._substitute_variables(rf_dict, kwargs)
            rf_type = type(new_llm_config.response_format)
            new_llm_config.response_format = rf_type(**substituted)
        return new_llm_config

    def to_openai_kwargs(self, llm_config: Optional[ModelConfig] = None) -> dict:
        """Convert the prompt template to kwargs compatible with litellm/openai."""
        llm_config = llm_config or self.llm_config
        kwargs = {
            "messages": [msg.model_dump(exclude_none=True) for msg in self.messages],
        }

        # Add optional parameters only if they are set
        if llm_config.model is not None:
            kwargs["model"] = llm_config.model

        if llm_config.temperature is not None:
            kwargs["temperature"] = llm_config.temperature

        if llm_config.top_p is not None:
            kwargs["top_p"] = llm_config.top_p

        if llm_config.stream is not None:
            kwargs["stream"] = llm_config.stream

        if llm_config.max_tokens is not None:
            kwargs["max_tokens"] = llm_config.max_tokens

        if llm_config.frequency_penalty is not None:
            kwargs["frequency_penalty"] = llm_config.frequency_penalty

        if llm_config.presence_penalty is not None:
            kwargs["presence_penalty"] = llm_config.presence_penalty

        if llm_config.reasoning_effort is not None:
            kwargs["reasoning_effort"] = llm_config.reasoning_effort

        if llm_config.chat_template_kwargs is not None:
            kwargs["chat_template_kwargs"] = llm_config.chat_template_kwargs

        if llm_config.response_format:
            kwargs["response_format"] = llm_config.response_format.dict(by_alias=True)

        if llm_config.tools:
            kwargs["tools"] = llm_config.tools
            # Only set tool_choice if tools are present
            if llm_config.tool_choice is not None:
                kwargs["tool_choice"] = llm_config.tool_choice

        return kwargs


def _dereference_schema(schema: dict) -> dict:
    defs = schema.get("$defs", {})
    if not defs:
        return schema

    def _resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref_path = node["$ref"]
                ref_name = ref_path.rsplit("/", 1)[-1]
                resolved = defs.get(ref_name, node)
                return _resolve(resolved)
            return {k: _resolve(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [_resolve(item) for item in node]
        return node

    return _resolve(schema)


def _model_catalog_type() -> dict:
    return {
        "type": "string",
        "title": "Model",
        "description": "Model identifier to use for execution.",
        "default": "gpt-4o-mini",
        "choices": deepcopy(supported_llm_models),
        "x-ag-type": "grouped_choice",
        "x-ag-metadata": deepcopy(model_metadata),
    }


_DEFAULT_AGENT_MODEL = "gpt-5.5"
_DEFAULT_AGENTS_MD = (
    "You are a friendly hello-world agent running on the Agenta agent service.\n\n"
    "- Greet the user warmly.\n"
    "- Answer the user's message in one or two short sentences."
)

# The single source of the run-selection defaults. The SDK builtin interface
# (`agenta:builtin:agent:v0`) and the agent service (`AGENT_SCHEMAS` / the value
# `AgentTemplate.from_params` falls back to) both consume these via `build_agent_v0_default`, so a new
# default changes one place. The harness default also seeds `AgentTemplateSchema.harness`.
_DEFAULT_HARNESS = "pi_core"
_DEFAULT_SANDBOX = "local"
_DEFAULT_PERMISSION_POLICY = "auto"


def _default_agent_provider() -> str:
    """The provider for `_DEFAULT_AGENT_MODEL`, from `_DEFAULT_HARNESS`'s reachable set.

    The credential resolver has no model-id->provider table, so a bare default model fails loud
    (F-017). Deriving from the same capability table the picker uses keeps the shipped default
    runnable and the harness/provider defaults from drifting apart.
    """
    from agenta.sdk.agents.capabilities import HARNESS_CONNECTION_CAPABILITIES

    caps = HARNESS_CONNECTION_CAPABILITIES.get(_DEFAULT_HARNESS)
    if caps and caps.providers:
        return "openai" if "openai" in caps.providers else caps.providers[0]
    return "openai"


_DEFAULT_AGENT_PROVIDER = _default_agent_provider()

# The schema key carrying each harness option's versioned slug identity (the contract identity in
# the repo's `agenta:...:v0` grammar). Specific to the harness rather than a generic `x-ag-slug`.
_HARNESS_SLUG_KEY = "x-ag-harness-slug"


def _harness_field_schema_extra() -> Dict[str, Any]:
    """Build the harness field's JSON-Schema extras from the single ``HARNESS_IDENTITIES`` source.

    Carries BOTH a flat ``enum`` of the bare values (so every existing consumer that reads
    ``schema.enum`` keeps working) and a ``oneOf`` of ``{const, title, x-ag-harness-slug}`` (so the
    playground shows the display name and the harness's versioned slug identity rides alongside its
    bare value). The stored/wire harness value is still the bare ``const`` string.

    ``x-ag-harness-ref`` declares that this field's value selects a record in the ``harnesses``
    catalog (``GET /catalog/harnesses/{value}``), where its capabilities live — the same
    catalog/ref mechanism as ``x-ag-type-ref`` -> ``/catalog/types/``. The frontend resolves it
    to drive the harness-filtered provider/model picker, instead of reading an inlined inspect
    ``meta`` field."""
    return {
        "enum": [identity.value for identity in HARNESS_IDENTITIES],
        "oneOf": [
            {
                "const": identity.value,
                "title": identity.name,
                _HARNESS_SLUG_KEY: identity.slug,
            }
            for identity in HARNESS_IDENTITIES
        ],
        "x-ag-harness-ref": "harness",
    }


# ---------------------------------------------------------------------------
# Agent template — nested authoring shape (Step 1 of the agent-template migration)
# ---------------------------------------------------------------------------
#
# The template is one object (the `agent-template` catalog type) sitting at `parameters.agent`,
# like the prompt template at `parameters.prompt`. The portable definition is flat on it
# (instructions/llm/tools/mcps/skills); `harness`/`runner`/`sandbox` are nested sub-objects (the
# execution parts). Each execution section names only the keys common to every kind and parks
# kind-specific knobs under an untyped `extras` bag; where a section carries a security/approval
# posture it is a first-class `permissions` key. See big-agents-audit/agent-template-migration.md.


class _ConnectionSchema(BaseModel):
    """The model credential connection (the existing ``ModelRef.connection``)."""

    model_config = ConfigDict(extra="forbid", title="Connection")

    mode: Literal["agenta", "self_managed"] = Field(
        default="agenta",
        title="Mode",
        description="agenta (a vault connection) or self_managed (the harness owns auth).",
    )
    slug: Optional[str] = Field(
        default=None,
        title="Slug",
        description="The named vault connection (agenta mode only); omit for the project default.",
    )


class _LlmSchema(BaseModel):
    """The agent's model selection (was the flat ``model`` string or ``ModelRef``).

    ``model`` stays a plain string (``"provider/model"`` parses). ``provider`` / ``connection``
    carry the structured intent when authored; ``extras`` is the neutral knobs bag (was
    ``ModelRef.params``)."""

    model_config = ConfigDict(extra="forbid", title="Model")

    model: str = Field(
        default=_DEFAULT_AGENT_MODEL,
        title="Model",
        description="Model the agent runs on.",
        json_schema_extra={"x-parameter": "grouped_choice"},
    )
    provider: Optional[str] = Field(
        default=None,
        title="Provider",
        description="Model provider (e.g. openai); inferred from the model string when unset.",
    )
    connection: Optional[_ConnectionSchema] = Field(
        default=None,
        title="Connection",
        description="Where the model credential comes from. Omit for the project default.",
    )
    extras: Dict[str, Any] = Field(
        default_factory=dict,
        title="Extras",
        description="Neutral model knobs passed through unchanged (e.g. reasoning_effort).",
    )


class _InstructionsSchema(BaseModel):
    """The agent's instruction documents. ``agents_md`` is the one cross-harness instruction
    file (becomes the harness ``AGENTS.md``); the object wraps it so later instruction kinds
    have a home."""

    model_config = ConfigDict(extra="forbid", title="Instructions")

    agents_md: str = Field(
        default=_DEFAULT_AGENTS_MD,
        title="Instructions",
        description="The agent's system prompt (its AGENTS.md).",
        json_schema_extra={"x-ag-type": "textarea"},
    )


class AgentTemplateSchema(AgSchemaMixin):
    """The agent template (the ``parameters.agent`` value), as one semantic type.

    The ``agent-template`` catalog type the playground's composite ``AgentTemplateControl`` renders,
    sitting at ``parameters.agent`` exactly as ``prompt-template`` sits at ``parameters.prompt``.
    The portable definition (``instructions`` / ``llm`` / ``tools`` / ``mcps`` / ``skills``) is flat
    on the template; the execution parts are nested sub-objects (``harness`` / ``runner`` /
    ``sandbox``, each: named common keys plus an untyped ``extras`` bag, with ``permissions``
    first-class where a security posture exists). See
    ``big-agents-audit/agent-template-migration.md``. Splitting the execution parts into their own
    sibling catalog types is a later step. ``tools`` / ``mcps`` are typed with the real tool-def
    models so the playground gets typed editors; the runtime ``AgentTemplate`` stays permissive
    (it coerces the loose shapes the playground emits) while this model is strict to describe them."""

    model_config = ConfigDict(extra="forbid")

    __ag_type__ = "agent-template"

    instructions: _InstructionsSchema = Field(
        default_factory=_InstructionsSchema,
        title="Instructions",
        description="The agent's instruction documents (its AGENTS.md).",
    )
    llm: _LlmSchema = Field(
        default_factory=_LlmSchema,
        title="Model",
        description="The model the agent runs on, with its provider and credential connection.",
    )
    tools: List[Union[ToolConfig, "_ToolEmbedRefSchema"]] = Field(
        default_factory=list,
        title="Tools",
        description=(
            "Runnable tools the agent can call: harness built-ins, server-side gateway "
            "actions (e.g. Composio), sandboxed code, client-fulfilled tools, or a workflow "
            "referenced as a tool (a type:'reference' entry the Agenta service runs server-side "
            "as a callback tool). A workflow value can also be inlined via @ag.embed."
        ),
    )
    mcps: List[MCPServerConfig] = Field(
        default_factory=list,
        title="MCP servers",
        description=(
            "Declared MCP servers exposed to the agent. The backend resolves each server's "
            "secret env from the vault at run time; tokens never live in the config."
        ),
    )
    skills: List[Union["_SkillTemplateRefSchema", "_SkillEmbedRefSchema"]] = Field(
        default_factory=list,
        title="Skills",
        description=(
            "Skills the agent ships: each is an inline skill template (resolved from the "
            "``skill-template`` catalog type) or an @ag.embed reference to a stored skill the "
            "backend inlines into that same shape before the runner sees it."
        ),
    )
    harness: "_HarnessSchema" = Field(
        default_factory=lambda: _HarnessSchema(),
        title="Harness",
        description="The coding agent to drive plus its execution knobs.",
    )
    runner: "_RunnerSchema" = Field(
        default_factory=lambda: _RunnerSchema(),
        title="Runner",
        description="The engine that drives the harness loop and answers its interactions.",
    )
    sandbox: "_SandboxSchema" = Field(
        default_factory=lambda: _SandboxSchema(),
        title="Sandbox",
        description="Where the agent runs plus its security boundary.",
    )


class _HarnessPermissionsSchema(BaseModel):
    """A permission-gating harness's allow/ask/deny posture (was
    ``harness_kwargs.claude.permissions``). Lifted first-class because it is a security posture.

    For Claude this renders into ``.claude/settings.json``. ``default_mode`` is Claude's
    permission mode; ``allow`` / ``ask`` / ``deny`` are per-tool rule strings. A non-gating
    harness (Pi) leaves this empty."""

    model_config = ConfigDict(extra="forbid", title="Permissions")

    default_mode: Optional[
        Literal["default", "acceptEdits", "plan", "bypassPermissions"]
    ] = Field(
        default=None,
        title="Default mode",
        description="The harness's default permission mode (Claude: default / acceptEdits / plan / bypassPermissions).",
    )
    allow: List[str] = Field(
        default_factory=list,
        title="Allow",
        description="Per-tool rules auto-approved without prompting.",
    )
    ask: List[str] = Field(
        default_factory=list,
        title="Ask",
        description="Per-tool rules that raise a prompt.",
    )
    deny: List[str] = Field(
        default_factory=list,
        title="Deny",
        description="Per-tool rules always rejected.",
    )


class _HarnessSchema(BaseModel):
    """The coding agent to drive plus its execution knobs (was the flat ``harness`` scalar and
    its ``harness_kwargs`` slice).

    ``kind`` is the harness selector (the bare ``pi_core`` / ``pi_agenta`` / ``claude`` value).
    ``permissions`` is the gating posture for harnesses that gate tool use (Claude). ``extras``
    is the per-harness escape hatch (Pi's ``system`` / ``append_system`` prompt overrides)."""

    model_config = ConfigDict(extra="forbid", title="Harness")

    kind: str = Field(
        default=_DEFAULT_HARNESS,
        title="Harness",
        description=(
            "Coding agent to drive: pi_core (plain Pi), claude, or pi_agenta (Pi with "
            "Agenta's forced skills, tools, and base instructions)."
        ),
        json_schema_extra=_harness_field_schema_extra(),
    )
    permissions: _HarnessPermissionsSchema = Field(
        default_factory=_HarnessPermissionsSchema,
        title="Permissions",
        description="The harness's tool-use gating posture (gating harnesses only, e.g. Claude).",
    )
    extras: Dict[str, Any] = Field(
        default_factory=dict,
        title="Extras",
        description=(
            "Per-harness knobs passed through unchanged (e.g. Pi's system / append_system "
            "prompt overrides)."
        ),
    )


class _InteractionsSchema(BaseModel):
    """How the runner answers a harness's reverse-RPC interaction requests.

    Today only the ``permission`` interaction kind is wired; ``headless`` is the default answer
    it gives when no human surface is attached to the run (was the flat ``permission_policy``).
    The runner enforces it (``services/agent/src/responder.ts``). ``input`` and ``client_tool``
    interaction kinds extend this section in a later step."""

    model_config = ConfigDict(extra="forbid", title="Interactions")

    headless: Literal["auto", "deny"] = Field(
        default=_DEFAULT_PERMISSION_POLICY,
        title="Headless interactions",
        description=(
            "How a permission-gating harness's tool-use prompts are answered when no human is "
            "attached: auto-approve or deny."
        ),
    )


class _RunnerSchema(BaseModel):
    """The engine that drives the harness loop (the ``services/agent`` sidecar).

    ``kind`` names the engine; ``interactions`` is how it answers a harness's reverse-RPC
    requests (today only the headless permission default). ``extras`` is the per-runner escape
    hatch. The rest of the runner surface (per-kind interaction handling, delivery channel,
    hooks, loop controls) is a later step."""

    model_config = ConfigDict(extra="forbid", title="Runner")

    kind: Literal["sidecar"] = Field(
        default="sidecar",
        title="Runner",
        description="The engine that drives the harness loop.",
    )
    interactions: _InteractionsSchema = Field(
        default_factory=_InteractionsSchema,
        title="Interactions",
        description="How the runner answers a harness's reverse-RPC interaction requests.",
    )
    extras: Dict[str, Any] = Field(
        default_factory=dict,
        title="Extras",
        description="Per-runner knobs passed through unchanged.",
    )


class _SandboxSchema(BaseModel):
    """Where the agent runs plus its security boundary (was the flat ``sandbox`` scalar and the
    sibling ``sandbox_permission``).

    ``kind`` is the sandbox provider; ``permissions`` is the security boundary folded in
    first-class (was ``sandbox_permission``). ``extras`` is the per-sandbox escape hatch."""

    model_config = ConfigDict(extra="forbid", title="Sandbox")

    kind: Literal["local", "daytona"] = Field(
        default=_DEFAULT_SANDBOX,
        title="Sandbox",
        description="Where the agent runs: local daemon or a Daytona sandbox.",
    )
    permissions: Optional[SandboxPermission] = Field(
        default=None,
        title="Permissions",
        description=(
            "The sandbox security boundary the agent runs inside: outbound network egress "
            "(on / off / allowlist of CIDR ranges), filesystem access (declared), and "
            "enforcement (strict or best-effort). Optional; unset means no declared boundary."
        ),
    )
    extras: Dict[str, Any] = Field(
        default_factory=dict,
        title="Extras",
        description="Per-sandbox knobs passed through unchanged (e.g. a Daytona snapshot).",
    )


def build_agent_v0_default(
    *,
    skill_slug: Optional[str] = None,
    include_sandbox_permission: bool = False,
) -> Dict[str, Any]:
    """The default agent-template value, shared by the builtin interface and the service.

    The agent-template value that sits at ``parameters.agent`` (Step 1 of the agent-template
    migration): the portable definition flat (instructions / llm / empty tools / mcps) plus the
    nested execution parts (``harness`` / ``runner`` / ``sandbox``). ``include_sandbox_permission``
    adds the declared Layer-2 boundary the playground pre-fills (network egress on, strict).
    ``skill_slug`` adds one ``@ag.embed`` reference under ``skills`` to a stored skill the backend
    inlines before the runner sees it (the service passes the reserved platform default skill; the
    SDK builtin passes none)."""
    template: Dict[str, Any] = {
        "instructions": {"agents_md": _DEFAULT_AGENTS_MD},
        "llm": {"provider": _DEFAULT_AGENT_PROVIDER, "model": _DEFAULT_AGENT_MODEL},
        "tools": [],
        "mcps": [],
    }
    if skill_slug is not None:
        template["skills"] = [
            {
                "@ag.embed": {
                    # Reference the skill at the ARTIFACT level (its latest revision). A
                    # `workflow_revision` slug matches the revision's own hash slug, not the
                    # author-facing artifact slug, so a bare revision slug with no version 500s;
                    # `workflow.slug` is the correct "use the latest" shape.
                    "@ag.references": {"workflow": {"slug": skill_slug}},
                    "@ag.selector": {"path": "parameters.skill"},
                }
            }
        ]
    sandbox: Dict[str, Any] = {"kind": _DEFAULT_SANDBOX}
    if include_sandbox_permission:
        sandbox["permissions"] = {
            "network": {"mode": "on", "allowlist": []},
            "enforcement": "strict",
        }
    template["harness"] = {"kind": _DEFAULT_HARNESS}
    template["runner"] = {
        "kind": "sidecar",
        "interactions": {"headless": _DEFAULT_PERMISSION_POLICY},
    }
    template["sandbox"] = sandbox
    return template


class _SkillFileSchema(BaseModel):
    """Strict twin of :class:`agenta.sdk.agents.skills.SkillFile` for schema generation.

    Re-declared (not imported) so the catalog editor describes one bundled file without
    pulling the runtime model's validators into the playground's JSON Schema.
    """

    model_config = ConfigDict(extra="forbid")

    path: str = Field(
        min_length=1,
        max_length=255,
        # Mirror the runtime SkillFile safe-path rules (skills/models.py): a relative POSIX path
        # only. Reject a leading '/' (absolute), any backslash (Windows separator), and a '..'
        # segment (dir escape), so the catalog/editor cannot accept a path the runtime rejects.
        # Built from '/'-joined segments where each segment excludes '/' and '\' and is never
        # exactly '..' (look-around free, since pydantic_core's regex engine rejects look-ahead).
        pattern=(
            r"^(?:[^/\\]|[^./\\][^/\\]*|\.[^./\\][^/\\]*|\.\.[^/\\]+)"
            r"(?:/(?:[^/\\]|[^./\\][^/\\]*|\.[^./\\][^/\\]*|\.\.[^/\\]+))*$"
        ),
        title="Path",
        description=(
            "Relative path beside SKILL.md, e.g. 'scripts/foo.py'. Must be relative: no leading "
            "'/', no backslashes, no '..' segment, and not SKILL.md (reserved for the frontmatter)."
        ),
    )
    content: str = Field(
        max_length=200_000,
        title="Content",
        description="Inline UTF-8 file content.",
        json_schema_extra={"x-ag-type": "textarea"},
    )
    executable: bool = Field(
        default=False,
        title="Executable",
        description="Mark +x; only honored when the sandbox policy allows executable files.",
    )


class SkillTemplateSchema(AgSchemaMixin):
    """The playground's editable inline-skill package (one ``skills`` entry), as one semantic type.

    Schema-generation counterpart to the runtime :class:`agenta.sdk.agents.SkillTemplate`: it emits
    a rich JSON Schema for the ``skill-template`` control. The runtime model coerces the loose shapes
    the playground emits; this strict twin describes them. A skill that lives elsewhere is authored
    as an ``@ag.embed`` reference instead, which the backend inlines into this same shape.
    """

    model_config = ConfigDict(extra="forbid")

    __ag_type__ = "skill-template"

    name: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        title="Name",
        description="Skill name (lowercase, digits, single hyphens, <=64 chars).",
    )
    description: str = Field(
        min_length=1,
        max_length=1024,
        title="Description",
        description="The trigger the model matches; read by every harness.",
    )
    body: str = Field(
        min_length=1,
        max_length=50_000,
        title="Body",
        description="The SKILL.md Markdown body written after the composed frontmatter.",
        json_schema_extra={"x-ag-type": "textarea"},
    )
    files: List[_SkillFileSchema] = Field(
        default_factory=list,
        title="Files",
        description="Bundled scripts / references laid beside SKILL.md by relative path.",
    )
    disable_model_invocation: bool = Field(
        default=False,
        title="Disable model invocation",
        description="Hide from the prompt; invoke only via /skill:name (Pi/Claude).",
    )
    allow_executable_files: bool = Field(
        default=False,
        title="Allow executable files",
        description="Default deny; the sandbox policy must also allow execution.",
    )


class _SkillEmbedRefSchema(BaseModel):
    """An ``@ag.embed`` reference standing in for one ``skills`` entry.

    The seeded default config and the playground both keep skills the user references (rather than
    writes inline) as a bare ``{"@ag.embed": {...}}`` object; the backend's embed resolver inlines
    it into a :class:`SkillTemplateSchema` shape before the runner sees it. So the raw/advanced
    schema must accept this reference form alongside the inline package, or a valid default would
    fail validation. The embed body is intentionally permissive (``Dict[str, Any]``) — its inner
    ``@ag.references`` / ``@ag.selector`` keys are the embed resolver's contract, not this schema's.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    embed: Dict[str, Any] = Field(
        alias="@ag.embed",
        title="Embed reference",
        description="An @ag.embed reference resolved server-side into an inline skill package.",
    )


class _SkillTemplateRefSchema(AgSchemaMixin):
    """The inline ``skills`` arm, emitted as a bare ``{x-ag-type-ref: "skill-template"}`` node.

    The agent config no longer inlines the full skill-template schema; it points at the
    ``skill-template`` catalog type (``/catalog/types/skill-template``) the same way inputs point at
    ``messages``. The frontend resolves the ref to render the editor. The author still writes an
    inline skill package here; its full shape lives in the resolved ``skill-template`` type.
    """

    __ag_type_ref__ = "skill-template"

    model_config = ConfigDict(extra="allow")

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema, handler):
        # A pure ref node: only the x-ag-type-ref marker, no inlined object shape.
        return {"x-ag-type-ref": cls.__ag_type_ref__}


class _ToolEmbedRefSchema(BaseModel):
    """An ``@ag.embed`` reference standing in for one ``tools`` entry (the embed syntax).

    Mirrors :class:`_SkillEmbedRefSchema`: the playground keeps a tool the author references
    (rather than writes inline) as a bare ``{"@ag.embed": {...}}`` object, and the backend's
    embed resolver inlines it into a concrete ``client`` tool config before the runner sees it.
    The raw/advanced schema must accept this reference form alongside the concrete tool variants.
    The embed body stays permissive (``Dict[str, Any]``) — its inner ``@ag.references`` /
    ``@ag.selector`` keys are the embed resolver's contract, not this schema's.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    embed: Dict[str, Any] = Field(
        alias="@ag.embed",
        title="Embed reference",
        description="An @ag.embed reference resolved server-side into an inline client tool.",
    )


# Resolve the forward references on the agent definition's skills + tools (inline / embed). A
# workflow referenced as a tool is the ``type:"reference"`` arm of ``ToolConfig`` itself.
AgentTemplateSchema.model_rebuild()


CATALOG_TYPES = {
    Message.ag_type(): _dereference_schema(Message.model_json_schema()),
    Messages.ag_type(): _dereference_schema(Messages.model_json_schema()),
    "model": _model_catalog_type(),
    AgLLM.ag_type(): _dereference_schema(AgLLM.model_json_schema()),
    AgLLMs.ag_type(): _dereference_schema(AgLLMs.model_json_schema()),
    AgLoop.ag_type(): _dereference_schema(AgLoop.model_json_schema()),
    AgTool.ag_type(): _dereference_schema(AgTool.model_json_schema()),
    AgTools.ag_type(): _dereference_schema(AgTools.model_json_schema()),
    AgContext.ag_type(): _dereference_schema(AgContext.model_json_schema()),
    AgPermissions.ag_type(): _dereference_schema(AgPermissions.model_json_schema()),
    AgResponse.ag_type(): _dereference_schema(AgResponse.model_json_schema()),
    PromptTemplate.ag_type(): _dereference_schema(PromptTemplate.model_json_schema()),
    AgentTemplateSchema.ag_type(): _dereference_schema(
        AgentTemplateSchema.model_json_schema()
    ),
    SkillTemplateSchema.ag_type(): _dereference_schema(
        SkillTemplateSchema.model_json_schema()
    ),
    # The `/run` wire contract (request + result), exported from the dedicated Pydantic wire
    # models in `agenta.sdk.agents.wire_models`. This puts the service<->runner wire interface in
    # the SDK the same way the other catalog types are exposed; a freshness test asserts these
    # entries match a fresh export so the schema cannot drift from the models.
    **run_contract_schemas(),
}
