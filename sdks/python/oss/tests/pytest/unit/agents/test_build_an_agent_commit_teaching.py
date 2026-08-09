"""The ``build-an-agent`` skill teaches the commit shape the deployment actually serves.

The skill body and its ``references/config-schema.md`` are assembled at import from
``AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED``, exactly like the op catalog assembles the
``commit_revision`` description and input schema. The two must agree: an agent that reads the
ordered form in its tool description and the legacy form in its skill picks between them from
call to call. That is not a theory — a live agent followed a `delta.set` example out of this
skill against an ordered-operations deployment, sent a one-entry ``skills`` list, and replaced
the user's existing skill.

So these tests read the skill in BOTH flag states (a subprocess each, since the flag is read at
import) and assert that neither state ever mentions the other's shape.
"""

import json
import os
import re
import subprocess
import sys

import jsonschema
import pytest

FLAG = "AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED"

_PROBE = """
import json
from agenta.sdk.agents.adapters.agenta_builtins import BUILD_AN_AGENT_SKILL
from agenta.sdk.agents.platform.op_catalog import get_platform_op

print(json.dumps({
    "body": BUILD_AN_AGENT_SKILL.body,
    "files": {f.path: f.content for f in BUILD_AN_AGENT_SKILL.files},
    "commit_schema": get_platform_op("commit_revision").resolved_input_schema(),
}))
"""

# Every spelling of the legacy commit shape. The skill is the model's copy-paste source, so one
# of these surviving into an ordered deployment is the incident again.
LEGACY_COMMIT_MARKERS = ("delta.set", "delta.remove", "wholesale", "replaces the old")


def _skill(flag_value):
    env = dict(os.environ)
    if flag_value is None:
        env.pop(FLAG, None)
    else:
        env[FLAG] = flag_value
    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        capture_output=True,
        text=True,
        env=env,
        check=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def ordered():
    return _skill("true")


@pytest.fixture(scope="module")
def legacy():
    # Explicitly off: ordered operations are the default now, so an unset variable is the
    # ordered state, not this one.
    return _skill("false")


def _commit_surface(skill):
    """The two files that teach how a commit is made."""
    return {
        "SKILL.md": skill["body"],
        "references/config-schema.md": skill["files"]["references/config-schema.md"],
    }


def _example_payloads(config_schema):
    """The JSON blocks under `## Example requests` that are whole `commit_revision` calls."""
    section = config_schema.split("## Example requests", 1)[1]
    blocks = re.findall(r"```json\n(.*?)```", section, flags=re.DOTALL)
    payloads = [json.loads(block) for block in blocks]
    return [p for p in payloads if isinstance(p, dict) and "workflow_revision" in p]


class TestOrderedModeNeverTeachesTheLegacyShape:
    """The class detector for the data-loss incident."""

    @pytest.mark.parametrize("marker", LEGACY_COMMIT_MARKERS)
    def test_the_commit_surface_never_names_the_legacy_delta(self, ordered, marker):
        for name, content in _commit_surface(ordered).items():
            assert marker not in content, (
                f"{name} still teaches the legacy commit shape ({marker!r}) while the "
                "deployment serves ordered operations; a model that sees both shapes picks "
                "one unpredictably"
            )

    def test_no_example_writes_a_commit_message(self, ordered):
        # With ordered operations on, the server derives the message from the operations and
        # `message` is off the model-visible schema entirely. An example that writes one earns
        # a schema rejection on a closed object.
        config_schema = ordered["files"]["references/config-schema.md"]
        assert '"message"' not in config_schema

    def test_a_playbook_may_name_delta_set_only_for_test_run(self, ordered):
        # `test_run` keeps its uncommitted `delta.set` in both flag states, and the playbooks
        # legitimately name it. Anywhere else, in any bundled file, it is the legacy commit.
        for path, content in ordered["files"].items():
            if path == "references/config-schema.md":
                continue
            for line in content.splitlines():
                if "delta.set" in line or "delta.remove" in line:
                    assert "test_run" in line, (
                        f"{path} names a commit delta outside a test_run context: {line!r}"
                    )


