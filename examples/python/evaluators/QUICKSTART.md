# Quick Start Guide

Get started with custom evaluators in 5 minutes.

## Installation

No installation required for basic evaluators. For NumPy evaluators:

```bash
pip install numpy
```

## Quick Examples

### 1. Basic String Contains (No Dependencies)

Copy this code into Agenta's Code Evaluation editor:

```python
from typing import Dict, Union, Any
import json

def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    if isinstance(output, dict):
        output_str = json.dumps(output)
    else:
        output_str = str(output)

    if correct_answer.lower() in output_str.lower():
        return 1.0
    return 0.0
```

**Use case**: Check if output contains expected keywords.

### 2. JSON Structure Validator

```python
from typing import Dict, Union, Any
import json

def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    try:
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        if not isinstance(output_data, dict):
            return 0.0

        # Check required fields
        required = app_params.get('required_fields', '').split(',')
        required = [f.strip() for f in required if f.strip()]

        if not required:
            return 1.0

        present = sum(1 for field in required if field in output_data)
        return present / len(required)
    except:
        return 0.0
```

**Settings**: Add `required_fields: name,email,age` in app_params

### 3. Secrets Security Check

```python
from typing import Dict, Union, Any
import json
import re

def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    if isinstance(output, dict):
        output_str = json.dumps(output)
    else:
        output_str = str(output)

    # Check for API key patterns
    patterns = [
        r'sk-[a-zA-Z0-9]{32,}',  # OpenAI
        r'sk-ant-[a-zA-Z0-9\-]{32,}',  # Anthropic
    ]

    for pattern in patterns:
        if re.search(pattern, output_str):
            return 0.0  # Secret detected!

    return 1.0  # No secrets found
```

**Use case**: Ensure no API keys are leaked in responses.

### 4. Token Efficiency Check

```python
from typing import Dict, Union, Any
import json

def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    try:
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        usage = output_data.get('usage', {})
        total_tokens = usage.get('total_tokens', 0)
        max_tokens = int(app_params.get('max_tokens', 1000))

        if total_tokens == 0:
            return 0.0

        if total_tokens <= max_tokens:
            ratio = total_tokens / max_tokens
            # Optimal: 50-90% usage
            if 0.5 <= ratio <= 0.9:
                return 1.0
            return 0.8

        # Over budget
        return max(0.0, 1.0 - (total_tokens - max_tokens) / max_tokens)
    except:
        return 0.0
```

**Settings**: Add `max_tokens: 500` in app_params

## Common Patterns

### Pattern 1: Parse JSON Output

```python
if isinstance(output, str):
    output_data = json.loads(output)
else:
    output_data = output
```

### Pattern 2: Normalize Strings

```python
output_str = str(output).lower().strip()
answer_str = correct_answer.lower().strip()
```

### Pattern 3: Handle Errors Gracefully

```python
def evaluate(...) -> float:
    try:
        # Your logic here
        return score
    except Exception:
        return 0.0  # Never raise, always return 0.0
```

### Pattern 4: Progressive Scoring

```python
checks_passed = 0
total_checks = 5

if condition1:
    checks_passed += 1
if condition2:
    checks_passed += 1
# ...

return checks_passed / total_checks
```

## File Organization

Each evaluator category has its own folder:

```
basic/           → string_contains.py, length_check.py, ...
numpy/           → cosine_similarity.py, statistical_accuracy.py, ...
openai/          → response_structure.py, token_efficiency.py, ...
agenta_secrets/  → secrets_security.py, provider_key_usage.py, ...
agenta_config/   → config_parameters.py, database_credentials.py, ...
```

## Using in Agenta

1. Open Agenta UI → Evaluators
2. Click "New Evaluator" → "Code Evaluation"
3. Copy entire file content (from `from typing...` to `return score`)
4. Paste into code editor
5. Configure settings if needed (app_params)
6. Save and test

## Testing Locally

```python
# Save evaluator to test.py
from test import evaluate

result = evaluate(
    app_params={"min_length": "10"},
    inputs={"prompt": "Hello"},
    output="This is a test output",
    correct_answer=""
)

print(f"Score: {result}")
```

## Next Steps

- See [README.md](README.md) for complete documentation
- Browse category folders for more evaluators
- Modify evaluators for your specific use cases
- Create custom evaluators using the template in README

## Common Use Cases

| Use Case | Evaluator | Category |
|----------|-----------|----------|
| Check keyword presence | `string_contains.py` | basic |
| Validate response length | `length_check.py` | basic |
| Verify JSON output | `json_structure.py` | basic |
| Compare embeddings | `cosine_similarity.py` | numpy |
| Check API response format | `response_structure.py` | openai |
| Monitor token usage | `token_efficiency.py` | openai |
| Prevent secret leaks | `secrets_security.py` | agenta_secrets |
| Validate config params | `config_parameters.py` | agenta_config |

## Troubleshooting

**Q: Evaluator returns 0.0 always**
- Check for exceptions in your logic
- Add print statements for debugging
- Verify input/output formats match expectations

**Q: NumPy not found**
- Install: `pip install numpy`
- Or use basic evaluators (no dependencies)

**Q: JSON parsing fails**
- Check if output is valid JSON
- Handle both string and dict inputs
- Use try/except blocks

**Q: How to test locally?**
- Save evaluator to a .py file
- Import and call the `evaluate` function
- Pass sample data matching the signature

## Support

- Full documentation: [README.md](README.md)
- Agenta docs: https://docs.agenta.ai
- Community: https://github.com/agenta-ai/agenta
