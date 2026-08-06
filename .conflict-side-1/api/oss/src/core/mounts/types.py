# Mount naming vocabulary. It lives here, below the service, because the protected-mount
# policy is enforced twice against the same rows — as a SQL predicate in the Postgres DAO
# and in Python in `MountsService` — and the two must not be able to drift apart.
RESERVED_SLUG_PREFIX = "__ag__"
SESSION_SLUG_PREFIX = f"{RESERVED_SLUG_PREFIX}session__"
ATTACHMENTS_MOUNT_NAME = "attachments"
ATTACHMENTS_MOUNT_PURPOSE = "session_attachment_originals"

# Backslash, so the escaped pattern below survives a `LIKE ... ESCAPE` round trip.
PROTECTED_MOUNT_SLUG_LIKE_ESCAPE = "\\"


def _escape_like(value: str) -> str:
    escaped = value.replace(
        PROTECTED_MOUNT_SLUG_LIKE_ESCAPE,
        PROTECTED_MOUNT_SLUG_LIKE_ESCAPE * 2,
    )
    for wildcard in ("%", "_"):
        escaped = escaped.replace(
            wildcard,
            f"{PROTECTED_MOUNT_SLUG_LIKE_ESCAPE}{wildcard}",
        )
    return escaped


def protected_mount_slug_like_pattern() -> str:
    """The `LIKE` pattern matching every attachments slug `mint_session_slug` can mint.

    The session uuid5 segment is the only wildcard; the literal underscores are escaped
    so they cannot match an arbitrary character.
    """
    return (
        f"{_escape_like(SESSION_SLUG_PREFIX)}%"
        f"{_escape_like(f'__{ATTACHMENTS_MOUNT_NAME}')}"
    )


class MountError(Exception):
    def __init__(self, message: str = "Mount error."):
        self.message = message
        super().__init__(message)


class MountNotFound(MountError):
    def __init__(self, message: str = "Mount not found."):
        super().__init__(message)


class MountSlugConflict(MountError):
    def __init__(
        self, message: str = "A mount with this slug already exists in the project."
    ):
        super().__init__(message)


class MountSlugReserved(MountError):
    def __init__(self, slug: str = "slug"):
        super().__init__(
            f"The slug prefix '__ag__' is reserved; choose a different slug than '{slug}'."
        )
        self.slug = slug


class MountNameInvalid(MountError):
    def __init__(self, name: str = "name"):
        super().__init__(
            f"Mount name '{name}' is not a canonical slug: use lowercase letters, digits, "
            "and single dashes (e.g. 'cwd', 'claude-projects')."
        )
        self.name = name


class MountArtifactIdInvalid(MountError):
    def __init__(self, artifact_id: str = "artifact_id"):
        super().__init__(f"Artifact id '{artifact_id}' must be a valid UUID.")
        self.artifact_id = artifact_id


class MountArtifactNotFound(MountError):
    def __init__(self, artifact_id: str = "artifact_id"):
        super().__init__(f"Artifact '{artifact_id}' was not found in this project.")
        self.artifact_id = artifact_id


class MountImmutableField(MountError):
    def __init__(self, field: str = "field"):
        super().__init__(f"Mount field '{field}' is immutable after creation.")
        self.field = field


class MountDataInvalid(MountError):
    def __init__(
        self, message: str = "Mount bucket or prefix contains invalid characters."
    ):
        super().__init__(message)


class MountPathInvalid(MountError):
    def __init__(
        self,
        message: str = "File path contains invalid characters or escapes the mount.",
    ):
        super().__init__(message)


class MountFileNotFound(MountError):
    def __init__(self, message: str = "No such file or folder."):
        super().__init__(message)


class MountStorageUnavailable(MountError):
    def __init__(self, message: str = "Mount storage backend is not configured."):
        super().__init__(message)


class MountProtected(MountError):
    def __init__(self, message: str = "Mount is protected."):
        super().__init__(message)
