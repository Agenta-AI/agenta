from typing import List, Optional


class StorePreconditionFailed(Exception):
    """A conditional write/delete (`If-Match` / `If-None-Match: *`) was refused by the store.

    `current_etag` is the object's etag at the time of the check, or None when the object does
    not exist (an `If-Match` against a missing key)."""

    def __init__(self, current_etag: Optional[str] = None):
        self.current_etag = current_etag
        super().__init__("Object store precondition failed.")


class StoreDeleteFailed(Exception):
    """The store refused to delete some keys. The caller must not act as if they are gone."""

    def __init__(self, failed_keys: List[str]):
        self.failed_keys = failed_keys
        super().__init__(f"Object store could not delete {len(failed_keys)} key(s).")
