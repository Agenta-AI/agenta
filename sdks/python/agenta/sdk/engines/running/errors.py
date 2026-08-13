from typing import Optional, Any, List

ERRORS_BASE_URL = "https://agenta.ai/docs/misc/errors"


class ErrorStatus(Exception):
    code: int
    type: str
    message: str
    stacktrace: Optional[str] = None

    def __init__(
        self,
        code: int,
        type: str,
        message: str,
        stacktrace: Optional[str] = None,
    ):
        super().__init__()
        self.code = code
        self.type = type
        self.message = message
        self.stacktrace = stacktrace

    def __str__(self):
        return f"{self.message}\n\nError {self.code} | {self.type}"

    def __repr__(self):
        return f"ErrorStatus(code={self.code}, type='{self.type}', message='{self.message}')"


class InvalidInterfaceURIV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:interface:invalid-uri"

    def __init__(self, got: Any):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid uri:\nExpected (see registry)\nGot '{got}'.",
        )


class InvalidConfigurationParametersV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-parameters"

    def __init__(self, expected: Any, got: Any):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid parameters:\nExpected '{expected}'\nGot ('{type(got).__name__}') '{got}'.",
        )


class MissingConfigurationParameterV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-parameter"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing parameter:\nAt '{path}'",
        )


class InvalidConfigurationParameterV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-parameter"

    def __init__(self, path: str, expected: Any, got: Any):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid parameter:\nAt '{path}'\nExpected '{expected}'\nGot ('{type(got).__name__}') '{got}'.",
        )


class InvalidInputsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-inputs"

    def __init__(self, expected: Any, got: Any):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid inputs:\nExpected '{expected}'\nGot ('{type(got).__name__}') '{got}'.",
        )


class MissingInputV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-input"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing input:\nAt '{path}'",
        )


class InvalidInputV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-input"

    def __init__(self, path: str, expected: Any, got: Any):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid input:\nAt '{path}'\nExpected '{expected}'\nGot ('{type(got).__name__}') '{got}'.",
        )


class InvalidOutputsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-outputs"

    def __init__(self, expected: Any, got: Any):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid outputs:\nExpected '{expected}'\nGot ('{type(got).__name__}') '{got}'.",
        )


class MissingOutputV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-output"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing output:\nAt '{path}'",
        )


class InvalidSecretsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-secrets"

    def __init__(self, expected: Any, got: Any, model: Optional[str] = None):
        if got is None and model:
            message = (
                f"No API key found for model '{model}'. "
                f"Please add your provider's API key in Settings > Providers & Models."
            )
        else:
            message = (
                f"Invalid secrets:\n"
                f"Expected '{expected}'\n"
                f"Got ('{type(got).__name__}') '{got}'."
            )
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
        )


class UnknownConnectionV0Error(ErrorStatus):
    """A configuration names a connection slug the vault has no record for.

    Failing loud beats falling back to the provider family: the user asked for one specific
    credential, and silently running on another connection's key is a billing surprise. It is a
    configuration mistake, not a server fault, so it carries a 4xx and no stacktrace.
    """

    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:unknown-connection"

    def __init__(self, slug: str, known: Optional[List[str]] = None):
        self.slug = slug
        self.known = known or []
        # Slugs only — a connection's key never reaches the message.
        known_hint = (
            f" Known connections: {', '.join(self.known)}." if self.known else ""
        )
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"No provider connection named '{slug}'.{known_hint}",
        )


class ConnectionModelMismatchV0Error(ErrorStatus):
    """A connection slug selects a credential from one provider family for another's model.

    Running it would hand the provider someone else's key and come back as an opaque downstream
    401, so it fails here instead, naming both families.
    """

    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:connection-model-mismatch"

    def __init__(
        self, slug: str, connection_family: str, model: str, model_family: str
    ):
        super().__init__(
            code=self.code,
            type=self.type,
            message=(
                f"Connection '{slug}' provides '{connection_family}' credentials, "
                f"which cannot run model '{model}' ('{model_family}')."
            ),
        )


class MissingSecretV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-secret"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing secrets:\nAt '{path}'",
        )


class JSONDiffV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:json-diff-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class LevenshteinDistanceV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:levenshtein-distance-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class SyntacticSimilarityV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:syntactic-similarity-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class SemanticSimilarityV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:semantic-similarity-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class WebhookServerV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:custom-hook-server-error"

    def __init__(self, code: int, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=code or self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class WebhookClientV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:custom-hook-client-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class CustomHookHandlerNotDefinedV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:custom-hook-handler-not-defined"

    def __init__(self) -> None:
        super().__init__(
            code=self.code,
            type=self.type,
            message=(
                "Custom hook has no handler. Define a local handler on the workflow, "
                "or set remote=True to forward to its configured url."
            ),
        )


class CustomCodeServerV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:custom-code-server-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class RegexPatternV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:regex-pattern-error"

    def __init__(self, pattern: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid regex pattern: '{pattern}'.",
        )


class PromptFormattingV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:prompt-formatting-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class PromptCompletionV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:prompt-completion-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class HookV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:hook-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class MatchV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:match-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class CodeV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:code-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class MockV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:mock-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class SnippetV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:snippet-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class FeedbackV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:feedback-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class PromptV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:prompt-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class AgentV0Error(ErrorStatus):
    code: int = 501
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:agent-not-implemented"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class LLMUnavailableV0Error(ErrorStatus):
    code: int = 503
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:llm-unavailable"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class LLMV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:llm-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class ForceNotSupportedV0Error(ErrorStatus):
    """`flags.force=true` before take-over semantics exist (specs.md); maps to HTTP 406."""

    code: int = 406
    type: str = f"{ERRORS_BASE_URL}#v0:workflows:force-not-supported"

    def __init__(self, message: str = "flags.force is not supported yet"):
        super().__init__(code=self.code, type=self.type, message=message)
