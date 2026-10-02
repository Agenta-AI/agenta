from oss.src.core.evaluations.runtime.adapters import _project_inputs

TESTCASE = {
    "context": "Paris is the capital of France.",
    "question": "What is the capital of France?",
    "correct_answer": "Paris",
}


def _data(inputs_schema):
    return {"schemas": {"inputs": inputs_schema}}


def test_chat_schema_keeps_undeclared_template_variables():
    data = _data(
        {
            "type": "object",
            "properties": {"messages": {"type": "array"}},
            "additionalProperties": True,
        }
    )

    assert _project_inputs(TESTCASE, data) == TESTCASE


def test_schema_without_additional_properties_keeps_all_inputs():
    data = _data({"type": "object", "properties": {"question": {}}})

    assert _project_inputs(TESTCASE, data) == TESTCASE


def test_strict_schema_filters_to_declared_inputs():
    data = _data(
        {
            "type": "object",
            "properties": {"question": {"type": "string"}},
            "additionalProperties": False,
        }
    )

    assert _project_inputs(TESTCASE, data) == {
        "question": "What is the capital of France?"
    }


def test_empty_properties_pass_inputs_through():
    data = _data({"type": "object", "properties": {}, "additionalProperties": False})

    assert _project_inputs(TESTCASE, data) == TESTCASE


def test_missing_schema_passes_inputs_through():
    assert _project_inputs(TESTCASE, {}) == TESTCASE
    assert _project_inputs(TESTCASE, None) == TESTCASE
