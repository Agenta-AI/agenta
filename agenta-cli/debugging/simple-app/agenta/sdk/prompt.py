from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class Prompt(BaseModel):
    """A pre-built BaseModel for prompt configuration"""

    system_message: str = Field(default="", description="System message for the prompt")
    user_message: str = Field(default="", description="User message template")
    temperature: float = Field(
        default=0.7, ge=0.0, le=1.0, description="Temperature for text generation"
    )
    max_tokens: Optional[int] = Field(
        default=None, ge=1, description="Maximum number of tokens to generate"
    )
    stop_sequences: Optional[List[str]] = Field(
        default=None,
        description="List of sequences where the model should stop generating",
    )
    model_parameters: Optional[Dict[str, Any]] = Field(
        default=None, description="Additional model-specific parameters"
    )
