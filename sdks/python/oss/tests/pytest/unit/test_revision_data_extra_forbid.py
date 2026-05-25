"""SDK-side strict validation for *RevisionData DTOs (issue #4315).

These tests guard the source-of-truth Pydantic config — unknown top-level
fields in `data` payloads must raise instead of being silently dropped.
"""

import pytest
from pydantic import ValidationError

from agenta.sdk.models.workflows import WorkflowRevisionData
from agenta.sdk.models.testsets import TestsetRevisionData


class TestWorkflowRevisionDataStrict:
    def test_known_field_accepted(self):
        WorkflowRevisionData(uri="agenta:custom:llm:v0")

    def test_unknown_field_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            WorkflowRevisionData(ag_config={"prompt": {"messages": []}})
        assert "ag_config" in str(exc_info.value)

    def test_unknown_field_alongside_known_field_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            WorkflowRevisionData(uri="agenta:custom:llm:v0", surprise=True)
        assert "surprise" in str(exc_info.value)


class TestTestsetRevisionDataStrict:
    def test_known_field_accepted(self):
        TestsetRevisionData(testcase_ids=[])

    def test_unknown_field_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            TestsetRevisionData(csvdata=[{"input": "x"}])
        assert "csvdata" in str(exc_info.value)
