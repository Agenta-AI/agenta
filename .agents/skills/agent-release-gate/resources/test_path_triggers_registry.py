# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27", "pytest>=8"]
# ///
"""Every journey and cell a path rule names must exist, or `--release-base` refuses to start.

Run either way:

    uv run test_path_triggers_registry.py
    uv run --no-sync pytest test_path_triggers_registry.py
"""

import importlib
import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


def _import(name):
    os.environ.setdefault("AGENTA_BASE", "https://qa.example")
    os.environ.setdefault("AGENTA_PROJECT_ID", "proj-1")
    os.environ.setdefault("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(HERE))
    return importlib.import_module(name)


qa = _import("qa_product")
triggers = _import("path_triggers")


def test_every_journey_a_path_rule_names_exists():
    named = {
        j for journeys in triggers.PATH_TRIGGER_JOURNEYS.values() for j in journeys
    }
    assert sorted(named - set(qa.JOURNEYS)) == []


def test_every_cell_a_path_rule_names_exists():
    named = {c for cells in triggers.PATH_TRIGGERS.values() for c in cells}
    missing = [c for c in named if c not in qa.CELLS and not (HERE / c).exists()]
    assert sorted(missing) == []


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q", "-p", "no:cacheprovider"]))
