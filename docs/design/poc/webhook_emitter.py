"""
POC: Webhook Event Emitter for Agenta PR Automation

This demonstrates how Agenta would emit webhook events when deployments occur.
This is the backend component that would be integrated into the deployment service.
"""

import asyncio
import hmac
import hashlib
import json
from datetime import datetime
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
import httpx


@dataclass
class WebhookConfig:
    """Webhook configuration (stored in database)"""
    id: str
    project_id: str
    name: str
    url: str
    secret: str
    events: List[str]
    active: bool = True


@dataclass
class DeploymentEvent:
    """Deployment event data"""
    project_id: str
    app_name: str
    variant_name: str
    variant_id: str
    environment: str
    revision: int
    commit_message: Optional[str]
    config_diff: Dict[str, Any]
    deployed_by: str
    deployment_id: str


class EventEmitter:
    """
    Emits events to registered webhooks.

    This would be integrated into Agenta's deployment service to automatically
    send events when deployments occur.
    """

    def __init__(self):
        self.webhooks_db = {}  # In real implementation, this would be database
        self.delivery_log = []

    async def emit(
        self,
        event_type: str,
        payload: DeploymentEvent,
    ):
        """
        Emit event to all registered webhooks for the project.

        Args:
            event_type: Type of event (e.g., "environment.deployed")
            payload: Event data
        """
        print(f"📤 Emitting event: {event_type}")
        print(f"   Project: {payload.project_id}")
        print(f"   App: {payload.app_name}")
        print(f"   Environment: {payload.environment}")

        # Get webhooks for this project and event type
        webhooks = self._get_webhooks(payload.project_id, event_type)

        if not webhooks:
            print(f"⚠️  No webhooks configured for {event_type}")
            return

        # Deliver to all webhooks concurrently
        tasks = [
            self._deliver_webhook(webhook, event_type, payload)
            for webhook in webhooks
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Log results
        for webhook, result in zip(webhooks, results):
            if isinstance(result, Exception):
                print(f"❌ Webhook {webhook.name} failed: {result}")
            else:
                print(f"✅ Webhook {webhook.name} delivered successfully")

    async def _deliver_webhook(
        self,
        webhook: WebhookConfig,
        event_type: str,
        payload: DeploymentEvent,
    ):
        """
        Deliver webhook to a single endpoint.

        Includes:
        - Signature generation for security
        - Retry logic for failures
        - Delivery logging
        """
        # Construct delivery payload
        delivery_payload = {
            "event": event_type,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "delivery_id": f"delivery_{datetime.utcnow().timestamp()}",
            "project_id": payload.project_id,
            "data": {
                "app_name": payload.app_name,
                "variant_name": payload.variant_name,
                "variant_id": payload.variant_id,
                "environment": payload.environment,
                "revision": payload.revision,
                "commit_message": payload.commit_message,
                "config_diff": payload.config_diff,
                "deployed_by": payload.deployed_by,
                "deployment_id": payload.deployment_id,
            }
        }

        # Generate signature for verification
        signature = self._sign_payload(delivery_payload, webhook.secret)

        # Prepare headers
        headers = {
            "Content-Type": "application/json",
            "X-Agenta-Event": event_type,
            "X-Agenta-Signature": signature,
            "X-Agenta-Delivery": delivery_payload["delivery_id"],
            "User-Agent": "Agenta-Webhook/1.0"
        }

        # Deliver with retry logic
        max_retries = 3
        retry_delay = 1  # seconds

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(
                        webhook.url,
                        json=delivery_payload,
                        headers=headers
                    )

                    # Log delivery
                    self._log_delivery(
                        webhook_id=webhook.id,
                        event_type=event_type,
                        status_code=response.status_code,
                        success=response.is_success,
                        attempt=attempt + 1
                    )

                    if response.is_success:
                        return response

                    # If not successful and not last attempt, retry
                    if attempt < max_retries - 1:
                        await asyncio.sleep(retry_delay * (2 ** attempt))
                    else:
                        raise Exception(f"HTTP {response.status_code}: {response.text}")

            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"⚠️  Attempt {attempt + 1} failed, retrying: {e}")
                    await asyncio.sleep(retry_delay * (2 ** attempt))
                else:
                    # Log failure
                    self._log_delivery(
                        webhook_id=webhook.id,
                        event_type=event_type,
                        status_code=None,
                        success=False,
                        attempt=attempt + 1,
                        error=str(e)
                    )
                    raise

    def _sign_payload(self, payload: Dict, secret: str) -> str:
        """
        Create HMAC signature for payload verification.

        The webhook receiver should verify this signature to ensure
        the request came from Agenta.
        """
        message = json.dumps(payload, sort_keys=True)
        signature = hmac.new(
            secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return f"sha256={signature}"

    def _get_webhooks(self, project_id: str, event_type: str) -> List[WebhookConfig]:
        """Get webhooks configured for this project and event type"""
        # In real implementation, this would query the database
        return [
            w for w in self.webhooks_db.get(project_id, [])
            if w.active and event_type in w.events
        ]

    def _log_delivery(
        self,
        webhook_id: str,
        event_type: str,
        status_code: Optional[int],
        success: bool,
        attempt: int,
        error: Optional[str] = None
    ):
        """Log delivery for audit trail"""
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "webhook_id": webhook_id,
            "event_type": event_type,
            "status_code": status_code,
            "success": success,
            "attempt": attempt,
            "error": error
        }
        self.delivery_log.append(log_entry)
        # In real implementation, this would be stored in database

    def register_webhook(self, webhook: WebhookConfig):
        """Register a webhook (for POC demonstration)"""
        if webhook.project_id not in self.webhooks_db:
            self.webhooks_db[webhook.project_id] = []
        self.webhooks_db[webhook.project_id].append(webhook)
        print(f"✅ Registered webhook: {webhook.name} for project {webhook.project_id}")


