#!/usr/bin/env python3
"""Keep generated provider credentials serializable without displaying their values."""

from pathlib import Path
import sys


OLD_DOC = """    Credentials in transit only. Never persisted here, never logged, never echoed.

    `key` is a `SecretStr` and `extras` is kept out of `repr`, so an accidental log line
    or traceback that carries this object cannot print the credential. Unwrap the key with
    `.get_secret_value()` at the point it is put on the wire, never earlier.
"""
NEW_DOC = """    Credentials sent to provider probe endpoints.

    ``key`` and ``extras`` remain plain wire values so Fern can serialize them. Both fields
    are excluded from this model's display representation to reduce accidental disclosure.
"""

REPLACEMENTS = (
    ("docstring", OLD_DOC, NEW_DOC),
    (
        "key field",
        "    key: typing.Optional[str] = None",
        "    key: typing.Optional[str] = pydantic.Field(default=None, repr=False)",
    ),
    (
        "extras field",
        "    extras: typing.Optional[typing.Dict[str, typing.Any]] = None",
        """    extras: typing.Optional[typing.Dict[str, typing.Any]] = pydantic.Field(
        default=None, repr=False
    )""",
    ),
)


def protect_provider_credentials(path: Path) -> None:
    source = path.read_text()

    for label, old, new in REPLACEMENTS:
        count = source.count(old)
        if count != 1:
            raise RuntimeError(
                f"Expected exactly one generated ProviderCredentials {label}; found {count}"
            )
        source = source.replace(old, new)

    path.write_text(source)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: protect_provider_credentials.py PATH")

    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"Generated ProviderCredentials model not found: {path}")

    protect_provider_credentials(path)


if __name__ == "__main__":
    main()
