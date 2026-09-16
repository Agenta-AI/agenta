"""The generated client must install wherever the rest of the repository does.

`clients/scripts/generate.sh` writes the client's `pyproject.toml` from scratch on every
run, so the floor in that heredoc, and not the one in the committed file, is what the
next regeneration ships. This branch raised it to 3.12 while the API, the SDK and the
committed client all declare 3.11, which would have made a 3.11 install unsatisfiable
the moment anyone regenerated (M6).

Checked by reading the files rather than by regenerating: regeneration needs an Agenta
deployment to read the OpenAPI document from, which a unit test has no business needing.
"""

import re
import tomllib
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_GENERATOR = _REPO / "clients" / "scripts" / "generate.sh"
_FLOOR = re.compile(r'requires-python\s*=\s*"([^"]+)"')


def _declared_floor(pyproject: Path) -> str:
    return tomllib.loads(pyproject.read_text())["project"]["requires-python"]


def _generator_floor() -> str:
    matches = _FLOOR.findall(_GENERATOR.read_text())
    assert len(matches) == 1, f"expected one requires-python line, found {matches}"
    return matches[0]


def test_the_generator_writes_the_floor_the_repository_declares():
    expected = _declared_floor(_REPO / "api" / "pyproject.toml")

    assert _generator_floor() == expected


def test_every_python_package_here_agrees_on_the_floor():
    """A client that cannot install beside the SDK that calls it is not usable."""
    floors = {
        package: _declared_floor(_REPO / package / "pyproject.toml")
        for package in ("api", "sdks/python", "clients/python")
    }

    assert len(set(floors.values())) == 1, floors
