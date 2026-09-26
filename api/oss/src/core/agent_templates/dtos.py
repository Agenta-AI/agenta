import re
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Discriminator,
    Field,
    Tag,
    field_validator,
    model_validator,
)

from oss.src.core.workflows.dtos import WorkflowRevisionData


class InternalTemplateSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["internal"] = "internal"
    key: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


_GITHUB_REPO_URL = re.compile(
    r"^https://github\.com/"
    r"(?P<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/"
    r"(?P<repo>[A-Za-z0-9._-]{1,100}?)(?:\.git)?/?$"
)
_FULL_COMMIT = re.compile(r"^[0-9a-fA-F]{40}$")
_ABBREVIATED_COMMIT = re.compile(r"^[0-9a-fA-F]{4,39}$")
_MAX_GITHUB_PATH_SEGMENTS = 32
_MAX_GITHUB_PATH_CHARACTERS = 1024
_COMMIT_INSTRUCTIONS = (
    "Supply the full 40-character commit SHA the branch, tag or pull request head "
    "points to (for example the output of `git rev-parse <ref>`)."
)


class GitHubTemplateSource(BaseModel):
    """A package directory in a public GitHub repository at one exact commit.

    Branches, tags and abbreviated SHAs are rejected, never resolved: the caller
    resolves a mutable revision before loading, so the backend fetches only
    immutable content.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["github"] = "github"
    repo_url: str = Field(max_length=256)
    commit: str
    path: str = Field(max_length=_MAX_GITHUB_PATH_CHARACTERS)

    @model_validator(mode="before")
    @classmethod
    def reject_mutable_revision_fields(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for field in ("ref", "branch", "tag"):
                if field in value:
                    raise ValueError(
                        f"'{field}' is not supported; GitHub templates load from "
                        f"'commit' only. {_COMMIT_INSTRUCTIONS}"
                    )
        return value

    @field_validator("repo_url")
    @classmethod
    def normalize_repo_url(cls, value: str) -> str:
        match = _GITHUB_REPO_URL.match(value.strip())
        if not match or match.group("repo") in {".", ".."}:
            raise ValueError(
                "repo_url must be a public repository URL of the form "
                "https://github.com/<owner>/<repo>."
            )
        # GitHub owner and repository names are case-insensitive.
        return (
            f"https://github.com/{match.group('owner')}/{match.group('repo')}".lower()
        )

    @field_validator("commit")
    @classmethod
    def require_full_commit(cls, value: str) -> str:
        value = value.strip()
        if _FULL_COMMIT.match(value):
            return value.lower()
        if _ABBREVIATED_COMMIT.match(value):
            raise ValueError(
                f"commit {value!r} looks like an abbreviated SHA, which is not "
                f"accepted. {_COMMIT_INSTRUCTIONS}"
            )
        raise ValueError(
            f"commit {value!r} is not a commit SHA; a branch or tag name is not "
            f"accepted. {_COMMIT_INSTRUCTIONS}"
        )

    @field_validator("path")
    @classmethod
    def require_package_directory(cls, value: str) -> str:
        normalized = value[:-1] if value.endswith("/") else value
        parts = normalized.split("/")
        if (
            not normalized
            or normalized.startswith("/")
            or "\\" in normalized
            or any(ord(char) < 32 for char in normalized)
            or any(part in {"", ".", ".."} for part in parts)
            or len(parts) > _MAX_GITHUB_PATH_SEGMENTS
        ):
            raise ValueError(
                "path must name the package directory as a relative path inside "
                "the repository, such as 'packages/my-template/1.0.0'."
            )
        return PurePosixPath(normalized).as_posix()

    @property
    def owner(self) -> str:
        return self.repo_url.split("/")[3]

    @property
    def repo(self) -> str:
        return self.repo_url.split("/")[4]


class TemplateSourcePin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1, max_length=128)
    digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class UploadTemplateSource(BaseModel):
    """A zip the user uploaded as a staged session attachment.

    Attachments are immutable once ready (the row keeps a content digest), so the
    reference itself pins the bytes.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["upload"] = "upload"
    staging_session_id: str = Field(min_length=1, max_length=256)
    attachment_id: UUID


class SessionFileTemplateSource(BaseModel):
    """A zip in a session's working directory, such as one an agent wrote in chat.

    The file is mutable, so load requires the pin that validation returned and
    rejects bytes that no longer match it.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["session_file"] = "session_file"
    session_id: str = Field(min_length=1, max_length=256)
    path: str = Field(min_length=1, max_length=1024)
    pin: TemplateSourcePin | None = None


ArchiveTemplateSource = UploadTemplateSource | SessionFileTemplateSource


def _source_kind(value: Any) -> str:
    # Callers that predate the source union send an internal key without a kind.
    if isinstance(value, dict):
        return value.get("kind", "internal")
    return getattr(value, "kind", "internal")


TemplateSource = Annotated[
    Annotated[InternalTemplateSource, Tag("internal")]
    | Annotated[UploadTemplateSource, Tag("upload")]
    | Annotated[SessionFileTemplateSource, Tag("session_file")]
    | Annotated[GitHubTemplateSource, Tag("github")],
    Discriminator(_source_kind),
]


class ResolvedTemplateSource(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    source: TemplateSource
    root: Path
    version: str
    digest: str
    # The package's own plugin name. Archive sources have no catalog key.
    package_key: str | None = None

    @property
    def key(self) -> str:
        if isinstance(self.source, InternalTemplateSource):
            return self.source.key
        if not self.package_key:
            raise ValueError("A staged template source needs its package key.")
        return self.package_key


class GatewayTemplateChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_key: str
    kind: Literal["gateway"]
    provider: str
    integration: str


class MCPTemplateChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_key: str
    kind: Literal["mcp"]
    server: str


class SkipTemplateChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_key: str
    kind: Literal["skip"]


TemplateConnectionChoice = Annotated[
    GatewayTemplateChoice | MCPTemplateChoice | SkipTemplateChoice,
    Field(discriminator="kind"),
]


class TemplateLoadCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: TemplateSource
    base_revision: WorkflowRevisionData
    ui_build_kit_enabled: bool = False
    ui_disabled_ops: list[str] = Field(default_factory=list, max_length=128)
    ui_op_permissions: dict[str, Literal["allow", "ask"]] = Field(
        default_factory=dict, max_length=128
    )
    staging_session_id: str | None = Field(default=None, min_length=1, max_length=256)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=10)
    initial_message: str
    connection_choices: list[TemplateConnectionChoice] = Field(default_factory=list)
    request_key: str


class TemplateLoadResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: UUID
    workflow_slug: str
    variant_id: UUID
    revision_id: UUID
    session_id: str
    execution_id: str
    input_id: UUID
    replayed: bool


class TemplateValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    # Package-relative file, and the manifest field inside it when one applies.
    path: str | None = None
    field: str | None = None
    message: str
    next_step: str | None = None


class TemplateValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid: bool
    version: str | None = None
    digest: str | None = None
    supported_schema_versions: list[str]
    issues: list[TemplateValidationIssue] = Field(default_factory=list)
