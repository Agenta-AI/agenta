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


class SecretSlugConflict(SecretsError):
    """A secret already exists at this project and slug.

    The unique index `uq_secrets_project_id_slug` is what decides; this type is how that
    decision reaches a caller that addressed the row by a slug it derives rather than
    stores (the MCP OAuth grant and client registration, keyed by `uuid5` of the server
    URL). Such a caller responds by reading the winner and updating it, so the race
    resolves without either side locking in Python.
    """

    def __init__(self, *, slug: str):
        self.slug = slug
        super().__init__(
            f"A secret already exists with the slug {slug}. Choose another slug."
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


class ServerOwnedFieldNotWritable(SecretsError):
    """A create or update stated a field only the subscription login routes may set.

    Preservation on omission keeps a rename from resetting the sign-in state. It is not a
    write guard: an explicit value still reached the row and could rewind the generation
    or the state past the ordering rules.
    """

    def __init__(self, *, fields):
        self.fields = list(fields)
        listed = ", ".join(self.fields)
        super().__init__(
            f"These fields are set by the sign-in routes and cannot be written here: "
            f"{listed}. Omit them to keep the stored values."
        )


class SubscriptionProviderMismatch(SecretsError):
    """The route does not apply to this connection's provider.

    A ChatGPT connection signs in through the device login routes. A Claude connection takes
    a pasted token, which never refreshes, so it has no device login and nothing to push.
    """

    def __init__(self, *, provider: str):
        self.provider = provider
        super().__init__(
            f"This route does not apply to a {provider} subscription connection."
        )


class SubscriptionTokenError(SecretsError):
    """A pasted subscription token was not stored. Nothing on the row changed."""

    code: str
    retryable: bool
    next_step: str


class SubscriptionTokenRejected(SubscriptionTokenError):
    """The value is not a setup-token, or Anthropic refused it."""

    code = "subscription_token_rejected"
    retryable = False
    next_step = "Run `claude setup-token` again and paste the new token."

    def __init__(self, message: str = "Claude did not accept this token."):
        super().__init__(message)


class SubscriptionTokenUnverified(SubscriptionTokenError):
    """Anthropic could not be reached, or gave an answer that proves nothing."""

    code = "subscription_token_unverified"
    retryable = True
    next_step = "Try again in a moment."

    def __init__(self, message: str = "Agenta could not check this token with Claude."):
        super().__init__(message)
