from typing import Optional

ERRORS_BASE_URL = "https://docs.agenta.ai/errors"


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


class InvalidParametersV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-parameters"

    def __init__(self, expected: str, got: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid parameters: type must be {expected}, got {got}.",
        )


class InvalidParameterPathV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-parameter"

    def __init__(self, path: str, expected: str, got: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid parameter at '{path}': expected type {expected}, got {got}.",
        )


class MissingParametersPathV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-parameters-path"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing parameters path: '{path}'.",
        )


class InvalidInputsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-inputs"

    def __init__(self, expected: str, got: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid inputs: type must be '{expected}', got '{got}'.",
        )


class MissingInputsPathV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-inputs-path"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing inputs path: '{path}'",
        )


class InvalidTraceOutputsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-trace-outputs"

    def __init__(self, expected: str, got: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid trace outputs: expected type '{expected}', got '{got}'.",
        )


class MissingTraceOutputsPathV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-trace-outputs-path"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing trace outputs path: '{path}'",
        )


class InvalidOutputsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-outputs"

    def __init__(self, expected: str, got: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid outputs: type must be '{expected}', got '{got}'.",
        )


class MissingOutputsPathV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-outputs-path"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing outputs path: '{path}'",
        )


class InvalidCredentialsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-credentials"

    def __init__(self, expected: str, got: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid credentials: type must be '{expected}', got '{got}'.",
        )


class InvalidSecretsV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:invalid-secrets"

    def __init__(self, expected: str, got: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid secrets: type must be '{expected}', got '{got}'.",
        )


class MissingSecretsPathV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:missing-secrets-path"

    def __init__(self, path: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Missing secrets path: '{path}'",
        )


class WebhookServerV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:webhook:server-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class WebhookClientV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:webhook:client-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class CustomCodeServerV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:code:server-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=message,
            stacktrace=stacktrace,
        )


class RegexPatternV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:regex-pattern-error"

    def __init__(self, pattern: str):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Invalid regex pattern: '{pattern}'.",
        )


class PromptFormattingV0Error(ErrorStatus):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:prompt-formatting-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Prompt formatting error: {message}.",
            stacktrace=stacktrace,
        )


class PromptCompletionV0Error(ErrorStatus):
    code: int = 500
    type: str = f"{ERRORS_BASE_URL}#v0:schemas:prompt-completion-error"

    def __init__(self, message: str, stacktrace: Optional[str] = None):
        super().__init__(
            code=self.code,
            type=self.type,
            message=f"Prompt completion error: {message}.",
            stacktrace=stacktrace,
        )
