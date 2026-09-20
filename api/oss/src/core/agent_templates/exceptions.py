class AgentTemplateError(Exception):
    code = "agent_template_error"
    retryable = False

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        self.message = message
        self.details = details or {}
        super().__init__(message)


class TemplateSourceNotFound(AgentTemplateError):
    code = "template_source_not_found"

    def __init__(self, source: str) -> None:
        super().__init__(
            "The requested template source was not found.",
            details={"source": source},
        )


class TemplateSourceDigestMismatch(AgentTemplateError):
    code = "template_source_digest_mismatch"

    def __init__(self, key: str, version: str) -> None:
        super().__init__(
            "The pinned template source no longer matches its recorded digest.",
            details={"key": key, "version": version},
        )


class TemplateSourceInvalid(AgentTemplateError):
    def __init__(self, code: str, message: str, *, details: dict | None = None) -> None:
        self.code = code
        super().__init__(message, details=details)
