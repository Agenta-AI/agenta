# Unit Tests for Agenta SDK

This directory contains unit tests for the Agenta SDK components.

## Quick Start

```bash
# Run all tests
uv run pytest tests/unit/ -v

# Run specific test file
uv run pytest tests/unit/test_tracing_decorators.py -v

# Run specific test class
uv run pytest tests/unit/test_tracing_decorators.py::TestGeneratorTracing -v
```

## Test Organization

- **`conftest.py`** - Shared fixtures and test configuration
- **`test_*.py`** - Individual test modules
- **`TESTING_PATTERNS.md`** - Common testing approaches and patterns

## Prerequisites

```bash
# Install dependencies
uv sync
```

## Running Tests

### Basic Execution
```bash
uv run pytest tests/unit/ -v
```

### With Coverage
```bash
uv run pytest tests/unit/ --cov=agenta.sdk --cov-report=html
```

### Debug Mode
```bash
uv run pytest tests/unit/ --pdb
```

## Adding New Tests

1. Create a new `test_*.py` file
2. Add any shared fixtures to `conftest.py`
3. See `TESTING_PATTERNS.md` for detailed guidance on testing approaches

## Test Dependencies

Tests use pytest with the following key dependencies:
- `pytest` - Test framework
- `pytest-mock` - Mocking utilities
- `pytest-cov` - Coverage reporting

For detailed testing patterns, architecture, and module-specific guidance, see `TESTING_PATTERNS.md`.