class TestOrderedModeTeachesTheOrderedShape:
    @pytest.mark.parametrize(
        "phrase",
        ["read_config", "base_revision_id", "delta.operations"],
    )
    def test_the_skill_body_teaches_the_read_then_commit_loop(self, ordered, phrase):
        assert phrase in ordered["body"]

    @pytest.mark.parametrize(
        "operation",
        [
            "set",
            "merge",
            "remove",
            "edit_text",
            "add_item",
            "replace_item",
            "remove_item",
        ],
    )
    def test_the_reference_documents_every_operation(self, ordered, operation):
        assert f"`{operation}`" in ordered["files"]["references/config-schema.md"]

    @pytest.mark.parametrize(
        "failure",
        ["409", "target_not_found", "text_not_unique", "output_too_large", "next_step"],
    )
    def test_the_reference_documents_the_ordered_failure_modes(self, ordered, failure):
        assert failure in ordered["files"]["references/config-schema.md"]

    def test_the_examples_cover_the_cases_an_agent_actually_commits(self, ordered):
        # The five things a builder agent does: rewrite its instructions, add a skill, edit a
        # skill it already has, drop one, and wire a tool. Each is one operation on one target
        # tail, which is what the model copies.
        payloads = _example_payloads(ordered["files"]["references/config-schema.md"])
        shapes = set()
        for payload in payloads:
            for operation in payload["workflow_revision"]["delta"]["operations"]:
                tail = operation["target"][-1]
                shapes.add((operation["operation"], json.dumps(tail, sort_keys=True)))
        assert ("set", '"agents_md"') in shapes
        assert ("add_item", '"skills"') in shapes
        assert ("add_item", '"tools"') in shapes
        assert ("edit_text", '"body"') in shapes
        assert (
            "remove_item",
            '{"key": "code-review-checklist", "list": "skills"}',
        ) in (shapes)

    def test_an_unset_flag_teaches_the_ordered_shape(self):
        # The default is what a fresh deployment serves, so it is what the skill has to
        # teach. Asserted separately from the `ordered` fixture, which sets the variable:
        # a default that drifted back to legacy would leave that fixture green.
        default = _skill(None)
        assert "delta.operations" in default["body"]
        for name, content in _commit_surface(default).items():
            assert "delta.set" not in content, (
                f"{name} teaches the legacy commit shape on a default deployment"
            )

    def test_every_example_validates_against_the_real_commit_schema(self, ordered):
        # Field for field against what the catalog advertises: the schema is closed at every
        # level, so an invented field, a `message`, or a missing `base_revision_id` fails here.
        schema = ordered["commit_schema"]
        payloads = _example_payloads(ordered["files"]["references/config-schema.md"])
        assert len(payloads) == 5
        for payload in payloads:
            jsonschema.validate(payload, schema)


class TestLegacyModeKeepsTheLegacyTeaching:
    """The mirror: a flag-off deployment really does work the legacy way."""

    def test_the_reference_still_teaches_the_delta_merge_semantics(self, legacy):
        config_schema = legacy["files"]["references/config-schema.md"]
        assert "## How a delta commits (merge semantics)" in config_schema
        assert "delta.set" in config_schema
        assert "wholesale" in config_schema
        assert '"message"' in config_schema

    @pytest.mark.parametrize(
        "phrase", ["read_config", "base_revision_id", "operations"]
    )
    def test_nothing_mentions_the_ordered_shape(self, legacy, phrase):
        # `read_config` does not exist on a flag-off deployment, so naming it would send the
        # agent after a tool it does not have.
        for name, content in _commit_surface(legacy).items():
            assert phrase not in content, f"{name} names the ordered shape ({phrase!r})"

    def test_every_example_validates_against_the_real_commit_schema(self, legacy):
        schema = legacy["commit_schema"]
        section = legacy["files"]["references/config-schema.md"].split(
            "## Example requests", 1
        )[1]
        payloads = [
            json.loads(block)
            for block in re.findall(r"```json\n(.*?)```", section, flags=re.DOTALL)
        ]
        assert len(payloads) == 4
        for payload in payloads:
            jsonschema.validate(payload, schema)
