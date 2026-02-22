"""Execution templates for evaluator runtimes, organized by version."""

from __future__ import annotations


EVALUATOR_TEMPLATES = {
    "v0": {
        "python": """
import json

# Parse all parameters from a single dict
params = json.loads({params_json!r})
app_params = params['app_params']
inputs = params['inputs']
output = params['output']
correct_answer = params['correct_answer']

# User-provided evaluation code
{user_code}

# Execute and capture result
result = evaluate(app_params, inputs, output, correct_answer)

# Ensure result is a float
if isinstance(result, (float, int, str)):
    try:
        result = float(result)
    except (ValueError, TypeError):
        result = None

# Print result for capture
print(json.dumps({{"result": result}}))
""",
        "javascript": """
// Parse all parameters from a single JSON string
const params = JSON.parse({params_json!r});
const app_params = params.app_params;
const inputs = params.inputs;
const output = params.output;
const correct_answer = params.correct_answer;

// User-provided evaluation code
{user_code}

// Execute and capture result
let result = evaluate(app_params, inputs, output, correct_answer);

// Ensure result is a number
result = Number(result);
if (!Number.isFinite(result)) {{
    result = null;
}}

// Print result for capture
console.log(JSON.stringify({{ result: result }}));
""",
        "typescript": """
// Parse all parameters from a single JSON string
const params = JSON.parse({params_json!r});
const app_params = params.app_params;
const inputs = params.inputs;
const output = params.output;
const correct_answer = params.correct_answer;

// User-provided evaluation code
{user_code}

// Execute and capture result
let result = evaluate(app_params, inputs, output, correct_answer);

// Ensure result is a number
result = Number(result);
if (!Number.isFinite(result)) {{
    result = null;
}}

// Print result for capture
console.log(JSON.stringify({{ result: result }}));
""",
    },
    "v1": {
        "python": """
import json

# Parse all parameters from a single dict
params = json.loads({params_json!r})
inputs = params['inputs']
outputs = params['outputs']
trace = params['trace']

# User-provided evaluation code
{user_code}

# Execute and capture result
result = evaluate(inputs, outputs, trace)

# Ensure result is a float
if isinstance(result, (float, int, str)):
    try:
        result = float(result)
    except (ValueError, TypeError):
        result = None

# Print result for capture
print(json.dumps({{"result": result}}))
""",
        "javascript": """
// Parse all parameters from a single JSON string
const params = JSON.parse({params_json!r});
const inputs = params.inputs;
const outputs = params.outputs;
const trace = params.trace;

// User-provided evaluation code
{user_code}

// Execute and capture result
let result = evaluate(inputs, outputs, trace);

// Ensure result is a number
result = Number(result);
if (!Number.isFinite(result)) {{
    result = null;
}}

// Print result for capture
console.log(JSON.stringify({{ result: result }}));
""",
        "typescript": """
// Parse all parameters from a single JSON string
const params = JSON.parse({params_json!r});
const inputs = params.inputs;
const outputs = params.outputs;
const trace = params.trace;

// User-provided evaluation code
{user_code}

// Execute and capture result
let result = evaluate(inputs, outputs, trace);

// Ensure result is a number
result = Number(result);
if (!Number.isFinite(result)) {{
    result = null;
}}

// Print result for capture
console.log(JSON.stringify({{ result: result }}));
""",
    },
}
