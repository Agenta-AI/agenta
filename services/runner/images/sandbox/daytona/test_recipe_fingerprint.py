import hashlib
import json
from pathlib import Path

import build_snapshot


BUILD_SCRIPT = Path(build_snapshot.__file__).resolve()
FINGERPRINT_FILE = BUILD_SCRIPT.with_name("sandbox-recipe-fingerprint.json")


def recipe_fingerprint() -> str:
    payload = {
        "build_script_sha256": hashlib.sha256(BUILD_SCRIPT.read_bytes()).hexdigest(),
        "recipe_version": build_snapshot.SANDBOX_RECIPE_VERSION,
        "pi_version": build_snapshot.PI_VERSION,
        "codex_version": build_snapshot.CODEX_ACP_VERSION,
        "claude_version": build_snapshot.CLAUDE_ACP_VERSION,
    }

    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canonical).hexdigest()


def test_recipe_version_is_part_of_fingerprint(monkeypatch) -> None:
    original = recipe_fingerprint()

    monkeypatch.setattr(
        build_snapshot,
        "SANDBOX_RECIPE_VERSION",
        build_snapshot.SANDBOX_RECIPE_VERSION + 1,
    )

    assert recipe_fingerprint() != original


def test_sandbox_recipe_fingerprint_is_current() -> None:
    recorded = json.loads(FINGERPRINT_FILE.read_text())

    actual = recipe_fingerprint()

    assert recorded["fingerprint"] == actual, (
        "Sandbox recipe inputs changed without bumping the sandbox recipe version. "
        "Update services/runner/config/sandbox-recipe.json to the "
        "new recipe version and regenerate sandbox-recipe-fingerprint.json."
    )
