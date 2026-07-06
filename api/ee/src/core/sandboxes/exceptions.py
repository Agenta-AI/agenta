class SandboxMeteringError(Exception):
    pass


class SandboxWebhookSignatureError(SandboxMeteringError):
    def __init__(self, message: str = "Webhook signature verification failed."):
        self.message = message
        super().__init__(message)
