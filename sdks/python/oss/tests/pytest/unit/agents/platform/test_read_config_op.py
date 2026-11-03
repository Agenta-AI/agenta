"""The `read_config` catalog entry (slice S2).

`read_config` and ordered operations are one feature, the read-then-edit loop.

The check runs in a subprocess rather than against the already-imported module graph, so
it sees the catalog exactly as a fresh process builds it.
"""

import json
import subprocess
import sys

import pytest

_PROBE = """
import json
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS

present = "read_config" in PLATFORM_OPS
out = {"present": present}
if present:
    op = PLATFORM_OPS["read_config"]
    schema = op.resolved_input_schema()
    out.update(
        read_only=op.read_only,
        path=op.path,
        method=op.method,
        handler=op.handler,
        bindings=sorted(op.context_bindings),
        top_keys=sorted(schema["properties"]),
        target_keys=sorted(schema["properties"]["target"]["properties"]),
        description=op.description,
        timeout_ms=op.timeout_ms,
    )
print(json.dumps(out))
"""


def _catalog():
    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def catalog_on():
    return _catalog()


class TestPresence:
    def test_the_op_is_present(self, catalog_on):
        assert catalog_on["present"] is True


class TestCatalogEntry:
    def test_it_is_a_read(self, catalog_on):
        assert catalog_on["read_only"] is True

    def test_it_dispatches_to_the_handler_not_a_public_route(self, catalog_on):
        # There is no public read-config endpoint any more: every detail of it was
        # agent-shaped and no second consumer existed, so the logic moved behind a
        # registered handler reached through the generic /tools/call.
        assert catalog_on["handler"] == "tools.agenta.read_config"
        assert catalog_on["method"] is None
        assert catalog_on["path"] is None

    def test_it_carries_a_timeout(self, catalog_on):
        assert catalog_on["timeout_ms"] == 15000


class TestBindings:
    def test_it_binds_the_variant_and_the_draft_flag(self, catalog_on):
        assert catalog_on["bindings"] == [
            "target.run_is_draft",
            "target.workflow_variant_id",
        ]

    def test_both_bindings_are_hidden_from_the_model(self, catalog_on):
        # A bound field the model could set would let it retarget another variant, or
        # claim it is not on a draft run. `description` is the ephemeral per-call note in
        # its tolerated second position, which the runner lifts out and never sends.
        assert catalog_on["target_keys"] == ["description", "path"]

    def test_it_binds_no_revision_id(self, catalog_on):
        # `$ctx.workflow.revision.id` does not resolve on a draft run, and an unresolved
        # binding is a hard failure, so binding it would break the exact run that needs
        # the draft answer most (read-config.md 2.1).
        assert "target.run_revision_id" not in catalog_on["bindings"]


class TestModelSurface:
    def test_the_model_sets_only_the_path_and_the_limit(self, catalog_on):
        assert catalog_on["top_keys"] == ["description", "max_bytes", "target"]

    def test_the_description_teaches_the_loop(self, catalog_on):
        text = catalog_on["description"]
        assert "base_revision_id" in text
        assert "409" in text

    def test_the_description_states_the_refusal(self, catalog_on):
        text = catalog_on["description"]
        assert "children" in text
        assert "never shortened" in text
