"""Domain exceptions for the vault, raised by the core layer and mapped at the router."""


class SecretsError(Exception):
    """Base class for vault domain failures."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class SubscriptionProviderConflict(SecretsError):
    """A project already holds a subscription connection for this provider."""

    def __init__(self, provider: str):
        self.provider = provider
        super().__init__(
            f"This project already has a {provider} subscription connection. "
            "Remove it before you add another one."
        )


class SubscriptionSecretNotFound(SecretsError):
    """The addressed secret does not exist, or is not a subscription connection."""

    def __init__(
        self,
        message: str = "Subscription connection not found.",
    ):
        super().__init__(message)


class SubscriptionLoginAttemptNotFound(SecretsError):
    """The addressed login attempt is not the one this connection is waiting on.

    An attempt id is only ever polled through the connection that started it. That binding
    is what stops one project from reading another project's device login.
    """

    def __init__(
        self,
        message: str = "Login attempt not found. Start a new sign-in.",
    ):
        super().__init__(message)


class SubscriptionLoginRunnerNotConfigured(SecretsError):
    """This deployment has no agent runner, so no device login can run."""

    def __init__(
        self,
        message: str = (
            "Subscription sign-in needs an agent runner. Set AGENTA_RUNNER_INTERNAL_URL "
            "and AGENTA_RUNNER_TOKEN on the API."
        ),
    ):
        super().__init__(message)


class SubscriptionLoginRunnerUnavailable(SecretsError):
    """The agent runner did not answer, or answered with an error."""

    def __init__(
        self,
        message: str = "The agent runner is not reachable. Try the sign-in again.",
    ):
        super().__init__(message)
