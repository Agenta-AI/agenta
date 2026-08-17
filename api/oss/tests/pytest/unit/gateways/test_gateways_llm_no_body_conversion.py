"""Guard test for D34 (specs-wp24.md): no code path in the LLM plane parses a request body
except to read the policy fields. A grep-style guard, deliberately — this is the invariant a
future edit is most likely to break quietly (tasks-wp24.md Phase 2).

Every `json.loads(` call site under `core/gateways/llms/` is enumerated and justified below;
a new one anywhere else fails the test rather than silently reintroducing conversion.
"""

import re
from pathlib import Path

_LLM_PLANE_ROOT = Path(__file__).parents[4] / "src/core/gateways/llms"

# file (relative to _LLM_PLANE_ROOT) -> why its json.loads calls are not body conversion.
_ALLOWED = {
    # The policy parse itself: model/stream/ceiling extraction, read-only (D33, D34).
    "service.py",
    # Reads the RESPONSE body to lift `usage` for the audit record; the bytes yielded to
    # the caller are the bytes received, never reconstructed from this parse (D34).
    "providers/passthrough/adapter.py",
    # The mock is a test double, not a relay — it never forwards bytes anywhere, so
    # parsing its own input to fabricate a reply is not the conversion D34 forbids.
    "providers/mock/adapter.py",
    "providers/mock/app.py",
    # D40's carve-out: a literal per-deployment table (Vertex only, OD19), applied only
    # on the Messages door. Not conversion — nothing here is read to decide anything.
    "providers/passthrough/static_fields.py",
}

_JSON_LOADS = re.compile(r"\bjson\.loads\(")


def test_no_unexpected_json_loads_in_the_llm_plane():
    offenders = []
    for path in _LLM_PLANE_ROOT.rglob("*.py"):
        relative = path.relative_to(_LLM_PLANE_ROOT).as_posix()
        if not _JSON_LOADS.search(path.read_text()):
            continue
        if relative not in _ALLOWED:
            offenders.append(relative)

    assert not offenders, (
        f"json.loads found outside the allowed set: {offenders}. "
        "A new request-body parse in the LLM plane is the body conversion D34 forbids — "
        "add it to _ALLOWED only if it reads a RESPONSE body or the policy fields."
    )


def test_every_allowed_file_still_exists_and_still_parses_json():
    """The inverse check: an entry here that stops calling json.loads (e.g. a rewrite that
    drops the usage-extraction path) is worth noticing, not silently trusting."""
    for relative in _ALLOWED:
        path = _LLM_PLANE_ROOT / relative
        assert path.exists(), f"{relative} no longer exists — prune it from _ALLOWED"
        assert _JSON_LOADS.search(path.read_text()), (
            f"{relative} no longer calls json.loads — prune it from _ALLOWED"
        )
