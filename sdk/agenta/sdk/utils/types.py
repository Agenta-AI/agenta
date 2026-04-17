import json
from copy import deepcopy
from dataclasses import dataclass
from enum import Enum
from typing import Annotated, ClassVar, List, Union, Optional, Dict, Literal, Any

from pydantic import ConfigDict, BaseModel, HttpUrl, RootModel
from pydantic import Field, model_validator, AliasChoices


from agenta.sdk.utils.assets import supported_llm_models, model_metadata
from agenta.sdk.utils.helpers import apply_replacements_with_tracking, _PLACEHOLDER_RE


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

    def __init__(self, message: str, original_error: Optional[Exception] = None):
        self.original_error = original_error
        super().__init__(message)


from typing import Iterable, Tuple  # noqa: E402

from agenta.sdk.utils.lazy import _load_jinja2, _load_jsonpath  # noqa: E402


# ========= Scheme detection =========


def detect_scheme(expr: str) -> str:
    """Return 'json-path', 'json-pointer', or 'dot-notation' based on the placeholder prefix."""
    if expr.startswith("$"):
        return "json-path"
    if expr.startswith("/"):
        return "json-pointer"
    return "dot-notation"


# ========= Resolvers =========


def resolve_dot_notation(expr: str, data: dict) -> object:
    if "[" in expr or "]" in expr:
        raise KeyError(f"Bracket syntax is not supported in dot-notation: {expr!r}")

    # First, check if the expression exists as a literal key (e.g., "topic.story" as a single key)
    # This allows users to use dots in their variable names without nested access
    if expr in data:
        return data[expr]

    # If not found as a literal key, try to parse as dot-notation path
    cur = data
    for token in (p for p in expr.split(".") if p):
        if isinstance(cur, list) and token.isdigit():
            cur = cur[int(token)]
        else:
            if not isinstance(cur, dict):
                raise KeyError(
                    f"Cannot access key {token!r} on non-dict while resolving {expr!r}"
                )
            if token not in cur:
                raise KeyError(f"Missing key {token!r} while resolving {expr!r}")
            cur = cur[token]
    return cur


def resolve_json_path(expr: str, data: dict) -> object:
    json_path, _ = _load_jsonpath()
    if json_path is None:
        raise ImportError("python-jsonpath is required for json-path ($...)")

    if not (expr == "$" or expr.startswith("$.") or expr.startswith("$[")):
        raise ValueError(
            f"Invalid json-path expression {expr!r}. "
            "Must start with '$', '$.' or '$[' (no implicit normalization)."
        )

    # Use package-level APIf
    results = json_path.findall(expr, data)  # always returns a list
    return results[0] if len(results) == 1 else results


def resolve_json_pointer(expr: str, data: Dict[str, Any]) -> Any:
    """Resolve a JSON Pointer; returns a single value."""
    _, json_pointer = _load_jsonpath()
    if json_pointer is None:
        raise ImportError("python-jsonpath is required for json-pointer (/...)")
    return json_pointer(expr).resolve(data)


