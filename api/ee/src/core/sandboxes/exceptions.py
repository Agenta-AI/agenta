class SandboxMeteringError(Exception):
    pass


class SandboxWebhookSignatureError(SandboxMeteringError):
    def __init__(self, message: str = "Webhook signature verification failed."):
        self.message = message
        super().__init__(message)


class SandboxWebhookRegistrationError(SandboxMeteringError):
    def __init__(self, message: str = "Failed to register sandbox webhook."):
        self.message = message
        super().__init__(message)