# ============================================================================
# Example Integration into Deployment Service
# ============================================================================

async def deploy_to_environment(
    environment_name: str,
    variant_name: str,
    config: Dict[str, Any],
    project_id: str,
    app_name: str,
    commit_message: Optional[str] = None,
    deployed_by: str = "user@example.com",
    event_emitter: EventEmitter = None
):
    """
    Example deployment function showing how webhook emission would be integrated.

    This demonstrates how the existing deployment service would be modified
    to emit events.
    """
    print(f"\n🚀 Deploying {variant_name} to {environment_name}...")

    # Existing deployment logic would go here
    # ... perform actual deployment ...

    # Simulate deployment completion
    deployment_id = f"deploy_{datetime.utcnow().timestamp()}"
    revision = 15

    # Compute config diff (in real implementation, compare with previous revision)
    config_diff = {
        "added": {},
        "modified": {
            "temperature": {
                "old": 0.7,
                "new": config.get("temperature", 0.7)
            },
            "system_prompt": {
                "old": "You are a helpful assistant",
                "new": config.get("system_prompt", "You are a helpful assistant")
            }
        },
        "removed": {}
    }

    print(f"✅ Deployment successful!")

    # NEW: Emit deployment event
    if event_emitter and environment_name == "production":
        print(f"\n📢 Triggering webhook event...")

        event = DeploymentEvent(
            project_id=project_id,
            app_name=app_name,
            variant_name=variant_name,
            variant_id=f"variant_{app_name}",
            environment=environment_name,
            revision=revision,
            commit_message=commit_message,
            config_diff=config_diff,
            deployed_by=deployed_by,
            deployment_id=deployment_id
        )

        await event_emitter.emit("environment.deployed", event)

    return deployment_id


# ============================================================================
# POC Demonstration
# ============================================================================

async def main():
    """
    Demonstrate the webhook system in action.

    This shows:
    1. Registering a webhook
    2. Deploying to production
    3. Automatic webhook delivery
    """
    print("=" * 70)
    print("POC: Agenta Webhook Event Emitter")
    print("=" * 70)

    # Initialize event emitter
    emitter = EventEmitter()

    # Register a webhook (simulating user configuration)
    webhook = WebhookConfig(
        id="webhook_123",
        project_id="project_abc",
        name="GitHub PR Creator",
        url="http://localhost:3000/webhook",  # User's webhook handler
        secret="my_webhook_secret_key",
        events=["environment.deployed"],
        active=True
    )

    emitter.register_webhook(webhook)

    # Simulate a deployment
    config = {
        "model": "gpt-4",
        "temperature": 0.5,
        "max_tokens": 500,
        "system_prompt": "You are a helpful customer support assistant. Be concise and professional."
    }

    await deploy_to_environment(
        environment_name="production",
        variant_name="v2-optimized",
        config=config,
        project_id="project_abc",
        app_name="customer-support-bot",
        commit_message="Improved response quality and reduced temperature",
        deployed_by="jane@company.com",
        event_emitter=emitter
    )

    print("\n" + "=" * 70)
    print("📊 Delivery Log:")
    print("=" * 70)
    for entry in emitter.delivery_log:
        print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    # Run the POC
    try:
        asyncio.run(main())
    except httpx.ConnectError:
        print("\n⚠️  Note: Webhook delivery failed because no server is running at localhost:3000")
        print("   This is expected for the POC. See webhook_handler_example.py for the server side.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
