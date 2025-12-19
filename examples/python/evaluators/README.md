# Custom Code Evaluators for Agenta

This directory contains a comprehensive series of custom code evaluators for testing various aspects of LLM applications in Agenta.

## Overview

Each evaluator follows the standard Agenta evaluator signature:

```python
def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    """Returns a score between 0.0 and 1.0"""
```

## Directory Structure

```
evaluators/
├── basic/                  # Basic Python evaluators (no external dependencies)
│   ├── string_contains.py
│   ├── length_check.py
│   ├── json_structure.py
│   └── word_count.py
├── numpy/                  # NumPy-based evaluators
│   ├── cosine_similarity.py
│   ├── statistical_accuracy.py
│   ├── array_transformation.py
│   └── matrix_operations.py
├── openai/                 # OpenAI SDK evaluators
│   ├── response_structure.py
│   ├── token_efficiency.py
│   └── function_calling.py
├── agenta_secrets/         # Secrets management evaluators
│   ├── secrets_security.py
│   ├── provider_key_usage.py
│   └── secrets_masking.py
└── agenta_config/          # Configuration management evaluators
    ├── config_parameters.py
    ├── database_credentials.py
    ├── environment_config.py
    └── config_validation.py
```

## Evaluator Categories

### 1. Basic Use Evaluators

Simple evaluators that test basic Python functionality without external dependencies.

#### `basic/string_contains.py`
- **Purpose**: Checks if output contains expected keywords
- **Tests**: String operations, normalization, word overlap
- **Use case**: Validate that LLM output includes specific terms or phrases
- **Example**:
  ```python
  output = "The capital of France is Paris"
  correct_answer = "Paris"
  # Returns: 1.0
  ```

#### `basic/length_check.py`
- **Purpose**: Validates output length is within expected range
- **Tests**: `len()`, type checking, range comparisons
- **app_params**: `min_length`, `max_length`
- **Use case**: Ensure responses aren't too short or too verbose

#### `basic/json_structure.py`
- **Purpose**: Validates JSON structure and required fields
- **Tests**: JSON parsing, dict operations, key checking
- **app_params**: `required_fields` (comma-separated)
- **Use case**: Verify LLM generates valid JSON with expected fields

#### `basic/word_count.py`
- **Purpose**: Checks word count is within target range
- **Tests**: String splitting, counting, range checking
- **app_params**: `target_words` or `min_words`/`max_words`
- **Use case**: Control response verbosity

### 2. NumPy Use Evaluators

Evaluators that leverage NumPy for numerical and array operations.

#### `numpy/cosine_similarity.py`
- **Purpose**: Calculates cosine similarity between vectors
- **Tests**: NumPy array operations, vector math
- **Input format**: JSON with `vector` field
- **Use case**: Compare embedding vectors, semantic similarity

#### `numpy/statistical_accuracy.py`
- **Purpose**: Validates statistical calculations
- **Tests**: mean, std, median, min, max calculations
- **app_params**: `tolerance` (default: 0.01)
- **Use case**: Verify data analysis outputs

#### `numpy/array_transformation.py`
- **Purpose**: Tests array transformations
- **Tests**: reshape, transpose, broadcasting
- **app_params**: `operation` (e.g., 'transpose', 'reshape')
- **Use case**: Validate matrix manipulation operations

#### `numpy/matrix_operations.py`
- **Purpose**: Tests matrix operations
- **Tests**: multiplication, inverse, determinant, eigenvalues
- **app_params**: `operation` (e.g., 'multiply', 'determinant')
- **Use case**: Verify linear algebra computations

### 3. OpenAI Use Evaluators

Evaluators for testing OpenAI SDK integration and API responses.

#### `openai/response_structure.py`
- **Purpose**: Validates OpenAI API response format
- **Tests**: Response structure, choices, usage fields
- **Checks**:
  - Has `id`, `choices`, `usage` fields
  - Valid model name
  - Proper message structure
- **Use case**: Ensure correct API integration

