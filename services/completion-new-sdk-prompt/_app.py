from typing import Annotated, List, Union, Optional, Dict, Literal, Any
from pydantic import BaseModel, Field, root_validator

import agenta as ag
from agenta.sdk.assets import supported_llm_models
import os
# Import mock if MOCK_LLM environment variable is set
if os.getenv("MOCK_LLM", True):
    from mock_litellm import MockLiteLLM

    litellm = MockLiteLLM()
else:
    import litellm

    litellm.drop_params = True
    litellm.callbacks = [ag.callbacks.litellm_handler()]


prompts = {
    "system_prompt": "You are an expert in geography.",
    "user_prompt": """What is the capital of {country}?""",
}

GPT_FORMAT_RESPONSE = ["gpt-3.5-turbo-1106", "gpt-4-1106-preview"]


ag.init()

class ToolCall(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: Dict[str, str]

class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool", "function"]
    content: Optional[str] = None
    name: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    tool_call_id: Optional[str] = None

class ResponseFormat(BaseModel):
    type: Literal["text", "json_object"] = "text"
    schema: Optional[Dict] = None

class PromptTemplateError(Exception):
    """Base exception for all PromptTemplate errors"""
    pass

class InputValidationError(PromptTemplateError):
    """Raised when input validation fails"""
    def __init__(self, message: str, missing: Optional[set] = None, extra: Optional[set] = None):
        self.missing = missing
        self.extra = extra
        super().__init__(message)

class TemplateFormatError(PromptTemplateError):
    """Raised when template formatting fails"""
    def __init__(self, message: str, original_error: Optional[Exception] = None):
        self.original_error = original_error
        super().__init__(message)

class ModelConfig(BaseModel):
    """Configuration for model parameters"""
    model: Annotated[str, ag.MultipleChoice(choices=supported_llm_models)] = Field(
        default="gpt-3.5-turbo",
        description="The model to use for completion"
    )
    temperature: float = Field(default=1.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=-1, ge=-1, description="Maximum tokens to generate. -1 means no limit")
    top_p: float = Field(default=1.0, ge=0.0, le=1.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    response_format: Optional[ResponseFormat] = Field(
        default=None,
        description="Specify the format of the response (text or JSON)"
    )
    stream: bool = Field(default=False)
    tools: Optional[List[Dict]] = Field(
        default=None,
        description="List of tools/functions the model can use"
    )
    tool_choice: Optional[Union[Literal["none", "auto"], Dict]] = Field(
        default="auto",
        description="Control which tool the model should use"
    )

class PromptTemplate(BaseModel):
    """A template for generating prompts with formatting capabilities"""
    messages: List[Message] = Field(
        default=[
            Message(role="system", content=prompts["system_prompt"]),
            Message(role="user", content=prompts["user_prompt"])
        ]
    )
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
    template_format: Literal["fstring", "jinja2", "curly"] = Field(
        default="fstring",
        description="Format type for template variables: fstring {var}, jinja2 {{ var }}, or curly {{var}}"
    )
    input_keys: Optional[List[str]] = Field(
        default=None,
        description="Optional list of input keys for validation. If not provided, any inputs will be accepted"
    )
    llm_config: ModelConfig = Field(
        default_factory=ModelConfig,
        description="Configuration for the model parameters"
    )

    class Config:
        extra = "allow"
        schema_extra = {
            "x-prompt": True
        }

    @root_validator(pre=True)
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
                        original_error=e
                    )
            elif self.template_format == "curly":
                import re
                result = content
                for key, value in kwargs.items():
                    result = re.sub(r'\{\{' + key + r'\}\}', str(value), result)
                if re.search(r'\{\{.*?\}\}', result):
                    unreplaced = re.findall(r'\{\{(.*?)\}\}', result)
                    raise TemplateFormatError(
                        f"Unreplaced variables in curly template: {unreplaced}"
                    )
                return result
            else:
                raise TemplateFormatError(f"Unknown template format: {self.template_format}")
        except KeyError as e:
            key = str(e).strip("'")
            raise TemplateFormatError(
                f"Missing required variable '{key}' in template: '{content}'"
            )
        except Exception as e:
            raise TemplateFormatError(
                f"Error formatting template '{content}': {str(e)}",
                original_error=e
            )

    def format(self, **kwargs) -> 'PromptTemplate':
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
                error_parts.append(f"Missing required inputs: {', '.join(sorted(missing))}")
            if extra:
                error_parts.append(f"Unexpected inputs: {', '.join(sorted(extra))}")
            
            if error_parts:
                raise InputValidationError(
                    " | ".join(error_parts),
                    missing=missing if missing else None,
                    extra=extra if extra else None
                )

        new_messages = []
        for i, msg in enumerate(self.messages):
            if msg.content:
                try:
                    new_content = self._format_with_template(msg.content, kwargs)
                except TemplateFormatError as e:
                    raise TemplateFormatError(
                        f"Error in message {i} ({msg.role}): {str(e)}",
                        original_error=e.original_error
                    )
            else:
                new_content = None
                
            new_messages.append(Message(
                role=msg.role,
                content=new_content,
                name=msg.name,
                tool_calls=msg.tool_calls,
                tool_call_id=msg.tool_call_id
            ))
        
        return PromptTemplate(
            messages=new_messages,
            template_format=self.template_format,
            llm_config=self.llm_config,
            input_keys=self.input_keys
        )

    def to_openai_kwargs(self) -> dict:
        """Convert the prompt template to kwargs compatible with litellm/openai"""
        kwargs = {
            "model": self.llm_config.model,
            "messages": [msg.dict(exclude_none=True) for msg in self.messages],
            "temperature": self.llm_config.temperature,
            "top_p": self.llm_config.top_p,
            "stream": self.llm_config.stream,
        }

        # Add optional parameters only if they have non-default values
        if self.llm_config.max_tokens != -1:
            kwargs["max_tokens"] = self.llm_config.max_tokens
            
        if self.llm_config.frequency_penalty != 0:
            kwargs["frequency_penalty"] = self.llm_config.frequency_penalty
            
        if self.llm_config.presence_penalty != 0:
            kwargs["presence_penalty"] = self.llm_config.presence_penalty
            
        if self.llm_config.response_format:
            kwargs["response_format"] = self.llm_config.response_format.dict()
            
        if self.llm_config.tools:
            kwargs["tools"] = self.llm_config.tools
            
        if self.llm_config.tool_choice and self.llm_config.tool_choice != "auto":
            kwargs["tool_choice"] = self.llm_config.tool_choice

        return kwargs

class MyConfig(BaseModel):
    prompt: PromptTemplate = Field(default=PromptTemplate())

@ag.route("/", config_schema=MyConfig)
@ag.instrument()
async def generate(
    inputs: Dict[str, str],
):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    
    try:
        # Format the prompt template with the inputs
        formatted_prompt = config.prompt.format(**inputs)
        config.prompt = formatted_prompt
    except (InputValidationError, TemplateFormatError) as e:
        raise ValueError(f"Error formatting prompt template: {str(e)}")
    except Exception as e:
        raise ValueError(f"Unexpected error formatting prompt: {str(e)}")

    response = await litellm.acompletion(**config.prompt.to_openai_kwargs())
    
    return response.choices[0].message.content
