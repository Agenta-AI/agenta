"""Webhook worker for executing post-deployment webhooks"""

import asyncio
import json
from typing import Any, Dict, Optional
from datetime import datetime, timezone
from uuid import UUID

import docker
from docker.errors import DockerException, APIError
from taskiq import AsyncBroker

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.models.db_models import WebhookDB, WebhookExecutionDB
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class WebhooksWorker:
    """
    Worker class for webhook execution tasks.

    This worker executes Python scripts in Docker containers after deployments,
    following the same pattern as EvaluationsWorker.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
    ):
        """
        Initialize the webhooks worker.

        Args:
            broker: The Taskiq broker to register tasks with
        """
        self.broker = broker
        self._docker_client: Optional[docker.DockerClient] = None

        self._register_tasks()

    def _get_docker_client(self) -> docker.DockerClient:
        """Get or create Docker client"""
        if self._docker_client is None:
            try:
                self._docker_client = docker.from_env()
            except DockerException as e:
                log.error(f"Failed to create Docker client: {e}")
                raise
        return self._docker_client

    def _register_tasks(self):
        """Register all webhook tasks with the broker."""

        @self.broker.task(
            task_name="webhooks.execute",
            retry_on_error=False,
            max_retries=0,  # Handle retries in application logic
        )
        async def execute_webhook_task(
            *,
            execution_id: str,
            webhook_id: str,
            deployment_context: Dict[str, Any],
        ) -> Any:
            """
            Execute a webhook script in a Docker container.

            Args:
                execution_id: Webhook execution ID
                webhook_id: Webhook ID
                deployment_context: Deployment information including app_id, environment, etc.

            Returns:
                Execution result
            """
            log.info(
                "[WEBHOOK] Starting execution",
                execution_id=execution_id,
                webhook_id=webhook_id,
            )

            result = await self._execute_webhook(
                execution_id=execution_id,
                webhook_id=webhook_id,
                deployment_context=deployment_context,
            )

            log.info("[WEBHOOK] Completed execution", execution_id=execution_id)
            return result

        # Store task reference for external access
        self.execute_webhook_task = execute_webhook_task

    async def _execute_webhook(
        self,
        *,
        execution_id: str,
        webhook_id: str,
        deployment_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Execute webhook script and update execution record.

        Args:
            execution_id: Webhook execution ID
            webhook_id: Webhook ID
            deployment_context: Deployment context information

        Returns:
            Execution result dict
        """
        async with engine.core_session() as session:
            from sqlalchemy import select

            # Get webhook and execution records
            webhook_result = await session.execute(
                select(WebhookDB).filter_by(id=UUID(webhook_id))
            )
            webhook = webhook_result.scalars().first()

            if not webhook:
                log.error(f"[WEBHOOK] Webhook not found", webhook_id=webhook_id)
                return {"status": "error", "message": "Webhook not found"}

            execution_result = await session.execute(
                select(WebhookExecutionDB).filter_by(id=UUID(execution_id))
            )
            execution = execution_result.scalars().first()

            if not execution:
                log.error(f"[WEBHOOK] Execution not found", execution_id=execution_id)
                return {"status": "error", "message": "Execution not found"}

            # Update execution status to running
            execution.status = "running"
            execution.started_at = datetime.now(timezone.utc)
            await session.commit()

            # Prepare environment variables
            environment_vars = {
                **{
                    env["key"]: env["value"]
                    for env in (webhook.environment_variables or [])
                },
                # Add deployment context as environment variables
                "AGENTA_DEPLOYMENT_APP_ID": deployment_context.get("app_id", ""),
                "AGENTA_DEPLOYMENT_ENVIRONMENT": deployment_context.get(
                    "environment_name", ""
                ),
                "AGENTA_DEPLOYMENT_DEPLOYMENT_ID": deployment_context.get(
                    "deployment_id", ""
                ),
                "AGENTA_DEPLOYMENT_VARIANT_ID": deployment_context.get("variant_id", ""),
                "AGENTA_DEPLOYMENT_VARIANT_REVISION_ID": deployment_context.get(
                    "variant_revision_id", ""
                ),
                "AGENTA_DEPLOYMENT_PROJECT_ID": deployment_context.get("project_id", ""),
            }

            # Create script file content
            script_content = webhook.script_content

            try:
                # Execute in Docker container
                output, error_output, exit_code = await asyncio.to_thread(
                    self._run_in_docker,
                    script_content=script_content,
                    docker_image=webhook.docker_image,
                    environment_vars=environment_vars,
                    timeout=webhook.script_timeout,
                )

                # Update execution with results
                execution.status = "success" if exit_code == 0 else "failed"
                execution.output = output
                execution.error_output = error_output
                execution.exit_code = exit_code
                execution.completed_at = datetime.now(timezone.utc)

                await session.commit()

                log.info(
                    f"[WEBHOOK] Execution completed",
                    execution_id=execution_id,
                    status=execution.status,
                    exit_code=exit_code,
                )

                # Handle retries if failed
                if exit_code != 0 and webhook.retry_on_failure:
                    await self._handle_retry(
                        webhook=webhook,
                        execution=execution,
                        deployment_context=deployment_context,
                    )

                return {
                    "status": execution.status,
                    "exit_code": exit_code,
                    "output": output,
                }

            except asyncio.TimeoutError:
                execution.status = "timeout"
                execution.error_output = f"Script execution timed out after {webhook.script_timeout} seconds"
                execution.completed_at = datetime.now(timezone.utc)
                await session.commit()

                log.error(
                    f"[WEBHOOK] Execution timed out",
                    execution_id=execution_id,
                    timeout=webhook.script_timeout,
                )

                # Handle retries on timeout
                if webhook.retry_on_failure:
                    await self._handle_retry(
                        webhook=webhook,
                        execution=execution,
                        deployment_context=deployment_context,
                    )

                return {"status": "timeout", "message": "Execution timed out"}

            except Exception as e:
                execution.status = "failed"
                execution.error_output = str(e)
                execution.completed_at = datetime.now(timezone.utc)
                await session.commit()

                log.error(
                    f"[WEBHOOK] Execution failed with exception",
                    execution_id=execution_id,
                    error=str(e),
                    exc_info=True,
                )

                # Handle retries on exception
                if webhook.retry_on_failure:
                    await self._handle_retry(
                        webhook=webhook,
                        execution=execution,
                        deployment_context=deployment_context,
                    )

                return {"status": "error", "message": str(e)}

    def _run_in_docker(
        self,
        script_content: str,
        docker_image: str,
        environment_vars: Dict[str, str],
        timeout: int,
    ) -> tuple[str, str, int]:
        """
        Run script in Docker container.

        Args:
            script_content: Python script content to execute
            docker_image: Docker image to use
            environment_vars: Environment variables to inject
            timeout: Timeout in seconds

        Returns:
            Tuple of (stdout, stderr, exit_code)

        Raises:
            asyncio.TimeoutError: If execution times out
            DockerException: If Docker execution fails
        """
        client = self._get_docker_client()

        # Pull image if not exists
        try:
            client.images.get(docker_image)
        except docker.errors.ImageNotFound:
            log.info(f"[WEBHOOK] Pulling Docker image: {docker_image}")
            client.images.pull(docker_image)

        # Create and run container
        container = None
        try:
            container = client.containers.create(
                image=docker_image,
                command=["python", "-c", script_content],
                environment=environment_vars,
                network_disabled=False,  # Allow network access
                mem_limit="512m",  # Limit memory usage
                cpu_quota=100000,  # Limit CPU usage
                cpu_period=100000,
            )

            # Start container with timeout
            container.start()

            # Wait for completion with timeout
            status = container.wait(timeout=timeout)

            # Get logs
            output = container.logs(stdout=True, stderr=False).decode("utf-8", errors="replace")
            error_output = container.logs(stderr=True).decode("utf-8", errors="replace")

            exit_code = status["StatusCode"]

            return output, error_output, exit_code

        finally:
            # Clean up container
            if container:
                try:
                    container.remove(force=True)
                except Exception as e:
                    log.warning(f"[WEBHOOK] Failed to remove container: {e}")

    async def _handle_retry(
        self,
        webhook: WebhookDB,
        execution: WebhookExecutionDB,
        deployment_context: Dict[str, Any],
    ):
        """
        Handle webhook retry logic.

        Args:
            webhook: Webhook configuration
            execution: Failed execution record
            deployment_context: Deployment context
        """
        if execution.retry_count >= webhook.max_retries:
            log.info(
                f"[WEBHOOK] Max retries reached",
                execution_id=str(execution.id),
                retry_count=execution.retry_count,
                max_retries=webhook.max_retries,
            )
            return

        # Calculate retry delay
        import asyncio

        await asyncio.sleep(webhook.retry_delay_seconds)

        # Create retry execution
        retry_execution = WebhookExecutionDB(
            webhook_id=webhook.id,
            deployment_id=execution.deployment_id,
            environment_name=execution.environment_name,
            variant_id=execution.variant_id,
            variant_revision_id=execution.variant_revision_id,
            status="pending",
            retry_count=execution.retry_count + 1,
            is_retry=True,
            parent_execution_id=execution.id,
        )

        async with engine.core_session() as session:
            session.add(retry_execution)
            await session.flush()  # Get execution.id

            # Send retry task
            try:
                await self.execute_webhook_task.kiq(
                    execution_id=str(retry_execution.id),
                    webhook_id=str(webhook.id),
                    deployment_context=deployment_context,
                )

                log.info(
                    f"[WEBHOOK] Retry scheduled",
                    original_execution_id=str(execution.id),
                    retry_execution_id=str(retry_execution.id),
                    retry_count=retry_execution.retry_count,
                )
            except Exception as e:
                log.error(
                    f"[WEBHOOK] Failed to schedule retry",
                    execution_id=str(retry_execution.id),
                    error=str(e),
                )
                retry_execution.status = "failed"
                retry_execution.error_output = f"Failed to schedule retry: {str(e)}"
                retry_execution.completed_at = datetime.now(timezone.utc)

            await session.commit()