#### `openai/token_efficiency.py`
- **Purpose**: Checks token usage efficiency
- **Tests**: Token counting, budget compliance
- **app_params**: `max_tokens` (budget)
- **Scoring**: Optimal usage at 50-90% of budget
- **Use case**: Monitor and optimize token costs

#### `openai/function_calling.py`
- **Purpose**: Validates function calling (tools) feature
- **Tests**: Tool calls, function names, argument parsing
- **app_params**: `expected_function_name` (optional)
- **Use case**: Verify function calling implementation

### 4. Agenta Secrets Evaluators

Evaluators for testing secrets and API key management.

#### `agenta_secrets/secrets_security.py`
- **Purpose**: Ensures no API keys are exposed in output
- **Tests**:
  - No OpenAI keys (`sk-...`)
  - No Anthropic keys (`sk-ant-...`)
  - No Google keys (`AIza...`)
  - No bearer tokens
- **Returns**: 0.0 if any secrets detected
- **Use case**: Security audit for secret exposure

#### `agenta_secrets/provider_key_usage.py`
- **Purpose**: Tests LLM provider authentication
- **Tests**: Provider specification, auth status, model availability
- **Valid providers**: openai, anthropic, google, cohere, azure, bedrock
- **Use case**: Validate multi-provider setup

#### `agenta_secrets/secrets_masking.py`
- **Purpose**: Validates proper secret masking
- **Tests**:
  - Masked patterns (`***`, `****`, `REDACTED`)
  - Partial key display (last 4 chars)
  - No full keys exposed
- **Use case**: Ensure logs don't leak credentials

### 5. Agenta Config Evaluators

Evaluators for configuration and credential management.

#### `agenta_config/config_parameters.py`
- **Purpose**: Validates configuration parameters
- **Tests**:
  - Temperature (0.0-2.0)
  - Max tokens (> 0)
  - Model name presence
  - Config metadata
- **Use case**: Ensure proper config usage

#### `agenta_config/database_credentials.py`
- **Purpose**: Tests database credential handling
- **Tests**:
  - No passwords in output
  - No connection strings exposed
  - Connection status reported
  - Service names referenced (not creds)
- **Use case**: Security audit for database access

#### `agenta_config/environment_config.py`
- **Purpose**: Validates environment-specific config
- **Tests**: Dev/staging/prod configs, endpoints, security settings
- **app_params**: `environment` (dev/staging/prod)
- **Use case**: Ensure correct environment setup

#### `agenta_config/config_validation.py`
- **Purpose**: Tests configuration validation
- **Tests**: Required fields, type checking, validation errors
- **correct_answer**: Expected validation outcome (true/false)
- **Use case**: Verify config validation logic

## Usage Examples

### Using in Agenta UI

1. Navigate to Evaluators section in Agenta
2. Create a new "Code Evaluation" evaluator
3. Copy the code from any evaluator file
4. Paste into the code editor
5. Configure settings (e.g., `min_length`, `max_length` for length_check)
6. Save and use in your evaluations

### Using Programmatically

```python
# Import an evaluator
from evaluators.basic.string_contains import evaluate

# Use in your code
score = evaluate(
    app_params={},
    inputs={"prompt": "What is the capital of France?"},
    output="The capital of France is Paris",
    correct_answer="Paris"
)
print(f"Score: {score}")  # Score: 1.0
```

### Importing Multiple Evaluators

```python
# Basic evaluators
from evaluators.basic.string_contains import evaluate as string_contains_eval
from evaluators.basic.length_check import evaluate as length_check_eval
from evaluators.basic.json_structure import evaluate as json_structure_eval

# NumPy evaluators
from evaluators.numpy.cosine_similarity import evaluate as cosine_sim_eval
from evaluators.numpy.statistical_accuracy import evaluate as stats_eval

# OpenAI evaluators
from evaluators.openai.response_structure import evaluate as openai_structure_eval
from evaluators.openai.token_efficiency import evaluate as token_efficiency_eval

# Agenta evaluators
from evaluators.agenta_secrets.secrets_security import evaluate as secrets_security_eval
from evaluators.agenta_config.config_parameters import evaluate as config_params_eval
```

