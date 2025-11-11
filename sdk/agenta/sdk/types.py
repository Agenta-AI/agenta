import json
from dataclasses import dataclass
from typing import List, Union, Optional, Dict, Literal, Any

from pydantic import ConfigDict, BaseModel, HttpUrl
from pydantic import BaseModel, Field, model_validator

from agenta.sdk.assets import supported_llm_models
from agenta.client.backend.types import AgentaNodesResponse, AgentaNodeDto


@dataclass
class MultipleChoice:
    choices: Union[List[str], Dict[str, List[str]]]


def MCField(  # pylint: disable=invalid-name
    default: str,
    choices: Union[List[str], Dict[str, List[str]]],
) -> Field:
    field = Field(default=default, description="ID of the model to use")
    if isinstance(choices, dict):
        field.json_schema_extra = {"choices": choices, "x-parameter": "grouped_choice"}
    elif isinstance(choices, list):
        field.json_schema_extra = {"choices": choices, "x-parameter": "choice"}

    return field


class LLMTokenUsage(BaseModel):
    completion_tokens: int
    prompt_tokens: int
    total_tokens: int


class BaseResponse(BaseModel):
    version: Optional[str] = "3.0"
    data: Optional[Union[str, Dict[str, Any]]] = None
    content_type: Optional[str] = "string"
    tree: Optional[AgentaNodesResponse] = None
    tree_id: Optional[str] = None
    trace_id: Optional[str] = None
    span_id: Optional[str] = None

    model_config = ConfigDict(use_enum_values=True, exclude_none=True)


class DictInput(dict):
    def __new__(cls, default_keys: Optional[List[str]] = None):
        instance = super().__new__(cls, default_keys)
        if default_keys is None:
            default_keys = []
        instance.data = [key for key in default_keys]  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "dict"}


class TextParam(str):
    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "text", "type": "string"}


class BinaryParam(int):
    def __new__(cls, value: bool = False):
        instance = super().__new__(cls, int(value))
        instance.default = value  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {
            "x-parameter": "bool",
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
        return {"x-parameter": "int", "type": "integer"}


class FloatParam(float):
    def __new__(cls, default: float = 0.5, minval: float = 0.0, maxval: float = 1.0):
        instance = super().__new__(cls, default)
        instance.default = default  # type: ignore
        instance.minval = minval  # type: ignore
        instance.maxval = maxval  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "float", "type": "number"}


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
        return {"x-parameter": "choice", "type": "string", "enum": []}


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
            "x-parameter": "grouped_choice",
            "type": "string",
        }


class MessagesInput(list):
    """Messages Input for Chat-completion.

    Args:
        messages (List[Dict[str, str]]): The list of messages inputs.
        Required. Each message should be a dictionary with "role" and "content" keys.

    Raises:
        ValueError: If `messages` is not specified or empty.

    """

    def __new__(cls, messages: List[Dict[str, str]] = []):
        instance = super().__new__(cls)
        instance.default = messages  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "messages", "type": "array"}


class FileInputURL(HttpUrl):
    def __new__(cls, url: str):
        instance = super().__new__(cls, url)
        instance.default = url  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "file_url", "type": "string"}


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


class ToolCall(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: Dict[str, str]


class ImageURL(BaseModel):
    url: str
    detail: Optional[Literal["auto", "low", "high"]] = None


class ContentPartText(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ContentPartImage(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: ImageURL


ContentPart = Union[ContentPartText, ContentPartImage]


class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool", "function"]
    content: Optional[Union[str, List[ContentPart]]] = None
    name: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    tool_call_id: Optional[str] = None


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

    model: str = MCField(
        default="gpt-3.5-turbo",
        choices=supported_llm_models,
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


class PromptTemplate(BaseModel):
    """A template for generating prompts with formatting capabilities"""

    messages: List[Message] = Field(
        default=[Message(role="system", content=""), Message(role="user", content="")]
    )
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
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

    model_config = {
        "json_schema_extra": {
            "x-parameters": {
                "prompt": "true",
            }
        }
    }

    @model_validator(mode="before")
    def init_messages(cls, values):
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
        """Internal method to format content based on template_format"""
        try:
            if self.template_format == "fstring":
                return content.format(**kwargs)
            elif self.template_format == "jinja2":
                from jinja2 import Template, TemplateError

                try:
                    return Template(content).render(**kwargs)
                except TemplateError as e:
                    raise TemplateFormatError(
                        f"Jinja2 template error in content: '{content}'. Error: {str(e)}",
                        original_error=e,
                    )
            elif self.template_format == "curly":
                import re

                result = content
                for key, value in kwargs.items():
                    result = re.sub(r"\{\{" + key + r"\}\}", str(value), result)
                if re.search(r"\{\{.*?\}\}", result):
                    unreplaced = re.findall(r"\{\{(.*?)\}\}", result)
                    raise TemplateFormatError(
                        f"Unreplaced variables in curly template: {unreplaced}"
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
                f"Error formatting template '{content}': {str(e)}", original_error=e
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

        new_llm_config = self.llm_config.copy(deep=True)
        if new_llm_config.response_format is not None:
            rf_dict = new_llm_config.response_format.model_dump(by_alias=True)
            substituted = self._substitute_variables(rf_dict, kwargs)
            rf_type = type(new_llm_config.response_format)
            new_llm_config.response_format = rf_type(**substituted)

        return PromptTemplate(
            messages=new_messages,
            template_format=self.template_format,
            llm_config=new_llm_config,
            input_keys=self.input_keys,
        )

    def to_openai_kwargs(self) -> dict:
        """Convert the prompt template to kwargs compatible with litellm/openai"""
        kwargs = {
            "messages": [msg.model_dump(exclude_none=True) for msg in self.messages],
        }

        # Add optional parameters only if they are set
        if self.llm_config.model is not None:
            kwargs["model"] = self.llm_config.model

        if self.llm_config.temperature is not None:
            kwargs["temperature"] = self.llm_config.temperature

        if self.llm_config.top_p is not None:
            kwargs["top_p"] = self.llm_config.top_p

        if self.llm_config.stream is not None:
            kwargs["stream"] = self.llm_config.stream

        if self.llm_config.max_tokens is not None:
            kwargs["max_tokens"] = self.llm_config.max_tokens

        if self.llm_config.frequency_penalty is not None:
            kwargs["frequency_penalty"] = self.llm_config.frequency_penalty

        if self.llm_config.presence_penalty is not None:
            kwargs["presence_penalty"] = self.llm_config.presence_penalty

        if self.llm_config.response_format:
            kwargs["response_format"] = self.llm_config.response_format.dict(
                by_alias=True
            )

        if self.llm_config.tools:
            kwargs["tools"] = self.llm_config.tools
            # Only set tool_choice if tools are present
            if self.llm_config.tool_choice is not None:
                kwargs["tool_choice"] = self.llm_config.tool_choice

        return kwargs
