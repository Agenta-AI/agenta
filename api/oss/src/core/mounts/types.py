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
