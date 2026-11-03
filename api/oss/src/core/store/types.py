from typing import Optional


class StorePreconditionFailed(Exception):
    """A conditional write/delete (`If-Match` / `If-None-Match: *`) was refused by the store.

    `current_etag` is the object's etag at the time of the check, or None when the object does
    not exist (an `If-Match` against a missing key)."""

    def __init__(self, current_etag: Optional[str] = None):
        self.current_etag = current_etag
        super().__init__("Object store precondition failed.")


class StoreObjectTooLarge(Exception):
    """A bounded read refused an object larger than the caller's `max_bytes` limit."""

    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        super().__init__(f"Object is larger than {max_bytes} bytes.")
