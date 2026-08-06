class WebhookAuthorizationSecretRequiredError(Exception):
    def __init__(
        self,
        *,
        message: str = "A secret is required when auth_mode is 'authorization'",
    ):
        self.message = message

        super().__init__(message)


class WebhookSubscriptionNotFoundError(Exception):
    def __init__(
        self,
        *,
        subscription_id: str,
    ):
        self.subscription_id = subscription_id

        message = f"Webhook subscription '{subscription_id}' not found"

        super().__init__(message)
