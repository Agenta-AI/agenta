"""Webhook worker for executing post-deployment webhooks"""

import asyncio
import json
import re
from typing import Any, Dict, Optional
from datetime import datetime, timezone
from uuid import UUID

import docker
import httpx
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
                # Verify connection works
                self._docker_client.ping()
            except Exception as e:
                error_msg = str(e)
                log.error(
                    f"[WEBHOOK] Failed to connect to Docker daemon: {error_msg}",
                    details=(
                        "Possible causes:\n"
                        "1. Docker daemon is not running (run 'docker info' to check)\n"
                        "2. Docker socket is not accessible (usually at /var/run/docker.sock)\n"
                        "3. If running in a container, Docker socket must be mounted with -v /var/run/docker.sock:/var/run/docker.sock"
                    ),
                )
                raise DockerException(
                    f"Cannot connect to Docker daemon. Please ensure Docker is running and accessible. Error: {error_msg}"
                ) from e
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

            # Route to appropriate execution method based on webhook type
            if webhook.webhook_type == "http_webhook":
                return await self._execute_http_webhook(
                    webhook=webhook,
                    execution=execution,
                    deployment_context=deployment_context,
                )
            elif webhook.webhook_type == "python_script":
                return await self._execute_python_script(
                    webhook=webhook,
                    execution=execution,
                    deployment_context=deployment_context,
                )
            else:
                execution.status = "failed"
                execution.error_output = f"Unknown webhook type: {webhook.webhook_type}"
                execution.completed_at = datetime.now(timezone.utc)
                await session.commit()
                return {"status": "error", "message": f"Unknown webhook type: {webhook.webhook_type}"}

    async def _execute_http_webhook(
        self,
        webhook: WebhookDB,
        execution: WebhookExecutionDB,
        deployment_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Execute HTTP webhook request.

        Args:
            webhook: Webhook configuration
            execution: Execution record
            deployment_context: Deployment context information

        Returns:
            Execution result dict
        """
        async with engine.core_session() as session:
            try:
                # Prepare headers
                headers = {
                    "Content-Type": "application/json",
                    **{
                        h["key"]: h["value"]
                        for h in (webhook.webhook_headers or [])
                    }
                }

                # Prepare body with template substitution
                body = None
                if webhook.webhook_body_template:
                    body_str = webhook.webhook_body_template

                    # Substitute template variables
                    template_vars = {
                        "app_id": deployment_context.get("app_id", ""),
                        "app_slug": deployment_context.get("app_slug", ""),
                        "environment": deployment_context.get("environment_name", ""),
                        "deployment_id": deployment_context.get("deployment_id", ""),
                        "variant_id": deployment_context.get("variant_id", ""),
                        "variant_slug": deployment_context.get("variant_slug", ""),
                        "variant_version": deployment_context.get("variant_version", ""),
                        "variant_revision_id": deployment_context.get("variant_revision_id", ""),
                        "project_id": deployment_context.get("project_id", ""),
                    }

                    # Replace {{var}} patterns
                    for key, value in template_vars.items():
                        body_str = body_str.replace(f"{{{{{key}}}}}", str(value))

                    body = json.loads(body_str) if body_str else None

                # Execute HTTP request
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.request(
                        method=webhook.webhook_method or "POST",
                        url=webhook.webhook_url,
                        headers=headers,
                        json=body,
                    )

                # Update execution with results
                execution.status = "success" if 200 <= response.status_code < 300 else "failed"
                execution.output = response.text
                execution.exit_code = 0 if 200 <= response.status_code < 300 else 1
                execution.completed_at = datetime.now(timezone.utc)

                await session.commit()

                log.info(
                    f"[WEBHOOK] HTTP webhook executed",
                    webhook_id=str(webhook.id),
                    status_code=response.status_code,
                    execution_id=str(execution.id),
                )

                # Handle retries if failed
                if execution.status == "failed" and webhook.retry_on_failure:
                    await self._handle_retry(
                        webhook=webhook,
                        execution=execution,
                        deployment_context=deployment_context,
                    )

                return {
                    "status": execution.status,
                    "status_code": response.status_code,
                    "output": response.text,
                }

            except httpx.TimeoutException:
                execution.status = "timeout"
                execution.error_output = "HTTP request timed out"
                execution.completed_at = datetime.now(timezone.utc)
                await session.commit()

                log.error(f"[WEBHOOK] HTTP webhook timed out", execution_id=str(execution.id))

                # Handle retries on timeout
                if webhook.retry_on_failure:
                    await self._handle_retry(
                        webhook=webhook,
                        execution=execution,
                        deployment_context=deployment_context,
                    )

                return {"status": "timeout", "message": "HTTP request timed out"}

            except Exception as e:
                execution.status = "failed"
                execution.error_output = str(e)
                execution.completed_at = datetime.now(timezone.utc)
                await session.commit()

                log.error(
                    f"[WEBHOOK] HTTP webhook failed",
                    execution_id=str(execution.id),
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

    async def _execute_python_script(
        self,
        webhook: WebhookDB,
        execution: WebhookExecutionDB,
        deployment_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Execute Python script in Docker container.

        Args:
            webhook: Webhook configuration
            execution: Execution record
            deployment_context: Deployment context information

        Returns:
            Execution result dict
        """
        async with engine.core_session() as session:
            # Prepare environment variables
            environment_vars = {
                **{
                    env["key"]: env["value"]
                    for env in (webhook.environment_variables or [])
                },
                # Add deployment context as environment variables
                "AGENTA_DEPLOYMENT_APP_ID": deployment_context.get("app_id", ""),
                "AGENTA_DEPLOYMENT_APP_SLUG": deployment_context.get("app_slug", ""),
                "AGENTA_DEPLOYMENT_ENVIRONMENT": deployment_context.get(
                    "environment_name", ""
                ),
                "AGENTA_DEPLOYMENT_DEPLOYMENT_ID": deployment_context.get(
                    "deployment_id", ""
                ),
                "AGENTA_DEPLOYMENT_VARIANT_ID": deployment_context.get("variant_id", ""),
                "AGENTA_DEPLOYMENT_VARIANT_SLUG": deployment_context.get("variant_slug", ""),
                "AGENTA_DEPLOYMENT_VARIANT_VERSION": str(deployment_context.get("variant_version", "")),
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
                    f"[WEBHOOK] Python script execution completed",
                    execution_id=str(execution.id),
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
                    f"[WEBHOOK] Script execution timed out",
                    execution_id=str(execution.id),
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
                    f"[WEBHOOK] Script execution failed with exception",
                    execution_id=str(execution.id),
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
