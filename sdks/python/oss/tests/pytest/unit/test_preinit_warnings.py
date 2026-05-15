"""
Tests that instrumentation methods emit RuntimeWarning when called before ag.init().
"""

import warnings
import pytest
from unittest.mock import patch, MagicMock


class TestLitellmHandlerPreInitWarning:
    """ag.callbacks.litellm_handler() should warn when ag.tracing is None."""

    def test_litellm_handler_warns_when_called_before_init(self):
        with patch("agenta.tracing", None):
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")

                # litellm may not be installed in test env; mock the import
                mock_logger = MagicMock()
                mock_logger.__name__ = "CustomLogger"

                with patch.dict(
                    "sys.modules",
                    {
                        "litellm": MagicMock(),
                        "litellm.integrations": MagicMock(),
                        "litellm.integrations.custom_logger": MagicMock(
                            CustomLogger=mock_logger
                        ),
                    },
                ):
                    from agenta.sdk.litellm.litellm import litellm_handler

                    litellm_handler()

        runtime_warnings = [w for w in caught if issubclass(w.category, RuntimeWarning)]
        assert len(runtime_warnings) == 1
        assert "ag.init()" in str(runtime_warnings[0].message)
        assert "litellm_handler" in str(runtime_warnings[0].message)

    def test_litellm_handler_no_warning_after_init(self):
        mock_tracing = MagicMock()

        with patch("agenta.tracing", mock_tracing):
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")

                mock_logger = MagicMock()
                mock_logger.__name__ = "CustomLogger"

                with patch.dict(
                    "sys.modules",
                    {
                        "litellm": MagicMock(),
                        "litellm.integrations": MagicMock(),
                        "litellm.integrations.custom_logger": MagicMock(
                            CustomLogger=mock_logger
                        ),
                    },
                ):
                    from agenta.sdk.litellm.litellm import litellm_handler

                    litellm_handler()

        runtime_warnings = [w for w in caught if issubclass(w.category, RuntimeWarning)]
        assert len(runtime_warnings) == 0


class TestInstrumentDecoratorPreInitWarning:
    """@ag.instrument() should warn at function call time when ag.tracing is None."""

    def test_instrument_warns_on_call_before_init(self):
        from agenta.sdk.decorators.tracing import instrument

        @instrument()
        def my_fn():
            return "result"

        with patch("agenta.tracing", None):
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")

                # Warning fires first; subsequent code may raise because
                # ag.tracing is None — that is the expected failure mode.
                try:
                    my_fn()
                except Exception:
                    pass

        runtime_warnings = [w for w in caught if issubclass(w.category, RuntimeWarning)]
        assert len(runtime_warnings) >= 1, (
            "Expected RuntimeWarning but none were emitted"
        )
        assert "ag.init()" in str(runtime_warnings[0].message)

    def test_instrument_no_warning_after_init(self):
        from agenta.sdk.decorators.tracing import instrument

        @instrument()
        def my_fn():
            return "result"

        mock_tracing = MagicMock()

        with patch("agenta.tracing", mock_tracing):
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")

                with patch("agenta.tracer") as mock_tracer:
                    mock_span = MagicMock()
                    mock_tracer.start_as_current_span.return_value.__enter__ = (
                        lambda s, *a: mock_span
                    )
                    mock_tracer.start_as_current_span.return_value.__exit__ = (
                        lambda s, *a: None
                    )
                    try:
                        my_fn()
                    except Exception as exc:
                        pytest.fail(f"my_fn() raised unexpectedly: {exc}")

        runtime_warnings = [w for w in caught if issubclass(w.category, RuntimeWarning)]
        assert len(runtime_warnings) == 0, "Unexpected RuntimeWarning after ag.init()"
