from enum import Enum


class StorageProvider(str, Enum):
    S3 = "s3"
    SEAWEEDFS = "seaweedfs"


class StorageError(Exception):
    pass


class StorageQuotaExceeded(StorageError):
    def __init__(self, org_id, bytes_used: int, bytes_limit: int):
        self.org_id = org_id
        self.bytes_used = bytes_used
        self.bytes_limit = bytes_limit
        super().__init__(
            f"Storage quota exceeded for org {org_id}: {bytes_used} >= {bytes_limit}"
        )
