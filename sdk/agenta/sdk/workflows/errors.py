from typing import Optional, Any

ERRORS_BASE_URL = "https://agenta.ai/docs/errors"


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
        return f"[EVAL]       {self.code} - {self.message} ({self.type})" + (
            f"\nStacktrace: {self.stacktrace}" if self.stacktrace else ""
        )

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

    def __init__(self, expected: Any, got: Any):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid secrets:\nExpected '{expected}'\nGot ('{type(got).__name__}') '{got}'.",
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
