import hashlib
import json
from pathlib import Path

import build_snapshot


BUILD_SCRIPT = Path(build_snapshot.__file__).resolve()
FINGERPRINT_FILE = BUILD_SCRIPT.with_name("sandbox-recipe-fingerprint.json")


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _canonical(spec: object) -> bytes:
    return json.dumps(spec, sort_keys=True, separators=(",", ":")).encode()


def recipe_fingerprint() -> str:
    # Every file the build script embeds into the snapshot counts as a recipe input, not only the
    # script itself. A change to one of them without a version bump would rebuild the live name.
    payload = {
        "build_script_sha256": _sha256(BUILD_SCRIPT.read_bytes()),
        "install_script_sha256": _sha256(build_snapshot.INSTALL_SCRIPT),
        "agent_requirements_sha256": _sha256(build_snapshot.AGENT_REQUIREMENTS),
        "codex_acp_patch_sha256": _sha256(_canonical(build_snapshot.PATCH_SPEC)),
        "pi_cost_patch_sha256": _sha256(_canonical(build_snapshot.PI_COST_PATCH_SPEC)),
        "pi_version": build_snapshot.PI_VERSION,
        "codex_version": build_snapshot.CODEX_ACP_VERSION,
        "claude_version": build_snapshot.CLAUDE_ACP_VERSION,
    }

    return _sha256(_canonical(payload))


def test_sandbox_recipe_fingerprint_is_current() -> None:
    recorded = json.loads(FINGERPRINT_FILE.read_text())

    actual = recipe_fingerprint()

    assert recorded["fingerprint"] == actual, (
        "Sandbox recipe inputs changed without bumping the sandbox recipe version. "
        "Update services/runner/config/sandbox-recipe.json to the "
        "new recipe version and regenerate sandbox-recipe-fingerprint.json."
    )
