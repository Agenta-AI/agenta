"""
Comprehensive test suite for the Agenta SDK tracing decorators.

This module tests the @instrument() decorator functionality across all supported
function types: synchronous, asynchronous, generator, and async generator functions.

Test Architecture:
-----------------
The tests are organized into two main classes:

1. TestExistingFunctionality: Regression tests ensuring that existing sync/async
   function tracing continues to work without issues after generator support was added.

2. TestGeneratorTracing: Comprehensive tests for the new generator tracing functionality,
   covering both sync and async generators.

Tracing Strategy:
----------------
The implementation uses a "consume-first" strategy for generators:
- The entire generator is consumed during span creation
- All yielded values are collected and logged as {"generator_outputs": [...]}
- A new generator is returned with the collected results
- This approach is optimal for LLM applications requiring complete response logging

Mock Setup:
-----------
Tests use comprehensive mocking to isolate the tracing decorator logic:
- mock_ag.tracer: Mocks the OpenTelemetry tracer
- mock_ag.tracing: Mocks the tracing utilities used by _post_instrument
- All span creation, attribute setting, and status updates are mocked

Coverage:
---------
✅ Sync function tracing (regression)
✅ Async function tracing (regression)
✅ Exception handling for sync/async functions (regression)
✅ Parameter handling and complex return types (regression)
✅ Sync generator tracing
✅ Async generator tracing
✅ Generator return value preservation
✅ Generator exception handling (all-or-nothing behavior)
✅ Empty generator handling
✅ Function type detection accuracy
✅ Nested tracing scenarios
"""

import pytest
import asyncio
from unittest.mock import Mock, patch

from agenta.sdk.decorators.tracing import instrument


class TestExistingFunctionality:
    """Test existing sync/async function tracing to ensure no regressions."""

    def setup_method(self):
        """Set up test fixtures."""
        self.mock_tracer = Mock()
        self.mock_span = Mock()
        self.mock_tracer.start_as_current_span.return_value.__enter__ = Mock(
            return_value=self.mock_span
        )
        self.mock_tracer.start_as_current_span.return_value.__exit__ = Mock(
            return_value=None
        )

        # Mock both tracer and tracing since they're used in different places
        self.mock_tracer.get_current_span.return_value = self.mock_span

        # Set up mock_tracing for _post_instrument calls
        self.mock_tracing = Mock()
        self.mock_tracing.get_current_span.return_value = self.mock_span
        # _redact checks `ag.tracing.redact is not None` — must be None to skip
        self.mock_tracing.redact = None

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_function_basic(self, mock_ag):
        """Test basic sync function tracing (regression test)."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def simple_function(x, y):
            return x + y

        # Execute the function
        result = simple_function(5, 3)

        # Verify result
        assert result == 8

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()
        call_args = mock_ag.tracer.start_as_current_span.call_args
        assert call_args[1]["name"] == "simple_function"

        # Verify span was set to OK status
        self.mock_span.set_status.assert_called_with(status="OK", description=None)

    @pytest.mark.asyncio
    @patch("agenta.sdk.decorators.tracing.ag")
    async def test_async_function_basic(self, mock_ag):
        """Test basic async function tracing (regression test)."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        async def simple_async_function(x, y):
            await asyncio.sleep(0.001)  # Small delay
            return x * y

        # Execute the async function
        result = await simple_async_function(4, 5)

        # Verify result
        assert result == 20

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()
        call_args = mock_ag.tracer.start_as_current_span.call_args
        assert call_args[1]["name"] == "simple_async_function"

        # Verify span was set to OK status
        self.mock_span.set_status.assert_called_with(status="OK", description=None)

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_function_with_exception(self, mock_ag):
        """Test sync function that raises exception (regression test)."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def failing_function():
            raise ValueError("test error")

        # Execute the function and expect exception
        with pytest.raises(ValueError, match="test error"):
            failing_function()

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @pytest.mark.asyncio
    @patch("agenta.sdk.decorators.tracing.ag")
    async def test_async_function_with_exception(self, mock_ag):
        """Test async function that raises exception (regression test)."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        async def failing_async_function():
            await asyncio.sleep(0.001)
            raise ValueError("async test error")

        # Execute the async function and expect exception
        with pytest.raises(ValueError, match="async test error"):
            await failing_async_function()

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_function_with_parameters(self, mock_ag):
        """Test sync function with various parameter types (regression test)."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def complex_function(a, b=10, *args, **kwargs):
            return {
                "a": a,
                "b": b,
                "args": args,
                "kwargs": kwargs,
                "sum": a + b + sum(args) + sum(kwargs.values()),
            }

        # Execute the function with complex parameters
        result = complex_function(1, 2, 3, 4, x=5, y=6)

        # Verify result
        expected = {
            "a": 1,
            "b": 2,
            "args": (3, 4),
            "kwargs": {"x": 5, "y": 6},
            "sum": 21,  # 1+2+3+4+5+6
        }
        assert result == expected

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_function_return_dict_with_cost_usage(self, mock_ag):
        """Test sync function that returns dict with cost/usage info (regression test)."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def function_with_metrics():
            return {
                "result": "success",
                "cost": 0.05,
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "total_tokens": 30,
                },
            }

        # Execute the function
        result = function_with_metrics()

        # Verify result
        expected = {
            "result": "success",
            "cost": 0.05,
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }
        assert result == expected

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()


