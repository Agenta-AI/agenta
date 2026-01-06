"""Webhook API models for request/response validation"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class EnvironmentVariable(BaseModel):
    """Environment variable configuration for webhook execution"""

    key: str = Field(..., min_length=1, max_length=100, description="Environment variable name")
    value: str = Field(..., max_length=1000, description="Environment variable value")
    is_secret: bool = Field(default=False, description="Whether this is a sensitive value that should be encrypted")


class WebhookCreate(BaseModel):
    """Request model for creating a webhook"""

    app_id: str = Field(..., description="Application ID to associate webhook with")
    name: str = Field(..., min_length=1, max_length=100, description="Webhook name")
    description: Optional[str] = Field(None, max_length=500, description="Optional description")
    script_content: str = Field(..., min_length=1, description="Python script to execute")
    script_timeout: int = Field(default=300, ge=10, le=3600, description="Script timeout in seconds")
    docker_image: str = Field(default="python:3.11-slim", description="Docker image to use for execution")
    environment_variables: List[EnvironmentVariable] = Field(
        default_factory=list, description="Environment variables to inject into script execution"
    )
    retry_on_failure: bool = Field(default=False, description="Whether to retry on failure")
    max_retries: int = Field(default=3, ge=0, le=10, description="Maximum number of retries")
    retry_delay_seconds: int = Field(default=60, ge=0, le=3600, description="Delay between retries in seconds")
    trigger_on_environments: List[str] = Field(
        default_factory=list, description="List of environments to trigger on (empty = all environments)"
    )
    is_enabled: bool = Field(default=True, description="Whether the webhook is enabled")


class WebhookUpdate(BaseModel):
    """Request model for updating a webhook"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    script_content: Optional[str] = Field(None, min_length=1)
    script_timeout: Optional[int] = Field(None, ge=10, le=3600)
    docker_image: Optional[str] = None
    environment_variables: Optional[List[EnvironmentVariable]] = None
    retry_on_failure: Optional[bool] = None
    max_retries: Optional[int] = Field(None, ge=0, le=10)
    retry_delay_seconds: Optional[int] = Field(None, ge=0, le=3600)
    trigger_on_environments: Optional[List[str]] = None
    is_enabled: Optional[bool] = None


class WebhookResponse(BaseModel):
    """Response model for webhook data"""

    id: str
    app_id: str
    name: str
    description: Optional[str]
    is_enabled: bool
    script_timeout: int
    docker_image: str
    environment_variables: List[EnvironmentVariable]
    retry_on_failure: bool
    max_retries: int
    retry_delay_seconds: int
    trigger_on_environments: List[str]
    created_at: datetime
    updated_at: datetime


class WebhookExecutionResponse(BaseModel):
    """Response model for webhook execution data"""

    id: str
    webhook_id: str
    deployment_id: Optional[str]
    environment_name: str
    variant_id: Optional[str]
    variant_revision_id: Optional[str]
    status: str
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    exit_code: Optional[int]
    output: Optional[str]
    error_output: Optional[str]
    container_id: Optional[str]
    retry_count: int
    is_retry: bool
    parent_execution_id: Optional[str]
    created_at: datetime
