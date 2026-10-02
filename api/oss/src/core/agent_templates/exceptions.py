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


class TemplateSourceUnavailable(AgentTemplateError):
    """A remote source is missing, private or temporarily unreachable."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        details: dict | None = None,
    ) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(message, details=details)


class TemplatePackageInvalid(AgentTemplateError):
    def __init__(self, code: str, message: str, *, details: dict | None = None) -> None:
        self.code = code
        super().__init__(message, details=details)


class TemplateCreateConflict(AgentTemplateError):
    code = "template_create_conflict"

    def __init__(self) -> None:
        super().__init__(
            "The request key is already bound to a different template load request.",
        )


class TemplateSkillCreationFailed(AgentTemplateError):
    code = "template_skill_creation_failed"
    retryable = True

    def __init__(self, skill_name: str) -> None:
        super().__init__(
            "A template skill workflow could not be created.",
            details={"skill_name": skill_name},
        )


class TemplateWorkflowCreationFailed(AgentTemplateError):
    code = "template_workflow_creation_failed"
    retryable = True

    def __init__(self) -> None:
        super().__init__("The agent workflow could not be created.")


class TemplateProvenanceInvalid(AgentTemplateError):
    code = "template_provenance_invalid"

    def __init__(self) -> None:
        super().__init__("Stored template provenance has an invalid shape.")