def resolve_any(expr: str, data: Dict[str, Any]) -> Any:
    """Dispatch to the right resolver based on detected scheme."""
    scheme = detect_scheme(expr)
    if scheme == "json-path":
        return resolve_json_path(expr, data)
    if scheme == "json-pointer":
        return resolve_json_pointer(expr, data)
    return resolve_dot_notation(expr, data)


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
    template_format: Literal["curly", "fstring", "jinja2"] = Field(
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


class FallbackModelConfig(ModelConfig):
    """LLM config used for fallback entries. Same shape, required model."""

    model: str = Field(
        ...,
        description="Model identifier to use for execution.",
        json_schema_extra={"x-ag-type-ref": "model"},
    )


class RetryPolicy(BaseModel):
    max_retries: int = Field(default=0, ge=0)
    delay_ms: int = Field(default=0, ge=0)


class FallbackPolicy(str, Enum):
    OFF = "off"
    AVAILABILITY = "availability"
    CAPACITY = "capacity"
    ACCESS = "access"
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
    template_format: Literal["fstring", "jinja2", "curly"] = Field(
        default="curly",
        description="Format type for template variables: fstring {var}, jinja2 {{ var }}, or curly {{var}}",
    )
    input_keys: Optional[List[str]] = Field(
        default=None,
        description="Optional list of input keys for validation. If not provided, any inputs will be accepted",
    )
    llm_config: ModelConfig = Field(
        default_factory=ModelConfig,
        description="Configuration for the model parameters",
    )
    fallback_llm_configs: Optional[List[FallbackModelConfig]] = Field(
        default=None,
        description="Ordered fallback LLM configs. Runtime default is no fallback configs.",
    )
    retry_policy: Optional[RetryPolicy] = Field(
        default=None,
        description="Retry policy applied to each attempted LLM config.",
    )
    fallback_policy: Optional[FallbackPolicy] = Field(
        default=None,
        description="Controls which provider-call errors can move execution to the next fallback config.",
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
        fallback_configs = values.get("fallback_llm_configs")
        if isinstance(fallback_configs, list):
            for index, fallback_config in enumerate(fallback_configs):
                if isinstance(fallback_config, dict) and not fallback_config.get(
                    "model"
                ):
                    raise ValueError(f"fallback_llm_configs[{index}].model is required")
        return values

    def _format_with_template(self, content: str, kwargs: Dict[str, Any]) -> str:
        """Internal method to format content based on template_format"""
        try:
            if self.template_format == "fstring":
                return content.format(**kwargs)

            elif self.template_format == "jinja2":
                SandboxedEnvironment, TemplateError = _load_jinja2()
                env = SandboxedEnvironment()

                try:
                    return env.from_string(content).render(**kwargs)
                except TemplateError as e:
                    raise TemplateFormatError(
                        f"Jinja2 template error in content: '{content}'. Error: {str(e)}",
                        original_error=e,
                    )

            elif self.template_format == "curly":
                original_placeholders = set(extract_placeholders(content))

                replacements, _unresolved = build_replacements(
                    original_placeholders, kwargs
                )

                result, successfully_replaced = apply_replacements_with_tracking(
                    content, replacements
                )

                # Only the placeholders that were NOT successfully replaced are errors
                # This avoids false positives when substituted values contain {{...}} patterns
                truly_unreplaced = original_placeholders - successfully_replaced
                if truly_unreplaced:
                    hint = missing_lib_hints(truly_unreplaced)
                    suffix = f" Hint: {hint}" if hint else ""
                    raise TemplateFormatError(
                        f"Unreplaced variables in curly template: {sorted(truly_unreplaced)}.{suffix}"
                    )

                return result

            else:
                raise TemplateFormatError(
                    f"Unknown template format: {self.template_format}"
                )

        except KeyError as e:
            key = str(e).strip("'")
            raise TemplateFormatError(
                f"Missing required variable '{key}' in template: '{content}'"
            )
        except Exception as e:
            raise TemplateFormatError(
                f"Error formatting template '{content}': {str(e)}",
                original_error=e,
            )

    def _substitute_variables(self, obj: Any, kwargs: Dict[str, Any]) -> Any:
        """Recursively substitute variables within strings of a JSON-like object.

        This now processes placeholders in both keys and values so that
        structures like ``{"my_{{var}}": "{{val}}"}`` are fully substituted.
        """
        if isinstance(obj, str):
            return self._format_with_template(obj, kwargs)
        if isinstance(obj, list):
            return [self._substitute_variables(item, kwargs) for item in obj]
        if isinstance(obj, dict):
            new_dict = {}
            for k, v in obj.items():
                new_key = (
                    self._format_with_template(k, kwargs) if isinstance(k, str) else k
                )
                new_dict[new_key] = self._substitute_variables(v, kwargs)
            return new_dict
        return obj

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

        new_messages = []
        for i, msg in enumerate(self.messages):
            if msg.content:
                try:
                    new_content = self._format_with_template(msg.content, kwargs)
                except TemplateFormatError as e:
                    raise TemplateFormatError(
                        f"Error in message {i} ({msg.role}): {str(e)}",
                        original_error=e.original_error,
                    )
            else:
                new_content = None

            new_messages.append(
                Message(
                    role=msg.role,
                    content=new_content,
                    name=msg.name,
                    tool_calls=msg.tool_calls,
                    tool_call_id=msg.tool_call_id,
                )
            )

        new_llm_config = self._format_llm_config(self.llm_config, kwargs)
        new_fallback_llm_configs = None
        if self.fallback_llm_configs is not None:
            new_fallback_llm_configs = [
                self._format_llm_config(fallback_config, kwargs)
                for fallback_config in self.fallback_llm_configs
            ]

        return PromptTemplate(
            messages=new_messages,
            template_format=self.template_format,
            llm_config=new_llm_config,
            fallback_llm_configs=new_fallback_llm_configs,
            retry_policy=self.retry_policy,
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

    def to_openai_kwargs(self) -> dict:
        """Convert the prompt template to kwargs compatible with litellm/openai"""
        return self.to_openai_kwargs_for_llm_config(self.llm_config)

    def to_openai_kwargs_for_llm_config(self, llm_config: ModelConfig) -> dict:
        """Convert the prompt template to kwargs for a specific LLM config."""
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
}
