import subprocess
import sys
from pathlib import Path


GENERATED_MODEL = """from typing import Any, Dict, Optional

import pydantic


class ProviderCredentials:
    \"\"\"
    Credentials in transit only. Never persisted here, never logged, never echoed.

    `key` is a `SecretStr` and `extras` is kept out of `repr`, so an accidental log line
    or traceback that carries this object cannot print the credential. Unwrap the key with
    `.get_secret_value()` at the point it is put on the wire, never earlier.
    \"\"\"

    key: typing.Optional[str] = None
    url: typing.Optional[str] = None
    extras: typing.Optional[typing.Dict[str, typing.Any]] = None
"""


def test_generation_hook_hides_plain_credential_fields(tmp_path: Path):
    generated_file = tmp_path / "provider_credentials.py"
    generated_file.write_text(GENERATED_MODEL)
    helper = Path(__file__).parents[2] / "scripts" / "protect_provider_credentials.py"

    subprocess.run([sys.executable, str(helper), str(generated_file)], check=True)

    protected = generated_file.read_text()
    assert "SecretStr" not in protected
    assert ".get_secret_value()" not in protected
    assert (
        "key: typing.Optional[str] = pydantic.Field(default=None, repr=False)"
        in protected
    )
    assert (
        "extras: typing.Optional[typing.Dict[str, typing.Any]] = pydantic.Field("
        in protected
    )


def test_generation_hook_fails_loudly_when_fern_shape_changes(tmp_path: Path):
    generated_file = tmp_path / "provider_credentials.py"
    generated_file.write_text(
        GENERATED_MODEL.replace("key: typing.Optional[str]", "key: str")
    )
    helper = Path(__file__).parents[2] / "scripts" / "protect_provider_credentials.py"

    result = subprocess.run(
        [sys.executable, str(helper), str(generated_file)],
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert (
        "Expected exactly one generated ProviderCredentials key field" in result.stderr
    )