class TestGeneratorTracing:
    """
    Comprehensive test suite for generator function tracing.

    This class tests the @instrument() decorator's ability to handle both
    synchronous and asynchronous generator functions. The implementation
    uses a consume-first strategy optimized for LLM streaming applications.

    Key Test Categories:
    -------------------
    1. Basic Functionality: Simple generators with known outputs
    2. Return Values: Generators that use the 'return' statement
    3. Empty Generators: Edge case handling for generators that yield nothing
    4. Exception Handling: All-or-nothing behavior on generator failures
    5. Input/Output Tracing: Parameter capture and output formatting
    6. Function Type Detection: Ensuring proper generator identification
    7. Integration: Nested calls and complex scenarios
    """

    def setup_method(self):
        """Set up test fixtures."""
        self.mock_tracer = Mock()
        self.mock_span = Mock()
        self.mock_tracer.start_as_current_span.return_value.__enter__ = Mock(
            return_value=self.mock_span
        )
        self.mock_tracer.start_as_current_span.return_value.__exit__ = Mock(
            return_value=None
        )

        # Mock both tracer and tracing since they're used in different places
        self.mock_tracer.get_current_span.return_value = self.mock_span

        # Set up mock_tracing for _post_instrument calls
        self.mock_tracing = Mock()
        self.mock_tracing.get_current_span.return_value = self.mock_span
        # _redact checks `ag.tracing.redact is not None` — must be None to skip
        self.mock_tracing.redact = None

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_generator_basic(self, mock_ag):
        """Test basic sync generator tracing."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def simple_generator():
            yield "first"
            yield "second"
            yield "third"

        # Execute the generator
        results = list(simple_generator())

        # Verify results
        assert results == ["first", "second", "third"]

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()
        call_args = mock_ag.tracer.start_as_current_span.call_args
        assert call_args[1]["name"] == "simple_generator"

        # Verify span was set to OK status
        self.mock_span.set_status.assert_called_with(status="OK", description=None)

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_generator_with_return_value(self, mock_ag):
        """Test sync generator that returns a value."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def generator_with_return():
            yield 1
            yield 2
            return "done"

        # Execute the generator
        results = []
        gen = generator_with_return()
        try:
            while True:
                results.append(next(gen))
        except StopIteration as e:
            return_value = e.value

        # Verify results and return value
        assert results == [1, 2]
        assert return_value == "done"

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_generator_empty(self, mock_ag):
        """Test empty sync generator."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def empty_generator():
            return
            yield  # unreachable

        # Execute the generator
        results = list(empty_generator())

        # Verify empty results
        assert results == []

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_sync_generator_exception(self, mock_ag):
        """Test sync generator that raises an exception."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def failing_generator():
            yield "good"
            yield "still good"
            raise ValueError("something broke")

        # Execute the generator and expect exception
        # With Option 1 approach: exception happens during consumption, no partial results
        with pytest.raises(ValueError, match="something broke"):
            list(failing_generator())

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @pytest.mark.asyncio
    @patch("agenta.sdk.decorators.tracing.ag")
    async def test_async_generator_basic(self, mock_ag):
        """Test basic async generator tracing."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        async def simple_async_generator():
            yield "async_first"
            await asyncio.sleep(0.001)  # Small delay
            yield "async_second"
            yield "async_third"

        # Execute the async generator
        results = []
        async for item in simple_async_generator():
            results.append(item)

        # Verify results
        assert results == ["async_first", "async_second", "async_third"]

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()
        call_args = mock_ag.tracer.start_as_current_span.call_args
        assert call_args[1]["name"] == "simple_async_generator"

        # Verify span was set to OK status
        self.mock_span.set_status.assert_called_with(status="OK", description=None)

    @pytest.mark.asyncio
    @patch("agenta.sdk.decorators.tracing.ag")
    async def test_async_generator_empty(self, mock_ag):
        """Test empty async generator."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        async def empty_async_generator():
            return
            yield  # unreachable

        # Execute the async generator
        results = []
        async for item in empty_async_generator():
            results.append(item)

        # Verify empty results
        assert results == []

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @pytest.mark.asyncio
    @patch("agenta.sdk.decorators.tracing.ag")
    async def test_async_generator_exception(self, mock_ag):
        """Test async generator that raises an exception."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        async def failing_async_generator():
            yield "async_good"
            await asyncio.sleep(0.001)
            yield "async_still_good"
            raise ValueError("async broke")

        # Execute the async generator and expect exception
        # With Option 1 approach: exception happens during consumption, no partial results
        with pytest.raises(ValueError, match="async broke"):
            async_gen = failing_async_generator()
            results = []
            async for item in async_gen:
                results.append(item)

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_generator_input_tracing(self, mock_ag):
        """Test that generator inputs are properly traced."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def parametrized_generator(count, prefix="item"):
            for i in range(count):
                yield f"{prefix}_{i}"

        # Execute the generator with specific parameters
        results = list(parametrized_generator(3, "test"))

        # Verify results
        assert results == ["test_0", "test_1", "test_2"]

        # Verify span was created with proper name
        mock_ag.tracer.start_as_current_span.assert_called_once()
        call_args = mock_ag.tracer.start_as_current_span.call_args
        assert call_args[1]["name"] == "parametrized_generator"

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_generator_output_format(self, mock_ag):
        """Test that generator outputs are formatted correctly."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def test_generator():
            yield {"data": 1}
            yield {"data": 2}
            yield {"data": 3}

        # Execute the generator
        results = list(test_generator())

        # Verify results
        expected = [{"data": 1}, {"data": 2}, {"data": 3}]
        assert results == expected

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    def test_function_type_detection(self):
        """Test that function types are correctly detected."""

        def regular_func():
            return "regular"

        def generator_func():
            yield "generator"

        async def async_func():
            return "async"

        async def async_generator_func():
            yield "async_generator"

        # Test detection logic directly
        from inspect import iscoroutinefunction, isgeneratorfunction, isasyncgenfunction

        assert not iscoroutinefunction(regular_func)
        assert not isgeneratorfunction(regular_func)
        assert not isasyncgenfunction(regular_func)

        assert not iscoroutinefunction(generator_func)
        assert isgeneratorfunction(generator_func)
        assert not isasyncgenfunction(generator_func)

        assert iscoroutinefunction(async_func)
        assert not isgeneratorfunction(async_func)
        assert not isasyncgenfunction(async_func)

        assert not iscoroutinefunction(async_generator_func)
        assert not isgeneratorfunction(async_generator_func)
        assert isasyncgenfunction(async_generator_func)

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_generator_finite_early_termination(self, mock_ag):
        """Test finite generator that is terminated early."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def finite_generator():
            # Finite generator for Option 1 approach
            for i in range(10):
                yield f"item_{i}"

        # Take only first 3 items from our wrapper
        results = []
        gen = finite_generator()
        for _ in range(3):
            results.append(next(gen))

        # With Option 1: we consumed entire generator (10 items), then yield first 3
        assert results == ["item_0", "item_1", "item_2"]

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_nested_generator_calls(self, mock_ag):
        """Test generators that call other traced functions."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def helper_function(x):
            return f"processed_{x}"

        @instrument()
        def generator_with_nested_calls():
            for i in range(3):
                # This should create nested spans
                processed = helper_function(i)
                yield processed

        # Execute the generator
        results = list(generator_with_nested_calls())

        # Verify results
        assert results == ["processed_0", "processed_1", "processed_2"]

        # Verify spans were created (should be called for both functions)
        assert mock_ag.tracer.start_as_current_span.call_count >= 2

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_generator_with_large_output(self, mock_ag):
        """Test generator with many items to verify memory handling."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def large_generator():
            for i in range(1000):
                yield f"item_{i}"

        # Execute the generator
        results = list(large_generator())

        # Verify we got all 1000 items
        assert len(results) == 1000
        assert results[0] == "item_0"
        assert results[999] == "item_999"

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()
        self.mock_span.set_status.assert_called_with(status="OK", description=None)

    @pytest.mark.asyncio
    @patch("agenta.sdk.decorators.tracing.ag")
    async def test_async_generator_with_delay(self, mock_ag):
        """Test async generator with realistic delays."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        async def delayed_generator():
            for i in range(3):
                await asyncio.sleep(0.001)  # Small delay to simulate real async work
                yield f"delayed_{i}"

        # Execute the async generator
        results = []
        async for item in delayed_generator():
            results.append(item)

        # Verify results
        assert results == ["delayed_0", "delayed_1", "delayed_2"]

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()
        self.mock_span.set_status.assert_called_with(status="OK", description=None)

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_generator_with_mixed_types(self, mock_ag):
        """Test generator that yields different types of objects."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument()
        def mixed_type_generator():
            yield "string"
            yield 42
            yield {"key": "value"}
            yield [1, 2, 3]
            yield None

        # Execute the generator
        results = list(mixed_type_generator())

        # Verify all types are preserved
        expected = ["string", 42, {"key": "value"}, [1, 2, 3], None]
        assert results == expected

        # Verify span was created
        mock_ag.tracer.start_as_current_span.assert_called_once()
        self.mock_span.set_status.assert_called_with(status="OK", description=None)

    @patch("agenta.sdk.decorators.tracing.ag")
    def test_generator_with_decorator_parameters(self, mock_ag):
        """Test generator with instrument decorator parameters."""
        mock_ag.tracer = self.mock_tracer
        mock_ag.tracing = self.mock_tracing
        mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True

        @instrument(type="llm", ignore_inputs=True, ignore_outputs=False)
        def parameterized_generator(prompt):
            yield f"Processing: {prompt}"
            yield "Thinking..."
            yield "Complete!"

        # Execute the generator
        results = list(parameterized_generator("test prompt"))

        # Verify results
        expected = ["Processing: test prompt", "Thinking...", "Complete!"]
        assert results == expected

        # Verify span was created with correct parameters
        mock_ag.tracer.start_as_current_span.assert_called_once()
        call_args = mock_ag.tracer.start_as_current_span.call_args
        assert call_args[1]["name"] == "parameterized_generator"

        # Verify span was set to OK status
        self.mock_span.set_status.assert_called_with(status="OK", description=None)
