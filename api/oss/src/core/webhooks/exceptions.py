class WebhookSubscriptionNotFoundError(Exception):
    def __init__(self, subscription_id: str):
        self.subscription_id = subscription_id
        message = f"Webhook subscription '{subscription_id}' not found"
        super().__init__(message)


class WebhookTestEventPublishFailedError(Exception):
    def __init__(
        self,
        *,
        event_id: str,
        subscription_id: str,
        message: str = "Failed to publish test event",
    ):
        self.event_id = event_id
        self.subscription_id = subscription_id
        self.message = message
        super().__init__(message)


class WebhookTestDeliveryTimeoutError(Exception):
    def __init__(
        self,
        *,
        event_id: str,
        subscription_id: str,
        attempts: int,
        message: str = "Timed out waiting for webhook delivery",
    ):
        self.event_id = event_id
        self.subscription_id = subscription_id
        self.attempts = attempts
        self.message = message
        super().__init__(message)