## Testing Different Scenarios

### Test 1: Basic String Matching
```python
from evaluators.basic.string_contains import evaluate

# Test case
result = evaluate(
    app_params={},
    inputs={},
    output="Machine learning is a subset of artificial intelligence",
    correct_answer="machine learning"
)
# Expected: 1.0 (case-insensitive match)
```

### Test 2: NumPy Vector Similarity
```python
from evaluators.numpy.cosine_similarity import evaluate
import json

# Test case
result = evaluate(
    app_params={},
    inputs={},
    output=json.dumps({"vector": [1, 0, 0]}),
    correct_answer=json.dumps({"vector": [0.9, 0.1, 0]})
)
# Expected: ~0.95 (high similarity)
```

### Test 3: OpenAI Response Validation
```python
from evaluators.openai.response_structure import evaluate

# Test case
result = evaluate(
    app_params={},
    inputs={},
    output={
        "id": "chatcmpl-123",
        "model": "gpt-4",
        "choices": [{"message": {"role": "assistant", "content": "Hello"}}],
        "usage": {"total_tokens": 50}
    },
    correct_answer=""
)
# Expected: 1.0 (valid structure)
```

### Test 4: Secrets Security Check
```python
from evaluators.agenta_secrets.secrets_security import evaluate

# Test case - GOOD (no secrets)
result = evaluate(
    app_params={},
    inputs={},
    output={"status": "success", "provider": "openai", "response": "Hello"},
    correct_answer=""
)
# Expected: 1.0 (no secrets exposed)

# Test case - BAD (secret exposed)
result = evaluate(
    app_params={},
    inputs={},
    output={"api_key": "your-api-key-here", "status": "success"},
    correct_answer=""
)
# Expected: 0.0 (secret detected!)
```

## Dependencies

- **Basic evaluators**: No external dependencies (Python stdlib only)
- **NumPy evaluators**: `numpy` package required
- **OpenAI evaluators**: No direct dependency (validates structure only)
- **Agenta evaluators**: No external dependencies

Install dependencies:
```bash
pip install numpy
```

## Best Practices

1. **Always use the `evaluate` function name**: All evaluators use this consistent naming
2. **Handle all input types**: Convert between str and dict as needed
3. **Return float between 0.0 and 1.0**: Never return values outside this range
4. **Fail gracefully**: Return 0.0 on errors, don't raise exceptions
5. **Document expected formats**: Use docstrings to explain input/output formats
6. **Test edge cases**: Empty strings, missing keys, invalid JSON, etc.

## Extending the Evaluators

To create your own evaluator:

1. Choose the appropriate category (or create a new one)
2. Create a new Python file with descriptive name
3. Import required dependencies at the top
4. Implement the `evaluate` function with the standard signature
5. Add comprehensive docstring
6. Handle errors gracefully
7. Test with various inputs

Example template:
```python
"""
My Custom Evaluator
===================

Description of what this evaluator tests.
"""

from typing import Dict, Union, Any
import json


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    """
    Brief description of evaluator.

    Args:
        app_params: Configuration parameters
        inputs: Input data
        output: LLM output to evaluate
        correct_answer: Expected answer

    Returns:
        float: Score between 0.0 and 1.0
    """
    try:
        # Your evaluation logic here
        score = 0.0

        # Calculate score...

        return score
    except Exception:
        return 0.0
```

## License

These evaluators are provided as examples for use with Agenta. Modify and extend as needed for your use cases.

## Contributing

To contribute new evaluators or improvements:
1. Follow the existing structure and naming conventions
2. Include comprehensive docstrings
3. Test thoroughly with various inputs
4. Update this README with documentation

## Support

For questions or issues:
- Check the [Agenta documentation](https://docs.agenta.ai)
- Open an issue in the repository
- Join the Agenta community discussions
