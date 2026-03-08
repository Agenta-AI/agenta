# QA Protocol

## Strategy

This change modifies the evaluator execution pipeline, so backward compatibility is critical. The protocol uses a **before/after deployment** approach: set up test evaluators on the current version, deploy the changes, then verify everything still works plus the new interface.

## Pre-Deployment Setup (on current main)

Deploy the current main branch and create baseline evaluators that will be used to verify backward compatibility after the changes.

### 1. Create a test testset

Create a testset with columns that exercise different scenarios:

| country | correct_answer | difficulty |
|---------|---------------|------------|
| France | Paris | easy |
| Japan | Tokyo | medium |
| Brazil | Brasilia | hard |
| Australia | Canberra | hard |

### 2. Create a test application

Use a simple prompt-based app (or any existing app) that takes `country` as input and returns a capital city.

### 3. Create baseline evaluators (v1 — before changes)

Create and commit these evaluators. They will exist as saved revisions with no `version` field in their parameters (which the handler should treat as `"1"`).

#### 3a. Code Evaluator — Python Exact Match (v1)
Use the default preset. Verify it works in the evaluator playground and in a batch evaluation.

```python
from typing import Dict, Union, Any

def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    if output == correct_answer:
        return 1.0
    return 0.0
```

#### 3b. Code Evaluator — Python with `inputs` access (v1)
Tests that `inputs` dict access works (the `correct_answer_key` pattern):

```python
from typing import Dict, Union, Any

def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    # Access difficulty from inputs to test v1 inputs access
    difficulty = inputs.get("difficulty", "unknown")
    match = output == correct_answer
    if match and difficulty == "hard":
        return 1.0
    elif match:
        return 0.8
    return 0.0
```

#### 3c. Code Evaluator — JavaScript (v1)
```javascript
function evaluate(appParams, inputs, output, correctAnswer) {
  return output === String(correctAnswer) ? 1.0 : 0.0
}
```

#### 3d. LLM-as-a-Judge (baseline)
Create an LLM-as-a-judge evaluator with default settings. This is not being changed but serves as a control.

### 4. Run a baseline batch evaluation

Run a batch evaluation with all the above evaluators against the test testset + app. Record the results (scores per testcase per evaluator). These are the reference results for backward compatibility.

### 5. Test evaluator playground

For each evaluator, test the playground / debug section:
- Load a testcase
- Run the evaluator
- Verify it returns expected results

**Save all results** — these are the baseline for comparison.

---

## Post-Deployment Verification (after changes)

Deploy the branch with changes. Run the following tests.

### 6. Backward Compatibility — Existing v1 Evaluators

**Critical: these must all pass without any changes to the evaluators.**

#### 6a. Re-run the same batch evaluation
- Use the exact same evaluators created in step 3 (no modifications)
- Use the same testset and app
- Results should match the baseline from step 4 exactly

#### 6b. Re-test evaluator playground
- Open each v1 evaluator
- Test in playground with a testcase
- Results should match step 5

#### 6c. Verify v1 evaluators show correct settings
- Open each v1 evaluator's configuration
- `correct_answer_key` should still be visible and functional
- Code should be unchanged
- No errors or warnings

### 7. New v2 Evaluators — Basic Functionality

#### 7a. Create new code evaluator (v2 — Python)
Create a new evaluator from the default preset. It should now default to v2 interface.

Verify the default code uses the new signature:
```python
def evaluate(inputs, outputs, trace):
    ...
```

Test in playground with a testcase. Verify:
- `inputs` contains testcase columns (country, correct_answer, difficulty)
- `outputs` contains app output
- `trace` is a dict with spans

#### 7b. Simple exact match (v2 — Python)
```python
def evaluate(inputs, outputs, trace):
    if outputs == inputs.get("correct_answer"):
        return 1.0
    return 0.0
```
- Test in playground
- Run in batch evaluation
- Verify scores match expected (same as v1 exact match)

#### 7c. Trace access (v2 — Python)
```python
def evaluate(inputs, outputs, trace):
    # Verify trace is populated
    if not trace or not trace.get("spans"):
        return 0.0

    root = list(trace["spans"].values())[0]
    ag = root.get("attributes", {}).get("ag", {})

    # Check latency
    duration = ag.get("metrics", {}).get("unit", {}).get("duration", {}).get("total", 0)

    # Check correctness
    is_correct = outputs == inputs.get("correct_answer")

    if is_correct and duration < 5.0:
        return 1.0
    elif is_correct:
        return 0.7  # correct but slow
    return 0.0
```
- Test in playground — verify trace data is present and navigable
- Run in batch evaluation — verify scores reflect both correctness and latency

#### 7d. JavaScript v2
```javascript
function evaluate(inputs, outputs, trace) {
  return outputs === inputs.correct_answer ? 1.0 : 0.0
}
```
- Test in playground
- Run in batch evaluation

#### 7e. TypeScript v2
```typescript
function evaluate(
  inputs: Record<string, any>,
  outputs: any,
  trace: Record<string, any>
): number {
  return outputs === inputs.correct_answer ? 1.0 : 0.0
}
```
- Test in playground
- Run in batch evaluation

### 8. Presets

#### 8a. Verify all presets load correctly
- Open new evaluator creation
- Select each preset (Python, JavaScript, TypeScript)
- Verify code uses v2 interface
- Verify playground works with each preset

### 9. Online Evaluation (if applicable)

#### 9a. Create a live evaluation rule with a v2 code evaluator
- Set up online evaluation with a v2 code evaluator
- Send a request to the app
- Verify the evaluator runs and produces a result
- Verify `inputs` contains the app inputs from trace (not testcase data)
- Verify `trace` is populated

#### 9b. Create a live evaluation rule with a v1 code evaluator
- Verify existing v1 evaluators still work in online evaluation context

### 10. Edge Cases

#### 10a. `trace` is None
Test what happens when trace data is unavailable. The evaluator should handle it gracefully:
```python
def evaluate(inputs, outputs, trace):
    if trace is None:
        return 0.5  # can't evaluate without trace
    # ...
```

#### 10b. Empty inputs
Test with a testcase that has minimal/no columns.

#### 10c. Complex outputs
Test with an app that returns a dict/JSON output, not just a string.

#### 10d. Evaluator that returns a dict (not float)
```python
def evaluate(inputs, outputs, trace):
    is_correct = outputs == inputs.get("correct_answer")
    return {
        "score": 1.0 if is_correct else 0.0,
        "success": is_correct,
    }
```

#### 10e. Evaluator that throws an exception
Verify error handling still works properly for v2 evaluators.

---

## Checklist Summary

| # | Test | Pass? |
|---|------|-------|
| 6a | v1 batch eval matches baseline | |
| 6b | v1 playground matches baseline | |
| 6c | v1 settings unchanged | |
| 7a | v2 default preset has new signature | |
| 7b | v2 Python exact match works | |
| 7c | v2 trace access works | |
| 7d | v2 JavaScript works | |
| 7e | v2 TypeScript works | |
| 8a | All presets load with v2 interface | |
| 9a | v2 online evaluation works | |
| 9b | v1 online evaluation still works | |
| 10a | trace=None handled | |
| 10b | Empty inputs handled | |
| 10c | Complex outputs handled | |
| 10d | Dict return value works | |
| 10e | Exception handling works | |
