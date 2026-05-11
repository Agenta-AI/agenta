# rubrics/sdk.md – SDK and Library Review

**Domain:** API ergonomics, backward compatibility, documentation, language idioms, dependency footprint.
**Universal criteria:** All 10 criteria applied in the SDK/library context; Security (6), Performance (7), Architecture (8), Testability (9), Observability (10) at baseline.  See `criteria.md`.
**Applies to:** Any change to a library, SDK, package, or module that is consumed by external callers or distributed as a dependency.

> **Scope note:** An SDK reviewer asks: *is this library safe, correct, and pleasant for callers to consume?*  Internal implementation quality is covered by `general.md`; this rubric focuses on the **public surface** and the **contract with consumers**.

---

## Goals

- Confirm that the public API is ergonomic: easy to use correctly, hard to misuse.
- Verify that backward compatibility is maintained or breaking changes are versioned.
- Ensure every public symbol is documented with accurate, complete examples.
- Confirm that the SDK does not impose unnecessary transitive dependencies on consumers.

---

## Checklist

### API design and ergonomics

| # | Criterion | Severity if violated |
|---|---|---|
| SK‑1 | The happy path requires minimal setup; a caller should reach a working state in a few lines | medium |
| SK‑2 | Required vs. optional parameters are clearly distinguished; optional parameters have sensible defaults | medium |
| SK‑3 | The API is hard to misuse: incorrect usage produces a compile-time error or a clear, immediate runtime error — not silent wrong behaviour | high |
| SK‑4 | Naming follows the conventions of the target language (e.g., snake_case in Python, camelCase in JS/Go); no transliterations from another language's style | medium |
| SK‑5 | Builder, fluent, or configuration-object patterns are used where a function would otherwise require more than 3–4 parameters | low |
| SK‑6 | Overloaded or polymorphic functions behave consistently regardless of which variant is called | medium |

### Backward compatibility

| # | Criterion | Severity if violated |
|---|---|---|
| SK‑7 | No public symbols (functions, classes, methods, types, constants) are removed or renamed without a major version bump | high |
| SK‑8 | No existing parameter types are narrowed, no return types are widened, in a non-major release | high |
| SK‑9 | New required parameters are not added to existing public functions without a major version bump | high |
| SK‑10 | Deprecated symbols carry an explicit deprecation notice (annotation, doc-comment) and are maintained for at least one minor release cycle | medium |
| SK‑11 | Enum or union types are not extended in a way that breaks exhaustive matches in consuming code without a major bump | high |

### Versioning

| # | Criterion | Severity if violated |
|---|---|---|
| SK‑12 | The package follows Semantic Versioning: breaking changes → major, new features → minor, fixes → patch | high |
| SK‑13 | The changelog documents what changed between versions, including migration guidance for breaking changes | medium |
| SK‑14 | Pre-release versions (`alpha`, `beta`, `rc`) are clearly labelled and not promoted to stable without review | medium |

### Documentation

| # | Criterion | Severity if violated |
|---|---|---|
| SK‑15 | Every public symbol has a doc-comment stating: purpose, parameters, return value, and exceptions/errors raised | high |
| SK‑16 | At least one usage example exists per public type or major function, either inline or in a dedicated `examples/` directory | medium |
| SK‑17 | Error messages identify the offending argument and suggest a fix; they do not expose internal implementation details | medium |
| SK‑18 | Migration guides exist for every breaking change | high |

### Dependency footprint

| # | Criterion | Severity if violated |
|---|---|---|
| SK‑19 | New transitive dependencies are justified; unnecessary dependencies are not pulled in | high |
| SK‑20 | Optional features that require heavy dependencies are gated behind optional extras or separate packages | medium |
| SK‑21 | The minimum supported runtime version is documented and not raised without a major bump | medium |

### Testability for consumers

| # | Criterion | Severity if violated |
|---|---|---|
| SK‑22 | Consumers can use the SDK in unit tests without running a real server, database, or external service; a test double, mock client, or in-process fake is provided or possible | high |
| SK‑23 | The SDK does not rely on global state or singletons that prevent parallel test execution in consumer test suites | high |
| SK‑24 | Any I/O or side-effect the SDK performs is clearly documented so consumers know what they must mock | medium |
| SK‑25 | Time-dependent behaviour uses a configurable or injectable clock abstraction | medium |

### Security (baseline)

| # | Criterion | Severity if violated |
|---|---|---|
| SK‑26 | Credentials, API keys, and tokens are passed by the caller, not embedded in the SDK | critical |
| SK‑27 | The SDK does not log or surface caller credentials, tokens, or sensitive payloads | high |
| SK‑28 | Input accepted from callers is validated before being forwarded to external services | high |

---

## Scoring guidance

Backward-compatibility violations (SK‑7 to SK‑11) are **high** by default because they silently break downstream consumers who have no visibility into the SDK's internals.

Missing public documentation (SK‑15) on a published API is **high**: undocumented behaviour is effectively untestable and fragile to change.

Consumer testability failures (SK‑22, SK‑23) are **high** for the same reason as `testability.md` — they compound: every future consumer test will either be impossible or depend on live infrastructure.

Ergonomics issues (SK‑1 to SK‑6) are generally **medium** or **low** unless they actively prevent correct usage.
