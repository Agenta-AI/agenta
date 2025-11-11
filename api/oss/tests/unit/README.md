# Unit Tests for Backend Services

This directory contains unit tests for backend service functions.

## Test Files

- **`test_template_formatting_v0.py`** - Tests for `_format_with_template` in core services (v0.py)
- **`test_template_formatting_evaluators.py`** - Tests for `_format_with_template` in evaluators service

## Running Tests

### Prerequisites

The backend tests require the full backend environment to be set up because the modules have dependencies on database connections, security services, and other backend components.

### Option 1: Using Poetry (Recommended)

```bash
# From the api directory
cd api
poetry install
poetry run pytest oss/tests/unit/ -v
```

### Option 2: Using Docker

If you have the backend running in Docker, you can run tests inside the container:

```bash
docker exec -it <container_name> pytest /app/oss/tests/unit/ -v
```

### Option 3: Standalone Testing

For truly isolated testing without backend dependencies, consider extracting the `_format_with_template` function into a separate utility module with no dependencies.

## Test Coverage

These tests cover critical edge cases discovered through production bugs:

- ✅ User input containing `{{}}` (AGE-2946)
- ✅ Self-referential values (`{{x}}` = `"{{x}}"`)
- ✅ Cross-referential values (single-pass replacement)
- ✅ Backslash sequences (regex escape bug fix)
- ✅ Regex metacharacters in variable names
- ✅ Missing variable detection
- ✅ Multiple template formats (fstring, jinja2, curly)

## Known Issues

**Import Dependencies:** The current test files import directly from the service modules, which triggers initialization of database connections and other backend services. This makes the tests harder to run in isolation.

**Workaround:** The SDK unit tests (`sdk/tests/unit/test_prompt_template.py`) cover the same template formatting logic and can be run independently without any backend dependencies.

## Future Improvements

Consider:
1. Extracting `_format_with_template` into a standalone utility module
2. Creating a mock/stub version for unit testing
3. Using dependency injection to avoid triggering backend initialization during imports
