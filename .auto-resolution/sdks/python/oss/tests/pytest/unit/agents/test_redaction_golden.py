"""Known-value redaction golden fixture: pinned SDK <-> runner (mirror of the wire-contract
golden pattern in `test_wire_contract.py`). The TS side asserts the same file in
`services/runner/tests/unit/redaction-golden.test.ts`.
"""

from __future__ import annotations

import json
from pathlib import Path

from agenta.sdk.redaction import Redactor

GOLDEN_DIR = Path(__file__).parent / "golden"


def _load(name: str) -> dict:
    with open(GOLDEN_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def test_known_value_golden_matches_python_redactor():
    golden = _load("redaction.known_value.json")
    redactor = Redactor().with_known_secrets(golden["knownSecrets"])
    actual = redactor.redact_json(golden["input"])
    assert actual == golden["expected"]
