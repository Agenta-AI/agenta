"""Regression tests for input projection in the evaluation runtime.

`_project_inputs` filters a testcase row down to the inputs a workflow revision
declares before invoking it. For builtin prompt workflows the declared input
schema (`schemas.inputs.properties`) only carries STRUCTURAL inputs (e.g.
`messages` for chat), not the prompt template variables (e.g. `context`), which
live in `prompt.input_keys`. Dropping a template variable here invokes the
workflow with empty inputs and fails with
`Invalid inputs: Expected ['context'] Got []`.

Verified end-to-end against the running stack (chat:v0 app whose schema declares
only `messages`, prompt uses `{{context}}`): with this projection the app
receives `{'context': ...}` instead of `{}`.
"""

from oss.src.core.evaluations.runtime.adapters import _project_inputs


def _data(*, properties=None, parameters=None):
    schemas = {"inputs": {"properties": properties}} if properties is not None else {}
    return {"schemas": schemas, "parameters": parameters}


def test_drops_bookkeeping_columns():
    inputs = {"context": "x", "correct_answer": "y", "testcase_id": "1"}
    data = _data(properties={"context": {}})

    assert _project_inputs(inputs, data) == {"context": "x"}


def test_passthrough_when_no_input_schema():
    inputs = {"context": "x", "testcase_id": "1"}

    assert _project_inputs(inputs, _data()) == inputs
    assert _project_inputs(inputs, _data(properties={})) == inputs


def test_keeps_template_var_absent_from_schema_chat_workflow():
    """The real bug: a chat:v0 app's schema declares only `messages`, but the
    prompt's template variable `context` lives in `input_keys`. Projection must
    keep `context` (and drop ground-truth/bookkeeping columns)."""
    inputs = {"context": "Nauru", "correct_answer": "...", "testcase_id": "1"}
    data = _data(
        properties={"messages": {"x-ag-type-ref": "messages"}},
        parameters={"prompt": {"input_keys": ["context"]}},
    )

    assert _project_inputs(inputs, data) == {"context": "Nauru"}


def test_keeps_input_keys_with_wrapped_ag_config():
    inputs = {"context": "Nauru", "testcase_id": "1"}
    data = _data(
        properties={"messages": {}},
        parameters={"ag_config": {"prompt": {"input_keys": ["context"]}}},
    )

    assert _project_inputs(inputs, data) == {"context": "Nauru"}


def test_non_dict_inputs_pass_through():
    assert _project_inputs(None, _data(properties={"context": {}})) is None
    assert _project_inputs([], _data(properties={"context": {}})) == []
