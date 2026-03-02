# Testing Patterns & Architecture

This document covers the detailed testing approaches, patterns, and architecture used in our unit tests.

## Our Testing Strategy

We use comprehensive mocking to isolate component logic from external dependencies. This approach allows us to:
- Test the actual business logic without external service dependencies
- Verify that external calls are made correctly
- Ensure tests are fast and reliable
- Focus on the component's behavior rather than integration concerns

## Mock Architecture

### Core Mocking Strategy

Tests use comprehensive mocking to isolate the tracing decorator logic from external dependencies:

```python
# Mock setup in setup_method()
self.mock_tracer = Mock()           # Mocks ag.tracer
self.mock_span = Mock()             # Mocks individual spans  
self.mock_tracing = Mock()          # Mocks ag.tracing utilities

# Usage in tests
mock_ag.tracer = self.mock_tracer
mock_ag.tracing = self.mock_tracing
```

### What Gets Mocked

1. **OpenTelemetry Tracer**: `ag.tracer.start_as_current_span()`
2. **Span Management**: `span.set_attributes()`, `span.set_status()`
3. **Tracing Utilities**: `ag.tracing.get_current_span()`
4. **Context Management**: Span enter/exit behavior

### What Doesn't Get Mocked

- Function execution logic (the actual generators/functions run normally)
- Python's generator mechanics (`yield`, `next()`, `StopIteration`)
- Function inspection (`isgeneratorfunction`, etc.)

## Test Categories

### 1. Regression Tests (`TestExistingFunctionality`)

**Purpose**: Ensure existing sync/async function tracing continues to work after generator support was added.

**What it tests**:
- ✅ Basic sync function tracing
- ✅ Basic async function tracing  
- ✅ Exception handling for both sync/async
- ✅ Complex parameter handling
- ✅ Cost/usage metrics extraction from return values

**Run command**:
```bash
poetry run pytest tests/unit/test_tracing_decorators.py::TestExistingFunctionality -v
```

### 2. Generator Tests (`TestGeneratorTracing`)

**Purpose**: Comprehensive testing of new generator tracing functionality.

**What it tests**:
- ✅ Sync generator tracing (`test_sync_generator_basic`)
- ✅ Async generator tracing (`test_async_generator_basic`)
- ✅ Generator return value preservation (`test_sync_generator_with_return_value`)
- ✅ Empty generator handling (`test_sync_generator_empty`, `test_async_generator_empty`)
- ✅ Exception handling with all-or-nothing behavior (`test_sync_generator_exception`)
- ✅ Input parameter tracing (`test_generator_input_tracing`)
- ✅ Output format validation (`test_generator_output_format`)
- ✅ Function type detection (`test_function_type_detection`)
- ✅ Early termination scenarios (`test_generator_finite_early_termination`)
- ✅ Nested tracing calls (`test_nested_generator_calls`)

**Run command**:
```bash
poetry run pytest tests/unit/test_tracing_decorators.py::TestGeneratorTracing -v
```

## Test Data Patterns

### Simple Testcases
```python
# Basic generator
def simple_generator():
    yield "first"
    yield "second" 
    yield "third"

# Expected result: ["first", "second", "third"]
```

### Complex Testcases  
```python
# Generator with return value
def generator_with_return():
    yield 1
    yield 2
    return "done"

# Expected: yields=[1, 2], return_value="done"
```

### Error Cases
```python
# Generator that fails mid-stream
def failing_generator():
    yield "good"
    yield "still good"
    raise ValueError("something broke")

# Expected: ValueError raised, no partial results (all-or-nothing)
```

## Common Issues & Solutions

### Issue: Tests hang indefinitely

**Cause**: Test includes infinite generator
**Solution**: Replace with finite generator for testing

```python
# ❌ Don't do this (will hang)
def infinite_generator():
    i = 0
    while True:
        yield f"item_{i}"
        i += 1

# ✅ Do this instead
def finite_generator():
    for i in range(10):
        yield f"item_{i}"
```

### Issue: Mock assertion failures

**Cause**: Missing mock setup for both `ag.tracer` and `ag.tracing`
**Solution**: Ensure both are mocked

```python
# ✅ Correct mock setup
mock_ag.tracer = self.mock_tracer
mock_ag.tracing = self.mock_tracing  # Don't forget this!
```

### Issue: Import errors during test collection

**Cause**: Missing dependencies or incorrect Python path
**Solution**: Use Poetry environment

```bash
# ✅ Always run with Poetry
poetry run pytest tests/unit/ -v
```

## Extending Tests

### Adding New Testcases

1. **Choose appropriate test class**:
   - `TestExistingFunctionality`: For regression tests
   - `TestGeneratorTracing`: For generator-specific tests

2. **Follow naming conventions**:
   ```python
   def test_[sync|async]_[generator|function]_[specific_scenario](self, mock_ag):
       """Clear description of what this test verifies."""
   ```

3. **Include proper mock setup**:
   ```python
   mock_ag.tracer = self.mock_tracer
   mock_ag.tracing = self.mock_tracing
   mock_ag.tracing.get_current_span.return_value.is_recording.return_value = True
   ```

4. **Test both behavior and tracing**:
   ```python
   # Test the actual function behavior
   result = list(traced_generator())
   assert result == expected_result
   
   # Test the tracing behavior  
   mock_ag.tracer.start_as_current_span.assert_called_once()
   self.mock_span.set_status.assert_called_with("OK")
   ```

### Performance Testing

For performance-critical tests, consider adding:

```python
import time

def test_generator_performance(self, mock_ag):
    """Test that generator tracing doesn't add significant overhead."""
    mock_ag.tracer = self.mock_tracer
    mock_ag.tracing = self.mock_tracing
    
    @instrument()
    def large_generator():
        for i in range(10000):
            yield i
    
    start_time = time.time()
    result = list(large_generator())
    duration = time.time() - start_time
    
    assert len(result) == 10000
    assert duration < 1.0  # Should complete in under 1 second
```

## Advanced Test Options

### Parallel Execution
```bash
# Run tests in parallel (faster execution)
poetry run pytest tests/unit/ -n auto
```

### Coverage Reporting
```bash
# Detailed coverage with HTML report
poetry run pytest tests/unit/ --cov=agenta.sdk.decorators --cov-report=html

# XML coverage for CI integration
poetry run pytest tests/unit/ --cov=agenta.sdk --cov-report=xml
```

### Debugging
```bash
# Run with pdb debugger on failures
poetry run pytest tests/unit/ --pdb

# Detailed traceback
poetry run pytest tests/unit/ -v --tb=long

# Stop on first failure
poetry run pytest tests/unit/ -x
```

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      - name: Install Poetry
        uses: snok/install-poetry@v1
      - name: Install dependencies
        run: poetry install
      - name: Run unit tests
        run: poetry run pytest tests/unit/ -v --cov=agenta.sdk --cov-report=xml
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

This ensures tests run consistently across environments and maintains code quality standards.

## Project Structure

Tests expect the following project structure:
```
sdk/
├── agenta/
│   └── sdk/
│       └── decorators/
│           └── tracing.py        # Implementation under test
├── tests/
│   └── unit/
│       ├── README.md             # Quick start guide
│       ├── TESTING_PATTERNS.md   # This file
│       ├── conftest.py           # Shared fixtures
│       └── test_tracing_decorators.py
├── pyproject.toml                # Poetry configuration with test dependencies
└── pytest.ini                   # Pytest configuration
```
