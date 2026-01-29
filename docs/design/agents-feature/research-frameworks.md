# Research: Agent Frameworks

## Objective

Evaluate minimal agent frameworks that align with Agenta's philosophy (similar to how LiteLLM provides a simple unified interface).

## Requirements

What we're looking for:
- Minimal, not opinionated
- Easy to integrate
- Provider-agnostic (like LiteLLM)
- Observable (works with our tracing)
- Not a "framework that takes over"

## Framework Survey

### 1. No Framework (Build Minimal)

**Approach:** Implement basic agent loop ourselves

```python
# Pseudocode
while not done:
    response = llm.complete(messages, tools=tools)
    if response.tool_calls:
        results = execute_tools(response.tool_calls)
        messages.append(tool_results)
    else:
        done = True
```

**Pros:**
- Full control
- Minimal dependencies
- Easy to observe/trace

**Cons:**
- Reinventing the wheel
- Edge cases to handle

### 2. LiteLLM (Already Using)

**What it offers:**
- Unified interface to LLMs
- Function calling support
- Already in our stack

**Agent support:**
- Does LiteLLM have agent primitives?
- ...

### 3. Instructor

**Website:** https://github.com/jxnl/instructor

**What it is:**
- Structured outputs from LLMs
- Built on Pydantic
- Minimal, focused

**Agent support:**
- ...

### 4. Marvin

**Website:** https://github.com/prefecthq/marvin

**What it is:**
- Lightweight AI functions
- Minimal abstractions

**Agent support:**
- ...

### 5. Mirascope

**Website:** https://github.com/mirascope/mirascope

**What it is:**
- LLM toolkit, Pythonic
- Provider-agnostic

**Agent support:**
- ...

### 6. ControlFlow

**Website:** https://github.com/PrefectHQ/ControlFlow

**What it is:**
- Workflow orchestration for AI
- From Prefect team

**Agent support:**
- ...

### 7. Other Options

- **Pydantic AI**: https://github.com/pydantic/pydantic-ai
- **Agency Swarm**: ...
- **AutoGen**: Microsoft's framework (probably too heavy)
- **CrewAI**: ...

## Comparison Matrix

| Framework | Minimal | Observable | Provider-Agnostic | Active | Fit for Agenta |
|-----------|---------|------------|-------------------|--------|----------------|
| No framework | +++ | +++ | +++ | N/A | ? |
| LiteLLM | +++ | ++ | +++ | +++ | ? |
| Instructor | +++ | ++ | ++ | +++ | ? |
| Marvin | ++ | + | ++ | ++ | ? |
| Mirascope | ++ | ++ | +++ | ++ | ? |
| ControlFlow | + | ++ | ++ | ++ | ? |
| Pydantic AI | ++ | ++ | +++ | +++ | ? |

## Key Questions

1. Do we even need a framework?
2. Can we extend LiteLLM's function calling?
3. What's the observability story for each option?
4. How does each integrate with our SDK?

## Evaluation Criteria

- **Simplicity**: How much complexity does it add?
- **Control**: Can we customize everything?
- **Observability**: Does it work with our tracing?
- **Maintenance**: Is it actively maintained?
- **Philosophy**: Does it match Agenta's approach?

## Findings

_Document research findings here_

## Recommendations

_Summarize recommendations after research_
