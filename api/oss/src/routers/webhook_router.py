"""Webhook router for managing post-deployment webhooks"""

from fastapi import APIRouter, Request, HTTPException
from typing import List, Optional

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import APIRouter, is_ee
from oss.src.services.webhook_service import webhook_service
from oss.src.models.api.webhook_models import (
    WebhookCreate,
    WebhookUpdate,
    WebhookResponse,
    WebhookExecutionResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access

router = APIRouter()
log = get_module_logger(__name__)


@router.get("/", operation_id="list_webhooks")
async def list_webhooks(
    project_id: str,
    app_id: Optional[str] = None,
    request: Request = None,
):
    """List all webhooks for a project

    Args:
        project_id: Project ID
        app_id: Optional App ID to filter by
        request: FastAPI request

    Returns:
        List of webhooks
    """
    webhooks = await webhook_service.list_webhooks(
        project_id=project_id,
        app_id=app_id,
    )
    return webhooks


@router.post("/", operation_id="create_webhook")
async def create_webhook(
    payload: WebhookCreate,
    request: Request,
):
    """Create a new webhook configuration

    Args:
        payload: Webhook creation data
        request: FastAPI request with user context

    Returns:
        Created webhook

    Raises:
        HTTPException: If user lacks permissions or project not found
    """
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=payload.project_id,
            permission=Permission.MANAGE_WEBHOOKS,
        )
        if not has_permission:
            raise HTTPException(status_code=403, detail="No permission to manage webhooks")

    try:
        webhook = await webhook_service.create_webhook(
            webhook_data=payload,
            user_uid=request.state.user_id,
        )
        return webhook
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{webhook_id}/", operation_id="get_webhook")
async def get_webhook(
    webhook_id: str,
    request: Request,
):
    """Get a single webhook by ID

    Args:
        webhook_id: Webhook ID
        request: FastAPI request

    Returns:
        Webhook details

    Raises:
        HTTPException: If webhook not found
    """
    webhook = await webhook_service.get_webhook(webhook_id=webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return webhook


@router.put("/{webhook_id}/", operation_id="update_webhook")
async def update_webhook(
    webhook_id: str,
    payload: WebhookUpdate,
    request: Request,
):
    """Update a webhook configuration

    Args:
        webhook_id: Webhook ID
        payload: Update data
        request: FastAPI request

    Returns:
        Updated webhook

    Raises:
        HTTPException: If webhook not found or lacks permissions
    """
    if is_ee():
        # Get project_id from webhook
        webhook = await webhook_service.get_webhook(webhook_id)
        if not webhook:
            raise HTTPException(status_code=404, detail="Webhook not found")

        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=webhook.project_id,
            permission=Permission.MANAGE_WEBHOOKS,
        )
        if not has_permission:
            raise HTTPException(status_code=403, detail="No permission to manage webhooks")

    webhook = await webhook_service.update_webhook(
        webhook_id=webhook_id,
        update_data=payload,
    )
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return webhook


@router.delete("/{webhook_id}/", operation_id="delete_webhook")
async def delete_webhook(
    webhook_id: str,
    request: Request,
):
    """Delete a webhook

    Args:
        webhook_id: Webhook ID
        request: FastAPI request

    Returns:
        Success message

    Raises:
        HTTPException: If webhook not found or lacks permissions
    """
    if is_ee():
        webhook = await webhook_service.get_webhook(webhook_id)
        if not webhook:
            raise HTTPException(status_code=404, detail="Webhook not found")

        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=webhook.project_id,
            permission=Permission.MANAGE_WEBHOOKS,
        )
        if not has_permission:
            raise HTTPException(status_code=403, detail="No permission to manage webhooks")

    success = await webhook_service.delete_webhook(webhook_id=webhook_id)
    if not success:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Webhook deleted successfully"}


@router.get("/{webhook_id}/executions/", operation_id="list_webhook_executions")
async def list_webhook_executions(
    webhook_id: str,
    limit: int = 50,
    offset: int = 0,
    request: Request = None,
):
    """List webhook execution history

    Args:
        webhook_id: Webhook ID
        limit: Max number of records (default 50)
        offset: Number of records to skip (default 0)
        request: FastAPI request

    Returns:
        List of webhook executions
    """
    executions = await webhook_service.list_executions(
        webhook_id=webhook_id,
        limit=limit,
        offset=offset,
    )
    return executions


@router.get("/executions/{execution_id}/", operation_id="get_webhook_execution")
async def get_webhook_execution(
    execution_id: str,
    request: Request,
):
    """Get a single webhook execution

    Args:
        execution_id: Execution ID
        request: FastAPI request

    Returns:
        Execution details

    Raises:
        HTTPException: If execution not found
    """
    execution = await webhook_service.get_execution(execution_id=execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution
