"""Webhook service for managing post-deployment webhooks"""

from typing import List, Optional, TYPE_CHECKING
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.models.db_models import (
    WebhookDB,
    WebhookExecutionDB,
    AppDB,
)
from oss.src.models.api.webhook_models import (
    WebhookCreate,
    WebhookUpdate,
    WebhookResponse,
    WebhookExecutionResponse,
    EnvironmentVariable,
    HttpHeader,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

if TYPE_CHECKING:
    from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker


class WebhookService:
    """Service for managing webhook configuration and execution"""

    def __init__(
        self,
        webhooks_worker: Optional["WebhooksWorker"] = None,
    ):
        """
        Initialize the webhook service.

        Args:
            webhooks_worker: Optional webhooks worker instance for async task execution
        """
        self.webhooks_worker = webhooks_worker

    async def create_webhook(
        self,
        webhook_data: WebhookCreate,
        user_uid: str,
    ) -> WebhookResponse:
        """
        Create a new webhook configuration

        Args:
            webhook_data: Webhook creation data
            user_uid: User ID creating the webhook

        Returns:
            Created webhook response
        """
        async with engine.core_session() as session:
            # Verify project exists
            from oss.src.models.db_models import ProjectDB

            project_result = await session.execute(
                select(ProjectDB).filter_by(id=UUID(webhook_data.project_id))
            )
            project = project_result.scalars().first()
            if not project:
                raise ValueError("Project not found")

            # If app_id is provided, verify it exists and belongs to the project
            app = None
            if webhook_data.app_id:
                app_result = await session.execute(
                    select(AppDB).filter_by(id=UUID(webhook_data.app_id))
                )
                app = app_result.scalars().first()
                if not app:
                    raise ValueError("App not found")
                if str(app.project_id) != webhook_data.project_id:
                    raise ValueError("App does not belong to the specified project")

            # Create webhook
            webhook_db = WebhookDB(
                app_id=UUID(webhook_data.app_id) if webhook_data.app_id else None,
                project_id=UUID(webhook_data.project_id),
                name=webhook_data.name,
                description=webhook_data.description,
                is_enabled=webhook_data.is_enabled,
                webhook_type=webhook_data.webhook_type,
                # HTTP Webhook fields
                webhook_url=webhook_data.webhook_url,
                webhook_method=webhook_data.webhook_method,
                webhook_headers=[
                    {"key": h.key, "value": h.value, "is_secret": h.is_secret}
                    for h in webhook_data.webhook_headers
                ],
                webhook_body_template=webhook_data.webhook_body_template,
                # Python Script fields
                script_content=webhook_data.script_content,
                script_timeout=webhook_data.script_timeout,
                docker_image=webhook_data.docker_image,
                # Common fields
                environment_variables=[
                    {"key": env.key, "value": env.value, "is_secret": env.is_secret}
                    for env in webhook_data.environment_variables
                ],
                retry_on_failure=webhook_data.retry_on_failure,
                max_retries=webhook_data.max_retries,
                retry_delay_seconds=webhook_data.retry_delay_seconds,
                trigger_on_environments=webhook_data.trigger_on_environments,
            )

            session.add(webhook_db)
            await session.commit()
            await session.refresh(webhook_db)

            log.info(
                f"Webhook created",
                webhook_id=str(webhook_db.id),
                project_id=webhook_data.project_id,
                app_id=webhook_data.app_id,
                name=webhook_data.name,
            )

            return self._to_response(webhook_db)

    async def list_webhooks(
        self,
        project_id: str,
        app_id: Optional[str] = None,
    ) -> List[WebhookResponse]:
        """
        List all webhooks for a project

        Args:
            project_id: Project ID
            app_id: Optional App ID to filter by

        Returns:
            List of webhook responses
        """
        async with engine.core_session() as session:
            query = select(WebhookDB).filter_by(
                project_id=UUID(project_id)
            )

            # If app_id is provided, filter by it
            if app_id:
                query = query.filter(
                    (WebhookDB.app_id == UUID(app_id)) | (WebhookDB.app_id.is_(None))
                )

            query = query.order_by(WebhookDB.created_at.desc())

            result = await session.execute(query)
            webhooks = result.scalars().all()
            return [self._to_response(wh) for wh in webhooks]

    async def get_webhook(self, webhook_id: str) -> Optional[WebhookResponse]:
        """
        Get a single webhook by ID

        Args:
            webhook_id: Webhook ID

        Returns:
            Webhook response or None if not found
        """
        async with engine.core_session() as session:
            result = await session.execute(
                select(WebhookDB).filter_by(id=UUID(webhook_id))
            )
            webhook = result.scalars().first()
            if not webhook:
                return None
            return self._to_response(webhook)

    async def update_webhook(
        self,
        webhook_id: str,
        update_data: WebhookUpdate,
    ) -> Optional[WebhookResponse]:
        """
        Update an existing webhook

        Args:
            webhook_id: Webhook ID
            update_data: Update data

        Returns:
            Updated webhook response or None if not found
        """
        async with engine.core_session() as session:
            result = await session.execute(
                select(WebhookDB).filter_by(id=UUID(webhook_id))
            )
            webhook = result.scalars().first()
            if not webhook:
                return None

            # Update fields
            if update_data.name is not None:
                webhook.name = update_data.name
            if update_data.description is not None:
                webhook.description = update_data.description
            if update_data.webhook_type is not None:
                webhook.webhook_type = update_data.webhook_type

            # HTTP Webhook fields
            if update_data.webhook_url is not None:
                webhook.webhook_url = update_data.webhook_url
            if update_data.webhook_method is not None:
                webhook.webhook_method = update_data.webhook_method
            if update_data.webhook_headers is not None:
                webhook.webhook_headers = [
                    {"key": h.key, "value": h.value, "is_secret": h.is_secret}
                    for h in update_data.webhook_headers
                ]
            if update_data.webhook_body_template is not None:
                webhook.webhook_body_template = update_data.webhook_body_template

            # Python Script fields
            if update_data.script_content is not None:
                webhook.script_content = update_data.script_content
            if update_data.script_timeout is not None:
                webhook.script_timeout = update_data.script_timeout
            if update_data.docker_image is not None:
                webhook.docker_image = update_data.docker_image

            # Common fields
            if update_data.environment_variables is not None:
                webhook.environment_variables = [
                    {"key": env.key, "value": env.value, "is_secret": env.is_secret}
                    for env in update_data.environment_variables
                ]
            if update_data.retry_on_failure is not None:
                webhook.retry_on_failure = update_data.retry_on_failure
            if update_data.max_retries is not None:
                webhook.max_retries = update_data.max_retries
            if update_data.retry_delay_seconds is not None:
                webhook.retry_delay_seconds = update_data.retry_delay_seconds
            if update_data.trigger_on_environments is not None:
                webhook.trigger_on_environments = update_data.trigger_on_environments
            if update_data.is_enabled is not None:
                webhook.is_enabled = update_data.is_enabled

            webhook.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(webhook)

            log.info(f"Webhook updated", webhook_id=webhook_id)

            return self._to_response(webhook)

    async def delete_webhook(self, webhook_id: str) -> bool:
        """
        Delete a webhook

        Args:
            webhook_id: Webhook ID

        Returns:
            True if deleted, False if not found
        """
        async with engine.core_session() as session:
            result = await session.execute(
                select(WebhookDB).filter_by(id=UUID(webhook_id))
            )
            webhook = result.scalars().first()
            if not webhook:
                return False

            await session.delete(webhook)
            await session.commit()

            log.info(f"Webhook deleted", webhook_id=webhook_id)

            return True

    async def trigger_webhooks_for_deployment(
        self,
        app_id: str,
        environment_name: str,
        deployment_id: str,
        variant_id: str,
        variant_revision_id: str,
        project_id: str,
        app_slug: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        """
        Trigger webhooks after a successful deployment

        This method is called after deployment completion and creates
        execution records for matching webhooks, then sends tasks to
        the worker queue.

        Args:
            app_id: Application ID
            environment_name: Environment name (e.g., "production", "staging")
            deployment_id: Deployment ID
            variant_id: Variant ID
            variant_revision_id: Variant revision ID
            project_id: Project ID
            app_slug: Optional app slug (app_name)
            variant_slug: Optional variant slug (config_name)
            variant_version: Optional variant version (revision)
        """
        if not self.webhooks_worker:
            log.warning(
                "Webhooks worker not available, skipping webhook triggers",
                deployment_id=deployment_id,
            )
            return

        async with engine.core_session() as session:
            # Find enabled webhooks for this project
            # Webhooks can be project-wide (app_id is NULL) or app-specific
            result = await session.execute(
                select(WebhookDB).filter(
                    WebhookDB.project_id == UUID(project_id),
                    WebhookDB.is_enabled == True,
                )
            )
            webhooks = result.scalars().all()

            # Filter by app if webhook is app-specific
            triggered_webhooks = []
            for webhook in webhooks:
                # If webhook is app-specific, check if it matches the deployed app
                if webhook.app_id is not None:
                    if str(webhook.app_id) != app_id:
                        continue

                # Check environment trigger conditions
                if webhook.trigger_on_environments:
                    if environment_name not in webhook.trigger_on_environments:
                        continue

                triggered_webhooks.append(webhook)

            if not triggered_webhooks:
                log.info(f"No webhooks to trigger for deployment", deployment_id=deployment_id)
                return

            # Create execution records and send tasks
            for webhook in triggered_webhooks:
                execution = WebhookExecutionDB(
                    webhook_id=webhook.id,
                    deployment_id=UUID(deployment_id) if deployment_id else None,
                    environment_name=environment_name,
                    variant_id=UUID(variant_id) if variant_id else None,
                    variant_revision_id=UUID(variant_revision_id) if variant_revision_id else None,
                    status="pending",
                )

                session.add(execution)
                await session.flush()  # Get execution.id

                # Send task to worker
                try:
                    await self.webhooks_worker.execute_webhook_task.kiq(
                        execution_id=str(execution.id),
                        webhook_id=str(webhook.id),
                        deployment_context={
                            "app_id": app_id,
                            "app_slug": app_slug,
                            "environment_name": environment_name,
                            "deployment_id": deployment_id,
                            "variant_id": variant_id,
                            "variant_slug": variant_slug,
                            "variant_version": variant_version,
                            "variant_revision_id": variant_revision_id,
                            "project_id": project_id,
                        },
                    )

                    log.info(
                        f"Webhook triggered",
                        webhook_id=str(webhook.id),
                        webhook_name=webhook.name,
                        execution_id=str(execution.id),
                    )
                except Exception as e:
                    log.error(
                        f"Failed to queue webhook task",
                        webhook_id=str(webhook.id),
                        execution_id=str(execution.id),
                        error=str(e),
                    )
                    # Update execution status to failed
                    execution.status = "failed"
                    execution.error_output = f"Failed to queue task: {str(e)}"
                    execution.completed_at = datetime.now(timezone.utc)

            await session.commit()

    async def list_executions(
        self,
        webhook_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[WebhookExecutionResponse]:
        """
        List webhook execution history

        Args:
            webhook_id: Webhook ID
            limit: Max number of records
            offset: Number of records to skip

        Returns:
            List of execution responses
        """
        async with engine.core_session() as session:
            result = await session.execute(
                select(WebhookExecutionDB)
                .filter_by(webhook_id=UUID(webhook_id))
                .order_by(WebhookExecutionDB.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
            executions = result.scalars().all()
            return [self._to_execution_response(e) for e in executions]

    async def get_execution(self, execution_id: str) -> Optional[WebhookExecutionResponse]:
        """
        Get a single webhook execution

        Args:
            execution_id: Execution ID

        Returns:
            Execution response or None if not found
        """
        async with engine.core_session() as session:
            result = await session.execute(
                select(WebhookExecutionDB).filter_by(id=UUID(execution_id))
            )
            execution = result.scalars().first()
            if not execution:
                return None
            return self._to_execution_response(execution)

    def _to_response(self, webhook: WebhookDB) -> WebhookResponse:
        """Convert database model to API response"""
        return WebhookResponse(
            id=str(webhook.id),
            project_id=str(webhook.project_id),
            app_id=str(webhook.app_id) if webhook.app_id else None,
            name=webhook.name,
            description=webhook.description,
            webhook_type=webhook.webhook_type,
            is_enabled=webhook.is_enabled,
            # HTTP Webhook fields
            webhook_url=webhook.webhook_url,
            webhook_method=webhook.webhook_method,
            webhook_headers=[
                HttpHeader(
                    key=h["key"],
                    value=h["value"],
                    is_secret=h.get("is_secret", False),
                )
                for h in (webhook.webhook_headers or [])
            ],
            webhook_body_template=webhook.webhook_body_template,
            # Python Script fields
            script_timeout=webhook.script_timeout,
            docker_image=webhook.docker_image,
            # Common fields
            environment_variables=[
                EnvironmentVariable(
                    key=env["key"],
                    value=env["value"],
                    is_secret=env.get("is_secret", False),
                )
                for env in (webhook.environment_variables or [])
            ],
            retry_on_failure=webhook.retry_on_failure,
            max_retries=webhook.max_retries,
            retry_delay_seconds=webhook.retry_delay_seconds,
            trigger_on_environments=webhook.trigger_on_environments or [],
            created_at=webhook.created_at,
            updated_at=webhook.updated_at,
        )

    def _to_execution_response(self, execution: WebhookExecutionDB) -> WebhookExecutionResponse:
        """Convert database model to execution response"""
        return WebhookExecutionResponse(
            id=str(execution.id),
            webhook_id=str(execution.webhook_id),
            deployment_id=str(execution.deployment_id) if execution.deployment_id else None,
            environment_name=execution.environment_name,
            variant_id=str(execution.variant_id) if execution.variant_id else None,
            variant_revision_id=str(execution.variant_revision_id) if execution.variant_revision_id else None,
            status=execution.status,
            started_at=execution.started_at,
            completed_at=execution.completed_at,
            exit_code=execution.exit_code,
            output=execution.output,
            error_output=execution.error_output,
            container_id=execution.container_id,
            retry_count=execution.retry_count,
            is_retry=execution.is_retry,
            parent_execution_id=str(execution.parent_execution_id) if execution.parent_execution_id else None,
            created_at=execution.created_at,
        )


# Singleton instance
webhook_service = WebhookService()
