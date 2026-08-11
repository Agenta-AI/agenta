"""Known-value redaction at the tracing decorator seam (`@instrument`'s `_redact`).

A live secret in a traced function's args/return value never reaches the span attributes.
`ag.tracing.redact` stays a separate, additive, user-defined hook; this asserts the always-on
known-value scrub that runs after it.
"""

from unittest.mock import Mock, patch

from agenta.sdk.decorators.tracing import instrument
from agenta.sdk.redaction import Redactor, redaction_context


class TestKnownValueRedactionAtSpanBoundary:
    def setup_method(self):
        self.mock_span = Mock()
        self.mock_tracer = Mock()
        self.mock_tracer.start_span.return_value = self.mock_span
        self.mock_tracer.get_current_span.return_value = self.mock_span

        self.mock_tracing = Mock()
        self.mock_tracing.get_current_span.return_value = self.mock_span
        self.mock_tracing.redact = None  # the separate user-defined hook stays off here

    def _flattened_attributes(self) -> dict:
        """`CustomSpan.set_attributes` flattens into dotted `ag.<namespace>.<key>` attribute
        names before handing off to the real span — merge every call's attributes dict."""
        merged: dict = {}
        for call in self.mock_span.set_attributes.call_args_list:
            attrs = call.kwargs.get("attributes") or (call.args[0] if call.args else {})
            merged.update(attrs)
        return merged

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_known_secret_in_args_is_scrubbed_from_span_inputs(self, mock_ag):
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        secret = "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"
        redactor = Redactor().with_known_secrets([secret])

        @instrument()
        def call_provider(api_key):
            return "ok"

        with redaction_context(redactor):
            call_provider(secret)

        attrs = self._flattened_attributes()
        assert attrs.get("ag.data.inputs.api_key") == "[ag:redacted:secret:5b4a]"
        assert secret not in str(attrs)

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_known_secret_in_return_value_is_scrubbed_from_span_outputs(self, mock_ag):
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        secret = "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"
        redactor = Redactor().with_known_secrets([secret])

        @instrument()
        def echo_secret():
            return f"used {secret} to authenticate"

        with redaction_context(redactor):
            echo_secret()

        attrs = self._flattened_attributes()
        output = attrs.get("ag.data.outputs.__default__")
        assert output is not None
        assert secret not in output
        assert "[ag:redacted:secret:" in output

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_no_active_redactor_leaves_content_untouched(self, mock_ag):
        # Outside any redaction_context, get_active_redactor() falls back to an unseeded
        # Redactor — a no-op, matching pre-existing behavior for callers who never seed one.
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def plain(x):
            return x

        plain("ordinary value")
        attrs = self._flattened_attributes()
        assert attrs.get("ag.data.inputs.x") == "ordinary value"

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_user_defined_redact_hook_still_runs_before_known_value_scrub(
        self, mock_ag
    ):
        # The existing `ag.tracing.redact` hook is a separate, additive mechanism (not
        # duplicated or replaced): it can still drop/transform fields; known-value redaction
        # then runs on whatever it leaves behind.
        mock_ag.tracer = self.mock_tracer
        self.mock_tracing.redact = lambda name, field, io: {
            **io,
            "extra_marker": "added-by-user-hook",
        }
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        secret = "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"
        redactor = Redactor().with_known_secrets([secret])

        @instrument()
        def call_provider(api_key):
            return "ok"

        with redaction_context(redactor):
            call_provider(secret)

        attrs = self._flattened_attributes()
        assert attrs.get("ag.data.inputs.extra_marker") == "added-by-user-hook"
        assert secret not in str(attrs)
