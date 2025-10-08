from typing import Optional, Tuple
from json import loads

from oss.src.core.shared.dtos import (
    Flags,
    Tags,
    Meta,
)


def parse_metadata(
    flags: Optional[str] = None,
    tags: Optional[str] = None,
    meta: Optional[str] = None,
) -> Tuple[Optional[Flags], Optional[Tags], Optional[Meta],]:
    _flags = None
    try:
        _flags = loads(flags) if flags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    _tags = None
    try:
        _tags = loads(tags) if tags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    _meta = None
    try:
        _meta = loads(meta) if meta else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    return _flags, _tags, _meta
